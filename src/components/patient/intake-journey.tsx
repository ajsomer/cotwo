'use client';

import { useState, useEffect, useRef } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import { postJson } from '@/lib/api-client';
import { coviuTheme } from '@/lib/survey/theme';
import { PersistentHeader } from './persistent-header';
import { PhoneVerification } from './phone-verification';
import { useIntakeJourney } from './use-intake-journey';
import type { PatientContact } from '@/lib/types/domain';

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
    is_onboarding_demo: boolean;
    session_entry_token: string | null;
    session_id: string | null;
  };
}

interface IntakeJourneyProps {
  context: IntakeJourneyContext;
  token: string;
  /**
   * When true, skip the phone OTP + contact picker and start at the checklist.
   * Required when the host has already verified the patient (e.g. the
   * arrival-flow gate, where identity has been confirmed earlier in the flow).
   * Must be paired with `preConfirmedPatient`.
   */
  skipIdentity?: boolean;
  preConfirmedPatient?: PatientContact;
  /**
   * Called when the journey transitions into its `done` phase. The standalone
   * `/intake/[token]` page omits this and keeps showing the "You're all set"
   * screen. Embedded hosts use it to advance their own state machine.
   */
  onAllItemsComplete?: () => void;
}

// Lazy imports to keep phone-verification etc tree-shaken if unused
import { CardCapture } from './card-capture';
import { OnboardingTooltip } from './onboarding-tooltip';
import { Spinner } from '@/components/ui/spinner';
import { CheckCircle } from '@/components/ui/check-circle';

export function IntakeJourney({
  context,
  token,
  skipIdentity,
  preConfirmedPatient,
  onAllItemsComplete,
}: IntakeJourneyProps) {
  const { org, journey, appointment } = context;
  const isDemo = journey.is_onboarding_demo && !journey.status.includes('completed');

  const {
    state,
    phase,
    phoneNumber,
    patient,
    pickerContacts,
    activeFormId,
    error,
    items,
    itemsDone,
    totalSteps,
    currentStepNumber,
    handlePhoneVerified,
    handlePickerChoice,
    advanceFromChecklist,
    handleItemComplete,
  } = useIntakeJourney(context, token, { skipIdentity, preConfirmedPatient });

  // Fire the host's completion hook when the journey reaches the done phase.
  // Guarded so it fires once per mount even if the component re-renders.
  const completionFiredRef = useRef(false);
  useEffect(() => {
    if (phase === 'done' && onAllItemsComplete && !completionFiredRef.current) {
      completionFiredRef.current = true;
      onAllItemsComplete();
    }
  }, [phase, onAllItemsComplete]);

  // Onboarding demo: when the journey completes, transition the session into
  // 'waiting' and redirect to the waiting room. Guarded so the POST fires once,
  // not on every re-render while the redirect is in flight.
  const isDemoRedirect = Boolean(
    journey.is_onboarding_demo && journey.session_entry_token && journey.session_id
  );
  const demoRedirectFiredRef = useRef(false);
  useEffect(() => {
    if (phase !== 'done' || !isDemoRedirect || demoRedirectFiredRef.current) return;
    demoRedirectFiredRef.current = true;
    const entryToken = journey.session_entry_token!;
    void (async () => {
      await fetch('/api/patient/arrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: entryToken, modality: 'telehealth' }),
      });
      window.location.replace(`/waiting/${entryToken}`);
    })();
  }, [phase, isDemoRedirect, journey.session_entry_token]);

  if (phase === 'done' || state.status === 'completed') {
    // Onboarding demo: the effect above arrives the session and redirects to
    // the waiting room; render only a spinner while that's in flight.
    if (isDemoRedirect) {
      return (
        <div className="flex flex-col items-center py-8">
          <Spinner />
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center">
        <PersistentHeader clinicName={org.name} logoUrl={org.logo_url} />
        <div className="flex flex-col items-center py-8 text-center">
          <CheckCircle className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50" />
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
      <OnboardingTooltip
        show={isDemo}
        copy="Phone verification proves ownership of the number you have on file for this patient. Always required."
      >
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
      </OnboardingTooltip>
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
          <Spinner />
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
      <OnboardingTooltip
        show={isDemo}
        copy="Configurable per appointment type in Workflows. Real patients receive this days before their appointment and can complete it across multiple sittings."
      >
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
      </OnboardingTooltip>
    );
  }

  if (phase === 'card' && patient && state.patient_id) {
    return (
      <OnboardingTooltip
        show={isDemo}
        copy="Card storage is optional. Toggle it per intake package in Workflows."
      >
        <CardCapture
          clinicName={org.name}
          logoUrl={org.logo_url}
          currentStep={currentStepNumber ?? 3}
          totalSteps={totalSteps}
          patientId={state.patient_id}
          token={token}
          intro={`${org.name} will use this card to take payment when appropriate. You won't be charged now.`}
          postSave={async () => {
            const result = await postJson(
              `/api/intake/${token}/complete-item`,
              { item_type: 'card' },
              'Failed to record card completion'
            );
            return result.ok ? null : result.error;
          }}
          onComplete={handleItemComplete}
        />
      </OnboardingTooltip>
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
      <OnboardingTooltip
        show={isDemo}
        copy="Build your own forms in the Forms library. Drag and drop, any question types including signatures."
      >
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
      </OnboardingTooltip>
    );
  }

  return null;
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
    const result = await postJson(
      `/api/intake/${token}/complete-item`,
      { item_type: 'consent' },
      'Failed to record consent'
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onComplete();
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
        // Don't show SurveyJS's built-in "Thank you for completing the survey"
        // page — the intake journey advances to the next step itself, and we
        // render our own loading screen in the gap (see `submitting` below).
        model.showCompletedPage = false;
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
      const result = await postJson(
        `/api/intake/${token}/complete-item`,
        {
          item_type: 'form',
          form_id: formId,
          data: sender.data,
        },
        'Failed to submit form'
      );
      setSubmitting(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onComplete();
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
          <Spinner />
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

  // Once the survey is submitted, show a loading screen while complete-item
  // runs and the journey advances — rather than letting the SurveyJS view
  // (or its completion page) linger.
  if (submitting) {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Spinner />
          <p className="text-sm text-gray-500">Saving your answers…</p>
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
      <div className="w-full">
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
