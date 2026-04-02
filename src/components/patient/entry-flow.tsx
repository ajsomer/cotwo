'use client';

import { useState, useCallback } from 'react';
import { EntryContext, PatientContact } from '@/lib/supabase/types';
import { PrimerScreen } from './primer-screen';
import { PhoneVerification } from './phone-verification';
import { IdentityConfirmation } from './identity-confirmation';
import { CardCapture } from './card-capture';
import { DeviceTest } from './device-test';
import { PersistentHeader } from './persistent-header';
import { useRouter } from 'next/navigation';

type FlowStep = 'primer' | 'phone' | 'identity' | 'card' | 'device_test' | 'arriving';

interface EntryFlowProps {
  context: EntryContext;
  token: string;
}

export function EntryFlow({ context, token }: EntryFlowProps) {
  const router = useRouter();

  const [step, setStep] = useState<FlowStep>('primer');
  const [phoneNumber, setPhoneNumber] = useState<string | null>(
    context.session?.phone_number || null
  );
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [existingPatients, setExistingPatients] = useState<PatientContact[]>([]);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(
    context.session?.id || null
  );
  const [error, setError] = useState<string | null>(null);

  // Calculate dynamic steps
  const steps: FlowStep[] = ['phone', 'identity'];
  if (context.payments_enabled) steps.push('card');
  steps.push('device_test'); // Telehealth always gets device test
  const totalSteps = steps.length;

  const currentStepIndex = steps.indexOf(step);
  const currentStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : undefined;

  // Step handlers
  const handleStart = useCallback(() => {
    setStep('phone');
  }, []);

  const handlePhoneVerified = useCallback(
    (phone: string, vId: string, patients: PatientContact[]) => {
      setPhoneNumber(phone);
      setVerificationId(vId);
      setExistingPatients(patients);
      setStep('identity');
    },
    []
  );

  const handleIdentityConfirmed = useCallback(
    (patient: PatientContact) => {
      setPatientId(patient.id);
      setPatientName(`${patient.first_name} ${patient.last_name}`);

      if (context.payments_enabled) {
        setStep('card');
      } else {
        setStep('device_test');
      }
    },
    [context.payments_enabled]
  );

  const handleCardComplete = useCallback(() => {
    setStep('device_test');
  }, []);

  const handleDeviceTestComplete = useCallback(
    async (passed: boolean) => {
      setStep('arriving');
      setError(null);

      try {
        const body: Record<string, unknown> = {
          session_id: sessionId,
          patient_id: patientId,
          device_tested: passed,
          modality: 'telehealth',
        };

        // For on-demand entries, include room and location for session creation
        if (!sessionId && context.room && context.location) {
          body.room_id = context.room.id;
          body.location_id = context.location.id;
        }

        const res = await fetch('/api/patient/arrive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Failed to join');
          setStep('device_test');
          return;
        }

        // Navigate to waiting room
        const waitingToken = data.entry_token || context.session?.entry_token || token;
        router.push(`/waiting/${waitingToken}`);
      } catch {
        setError('Something went wrong. Please try again.');
        setStep('device_test');
      }
    },
    [sessionId, patientId, context, token, router]
  );

  // Error state for cancelled/invalid sessions
  if (context.session?.status === 'done' || context.session?.status === 'complete') {
    return (
      <div className="flex flex-col items-center text-center">
        <PersistentHeader
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
          roomName={context.room?.name || null}
        />
        <div className="space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">
            This session has ended
          </h1>
          <p className="text-sm text-gray-500">
            This appointment has already been completed. Please contact{' '}
            {context.org.name} if you have questions.
          </p>
        </div>
      </div>
    );
  }

  // Already in waiting room — redirect
  if (context.session?.status === 'waiting' || context.session?.status === 'in_session') {
    if (typeof window !== 'undefined') {
      router.push(`/waiting/${token}`);
    }
    return null;
  }

  switch (step) {
    case 'primer':
      return (
        <PrimerScreen
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
          roomName={context.room?.name || null}
          paymentsEnabled={context.payments_enabled}
          onStart={handleStart}
        />
      );

    case 'phone':
      return (
        <PhoneVerification
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
          roomName={context.room?.name || null}
          currentStep={currentStepNumber!}
          totalSteps={totalSteps}
          prefillPhone={phoneNumber}
          sessionId={sessionId}
          orgId={context.org.id}
          onVerified={handlePhoneVerified}
        />
      );

    case 'identity':
      return (
        <IdentityConfirmation
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
          roomName={context.room?.name || null}
          currentStep={currentStepNumber!}
          totalSteps={totalSteps}
          existingPatients={existingPatients}
          sessionId={sessionId}
          orgId={context.org.id}
          phoneNumber={phoneNumber!}
          onConfirmed={handleIdentityConfirmed}
        />
      );

    case 'card':
      return (
        <CardCapture
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
          roomName={context.room?.name || null}
          currentStep={currentStepNumber!}
          totalSteps={totalSteps}
          patientId={patientId!}
          sessionId={sessionId}
          stripeAccountId={context.location.stripe_account_id}
          onComplete={handleCardComplete}
        />
      );

    case 'device_test':
      return (
        <>
          <DeviceTest
            clinicName={context.org.name}
            logoUrl={context.org.logo_url}
            roomName={context.room?.name || null}
            currentStep={currentStepNumber!}
            totalSteps={totalSteps}
            onComplete={handleDeviceTestComplete}
          />
          {error && (
            <p className="mt-4 text-center text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
        </>
      );

    case 'arriving':
      return (
        <div className="flex flex-col items-center">
          <PersistentHeader
            clinicName={context.org.name}
            logoUrl={context.org.logo_url}
            roomName={context.room?.name || null}
          />
          <div className="flex h-32 w-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
          </div>
          <p className="text-sm text-gray-500">Joining waiting room...</p>
        </div>
      );
  }
}
