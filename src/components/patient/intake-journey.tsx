'use client';

import { useState, useCallback, useEffect } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import { coviuTheme } from '@/lib/survey/theme';
import { PersistentHeader } from './persistent-header';
import { PhoneVerification } from './phone-verification';
import type { PatientContact } from '@/lib/supabase/types';

export interface IntakeJourneyContext {
  org: {
    id: string;
    name: string;
    logo_url: string | null;
    tier: 'core' | 'complete';
  };
  location: {
    id: string;
    name: string;
    stripe_account_id: string | null;
  };
  appointment: {
    id: string;
    scheduled_at: string | null;
    appointment_type_name: string | null;
    terminal_type: 'run_sheet' | 'collection_only';
    prefill_phone: string | null;
  };
  journey: {
    id: string;
    journey_token: string;
    status: string;
    patient_id: string | null;
    includes_card_capture: boolean;
    includes_consent: boolean;
    form_ids: string[];
    forms: Array<{ id: string; name: string }>;
    card_captured_at: string | null;
    consent_completed_at: string | null;
    forms_completed: Record<string, string>;
  };
}

interface IntakeJourneyProps {
  context: IntakeJourneyContext;
  token: string;
}

type Phase =
  | 'phone'
  | 'identity'
  | 'identity_picker'
  | 'identity_no_match'
  | 'checklist'
  | 'card'
  | 'consent'
  | 'form'
  | 'done';

interface ConfirmContact {
  id: string;
  first_name: string;
  last_name: string;
}

// Lazy imports to keep phone-verification etc tree-shaken if unused
import { IntakeCardCapture } from './intake-card-capture';

export function IntakeJourney({ context, token }: IntakeJourneyProps) {
  const { org, journey, appointment } = context;

  // Progress is driven by the journey row — reload it after each item so late
  // arrivals via reminder link resume at the right place.
  const [state, setState] = useState(journey);

  const [rawPhase, setPhase] = useState<Phase>(() => deriveInitialPhase(journey));
  const [phoneNumber, setPhoneNumber] = useState<string | null>(
    appointment.prefill_phone
  );
  const [patient, setPatient] = useState<PatientContact | null>(null);
  const [pickerContacts, setPickerContacts] = useState<ConfirmContact[]>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Journey completion overrides any local phase state — keeps the "done"
  // screen sticky even if rawPhase is stale from before the last reload.
  const phase: Phase = state.status === 'completed' ? 'done' : rawPhase;

  // Items list in fixed order. Used for the checklist screen and for
  // advancing between items.
  const items = buildItems(state);
  const itemsDone = items.filter((i) => i.complete).length;

  // Steps: phone, identity, (each configured item), done. Skip card/consent/forms
  // in stepper when not included. Checklist is not a numbered step.
  const totalSteps = 2 + items.length; // phone + identity + each item
  const currentStepNumber = computeStepNumber(phase, activeFormId, items);

  const reloadJourney = useCallback(async () => {
    const res = await fetch(`/api/intake/${token}`);
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) => ({ ...prev, ...data.journey, forms: prev.forms }));
  }, [token]);

  const resolveIdentity = useCallback(
    async (phone: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/intake/${token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: phone }),
        });
        const data = await res.json();

        if (data.status === 'matched') {
          setPatient({
            id: data.contact.id,
            first_name: data.contact.first_name,
            last_name: data.contact.last_name,
            date_of_birth: null,
          });
          await reloadJourney();
          setPhase('checklist');
          return;
        }

        if (data.status === 'multi_match') {
          setPickerContacts(data.contacts ?? []);
          setPhase('identity_picker');
          return;
        }

        // no_match or unexpected shape
        setPhase('identity_no_match');
      } catch {
        setError('Something went wrong. Please try again.');
      }
    },
    [token, reloadJourney]
  );

  const handlePhoneVerified = useCallback(
    (phone: string) => {
      setPhoneNumber(phone);
      setPhase('identity');
      resolveIdentity(phone);
    },
    [resolveIdentity]
  );

  const handlePickerChoice = useCallback(
    async (contact: ConfirmContact) => {
      setError(null);
      try {
        const res = await fetch(`/api/intake/${token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_number: phoneNumber,
            selected_patient_id: contact.id,
          }),
        });
        const data = await res.json();
        if (data.status !== 'matched') {
          setError('Unable to confirm contact. Please try again.');
          return;
        }
        setPatient({
          id: data.contact.id,
          first_name: data.contact.first_name,
          last_name: data.contact.last_name,
          date_of_birth: null,
        });
        await reloadJourney();
        setPhase('checklist');
      } catch {
        setError('Something went wrong. Please try again.');
      }
    },
    [token, phoneNumber, reloadJourney]
  );

  const advanceFromChecklist = useCallback(() => {
    const nextItem = items.find((i) => !i.complete);
    if (!nextItem) {
      setPhase('done');
      return;
    }
    if (nextItem.kind === 'card') setPhase('card');
    else if (nextItem.kind === 'consent') setPhase('consent');
    else {
      setActiveFormId(nextItem.formId!);
      setPhase('form');
    }
  }, [items]);

  const handleItemComplete = useCallback(async () => {
    await reloadJourney();
    // Small beat before transitioning to give users a moment to see the change
    setPhase('checklist');
    setActiveFormId(null);
  }, [reloadJourney]);

  // Guard: if patient object missing but journey has patient_id (e.g. returning
  // via reminder link on a device that doesn't have state), hydrate the
  // display name from the journey row's contact so checklist headers can
  // greet the patient by name.
  useEffect(() => {
    if (phase !== 'checklist' && phase !== 'card' && phase !== 'consent' && phase !== 'form') {
      return;
    }
    if (patient || !state.patient_id) return;
    (async () => {
      const res = await fetch(`/api/intake/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: phoneNumber ?? 'resume',
          selected_patient_id: state.patient_id,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'matched') {
        setPatient({
          id: data.contact.id,
          first_name: data.contact.first_name,
          last_name: data.contact.last_name,
          date_of_birth: null,
        });
      }
    })();
  }, [phase, patient, state.patient_id, token, phoneNumber]);

  if (phase === 'done' || state.status === 'completed') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader clinicName={org.name} logoUrl={org.logo_url} />
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
            <svg
              className="h-6 w-6 text-teal-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">You&apos;re all set</h1>
          <p className="mt-2 text-sm text-gray-500">
            {appointment.terminal_type === 'run_sheet'
              ? `We'll be in touch before your appointment at ${org.name}.`
              : `Thanks for completing your intake. ${org.name} will be in touch.`}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'phone') {
    return (
      <PhoneVerification
        clinicName={org.name}
        logoUrl={org.logo_url}
        roomName={null}
        currentStep={1}
        totalSteps={totalSteps}
        prefillPhone={phoneNumber}
        sessionId={null}
        orgId={org.id}
        onVerified={(phone) => handlePhoneVerified(phone)}
      />
    );
  }

  if (phase === 'identity') {
    // Resolving contact — this is transient. Shown while /verify returns.
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={org.name}
          logoUrl={org.logo_url}
          currentStep={2}
          totalSteps={totalSteps}
        />
        <div className="flex h-32 w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        </div>
        {error && (
          <p className="text-center text-sm text-red-500" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (phase === 'identity_picker') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={org.name}
          logoUrl={org.logo_url}
          currentStep={2}
          totalSteps={totalSteps}
        />
        <div className="w-full space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">
            Please confirm who this appointment is for
          </h1>
          <p className="text-sm text-gray-500">
            We found more than one person on this phone number at {org.name}.
          </p>
          <div className="space-y-2">
            {pickerContacts.map((c) => (
              <button
                key={c.id}
                onClick={() => handlePickerChoice(c)}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-teal-500 hover:bg-teal-50"
              >
                <span className="text-base font-medium text-gray-800">
                  {c.first_name} {c.last_name}
                </span>
              </button>
            ))}
          </div>
          {error && (
            <p className="text-center text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'identity_no_match') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={org.name}
          logoUrl={org.logo_url}
          currentStep={2}
          totalSteps={totalSteps}
        />
        <div className="w-full space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
            <span className="text-lg text-amber-600">!</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">
            We couldn&apos;t find your contact
          </h1>
          <p className="text-sm text-gray-500">
            This phone number isn&apos;t on file at {org.name}. Please contact
            the clinic — they&apos;ll be able to sort this out for you.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'checklist') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader clinicName={org.name} logoUrl={org.logo_url} />
        <div className="w-full space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">
            {patient ? `Hi ${patient.first_name}` : 'Your intake'}
          </h1>
          <p className="text-sm text-gray-500">
            {itemsDone === 0
              ? `Please complete ${items.length} item${items.length === 1 ? '' : 's'} before your appointment.`
              : itemsDone < items.length
                ? `You've completed ${itemsDone} of ${items.length}. Let's finish the rest.`
                : 'Everything is done. Tap continue to finish.'}
          </p>

          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.key}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                  item.complete
                    ? 'border-teal-500/30 bg-teal-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <span
                  className={`text-sm font-medium ${
                    item.complete ? 'text-teal-700' : 'text-gray-800'
                  }`}
                >
                  {item.label}
                </span>
                {item.complete ? (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500">
                    <svg
                      className="h-3.5 w-3.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  </div>
                ) : (
                  <div className="h-6 w-6 rounded-full border-2 border-gray-200" />
                )}
              </li>
            ))}
          </ul>

          <button
            onClick={advanceFromChecklist}
            className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600"
          >
            {itemsDone === 0
              ? 'Get started'
              : itemsDone < items.length
                ? 'Continue'
                : 'Finish'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'card' && patient && state.patient_id) {
    return (
      <IntakeCardCapture
        clinicName={org.name}
        logoUrl={org.logo_url}
        currentStep={currentStepNumber ?? 3}
        totalSteps={totalSteps}
        patientId={state.patient_id}
        token={token}
        onComplete={handleItemComplete}
      />
    );
  }

  if (phase === 'consent') {
    return (
      <ConsentStep
        clinicName={org.name}
        logoUrl={org.logo_url}
        currentStep={currentStepNumber ?? 3}
        totalSteps={totalSteps}
        token={token}
        onComplete={handleItemComplete}
      />
    );
  }

  if (phase === 'form' && activeFormId) {
    return (
      <FormStep
        clinicName={org.name}
        logoUrl={org.logo_url}
        currentStep={currentStepNumber ?? 3}
        totalSteps={totalSteps}
        formId={activeFormId}
        formName={state.forms.find((f) => f.id === activeFormId)?.name ?? 'Form'}
        token={token}
        onComplete={handleItemComplete}
      />
    );
  }

  return null;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

interface ItemSlot {
  key: string;
  kind: 'card' | 'consent' | 'form';
  label: string;
  formId?: string;
  complete: boolean;
}

function buildItems(state: IntakeJourneyContext['journey']): ItemSlot[] {
  const list: ItemSlot[] = [];
  if (state.includes_card_capture) {
    list.push({
      key: 'card',
      kind: 'card',
      label: 'Store a card on file',
      complete: !!state.card_captured_at,
    });
  }
  if (state.includes_consent) {
    list.push({
      key: 'consent',
      kind: 'consent',
      label: 'Provide consent',
      complete: !!state.consent_completed_at,
    });
  }
  for (const f of state.forms) {
    list.push({
      key: `form:${f.id}`,
      kind: 'form',
      label: f.name,
      formId: f.id,
      complete: !!state.forms_completed?.[f.id],
    });
  }
  return list;
}

function deriveInitialPhase(j: IntakeJourneyContext['journey']): Phase {
  if (j.status === 'completed') return 'done';
  // Fresh arrivals always start at phone verification. If the patient has
  // already been attached (via reminder link after a previous visit), we could
  // skip to checklist — but we still want phone ownership confirmed each
  // session. For simplicity, always re-verify.
  return 'phone';
}

function computeStepNumber(
  phase: Phase,
  activeFormId: string | null,
  items: ItemSlot[]
): number | undefined {
  if (phase === 'phone') return 1;
  if (phase === 'identity') return 2;
  if (phase === 'checklist') return undefined;

  // For item phases, compute which step index we're at in the items list.
  const idx = items.findIndex((i) => {
    if (phase === 'card') return i.kind === 'card';
    if (phase === 'consent') return i.kind === 'consent';
    if (phase === 'form' && activeFormId)
      return i.kind === 'form' && i.formId === activeFormId;
    return false;
  });

  if (idx < 0) return undefined;
  return 2 + idx + 1; // phone + identity + this item's position
}

// ----------------------------------------------------------------------------
// Consent step
// ----------------------------------------------------------------------------

interface ConsentStepProps {
  clinicName: string;
  logoUrl: string | null;
  currentStep: number;
  totalSteps: number;
  token: string;
  onComplete: () => void;
}

function ConsentStep({
  clinicName,
  logoUrl,
  currentStep,
  totalSteps,
  token,
  onComplete,
}: ConsentStepProps) {
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/intake/${token}/complete-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_type: 'consent' }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to record consent');
        return;
      }
      onComplete();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
      <div className="w-full space-y-4">
        <h1 className="text-xl font-semibold text-gray-800">Consent</h1>
        <p className="text-sm text-gray-500">
          By continuing, you confirm that you&apos;ve read and agree to
          {` ${clinicName}'s `}
          privacy and treatment consent terms.
        </p>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500">
          <p>
            I agree that {clinicName} may store my contact details, appointment
            history, and any clinical information needed to deliver my care. I
            understand that my information is held securely and only shared where
            required by law or with my explicit permission.
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
          />
          <span className="text-sm text-gray-800">
            I&apos;ve read and agree to the terms above.
          </span>
        </label>
        {error && (
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
        )}
        <button
          onClick={submit}
          disabled={!agreed || saving}
          className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Form step
// ----------------------------------------------------------------------------

interface FormStepProps {
  clinicName: string;
  logoUrl: string | null;
  currentStep: number;
  totalSteps: number;
  formId: string;
  formName: string;
  token: string;
  onComplete: () => void;
}

function FormStep({
  clinicName,
  logoUrl,
  currentStep,
  totalSteps,
  formId,
  formName,
  token,
  onComplete,
}: FormStepProps) {
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [survey, setSurvey] = useState<Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) throw new Error('Failed to load form');
        const data = await res.json();
        if (cancelled) return;
        const formSchema = data.form?.schema;
        if (!formSchema) throw new Error('Form has no schema');
        setSchema(formSchema);
        const model = new Model(formSchema);
        model.applyTheme(coviuTheme);
        model.showProgressBar = 'off';
        model.showTitle = false;
        setSurvey(model);
      } catch {
        if (!cancelled) setError('Could not load form. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  useEffect(() => {
    if (!survey) return;
    const handler = async (sender: Model) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/intake/${token}/complete-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_type: 'form',
            form_id: formId,
            data: sender.data,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Failed to submit form');
          return;
        }
        onComplete();
      } catch {
        setError('Something went wrong. Please try again.');
      } finally {
        setSubmitting(false);
      }
    };
    survey.onComplete.add(handler);
    return () => {
      survey.onComplete.remove(handler);
    };
  }, [survey, token, formId, onComplete]);

  if (loading) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
        <div className="flex h-32 w-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error && !schema) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader clinicName={clinicName} logoUrl={logoUrl} />
        <div className="w-full space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">{formName}</h1>
          <p className="text-sm text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
      <div
        className={`w-full ${submitting ? 'pointer-events-none opacity-60' : ''}`}
      >
        <h1 className="mb-3 text-xl font-semibold text-gray-800">{formName}</h1>
        {error && (
          <p className="mb-2 text-sm text-red-500" role="alert">
            {error}
          </p>
        )}
        {survey && <Survey model={survey} />}
      </div>
    </div>
  );
}
