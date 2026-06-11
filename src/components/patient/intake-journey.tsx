'use client';

import { useEffect, useRef } from 'react';
import { postJson } from '@/lib/api-client';
import { PersistentHeader } from './persistent-header';
import { PhoneVerification } from './phone-verification';
import { IdentityConfirmation } from './identity-confirmation';
import { useIntakeJourney } from './use-intake-journey';
import { IntakeChecklist } from './intake-checklist';
import { ConsentStep } from './consent-step';
import { FormStep } from './intake-form-step';
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
    resolvePickerSelection,
    handlePickerConfirmed,
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
      <IdentityConfirmation
        clinicName={org.name}
        logoUrl={org.logo_url}
        roomName={null}
        currentStep={2}
        totalSteps={totalSteps}
        existingPatients={pickerContacts.map((c) => ({
          ...c,
          date_of_birth: null,
        }))}
        token={token}
        phoneNumber={phoneNumber ?? ''}
        title="Please confirm who this appointment is for"
        subtitle={`We found more than one person on this phone number at ${org.name}.`}
        allowNewPatient={false}
        resolve={resolvePickerSelection}
        onConfirmed={handlePickerConfirmed}
      />
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
        <IntakeChecklist
          clinicName={org.name}
          logoUrl={org.logo_url}
          patientFirstName={patient?.first_name ?? null}
          items={items}
          itemsDone={itemsDone}
          onContinue={advanceFromChecklist}
        />
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
