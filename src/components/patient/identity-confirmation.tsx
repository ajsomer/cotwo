'use client';

import { useState } from 'react';
import { postJson } from '@/lib/api-client';
import { PersistentHeader } from './persistent-header';
import { FormField, TextInput } from '@/components/ui/input';
import { PatientContact } from '@/lib/types/domain';

interface IdentityConfirmationProps {
  clinicName: string;
  logoUrl: string | null;
  roomName: string | null;
  currentStep: number;
  totalSteps: number;
  existingPatients: PatientContact[];
  token: string;
  phoneNumber: string;
  onConfirmed: (patient: PatientContact) => void;
}

type Mode = 'select_multiple' | 'new_patient';

export function IdentityConfirmation({
  clinicName,
  logoUrl,
  roomName,
  currentStep,
  totalSteps,
  existingPatients,
  token,
  phoneNumber,
  onConfirmed,
}: IdentityConfirmationProps) {
  const initialMode: Mode =
    existingPatients.length === 0
      ? 'new_patient'
      : 'select_multiple';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const confirmExisting = async (patientId: string) => {
    setLoading(true);
    setError(null);

    const result = await postJson<{ patient: PatientContact }>(
      '/api/patient/identity',
      {
        token,
        existing_patient_id: patientId,
        phone_number: phoneNumber,
      },
      'Failed to confirm identity'
    );
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onConfirmed(result.data.patient);
  };

  const createNew = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await postJson<{ patient: PatientContact }>(
      '/api/patient/identity',
      {
        token,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dob || null,
        phone_number: phoneNumber,
      },
      'Failed to create patient'
    );
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onConfirmed(result.data.patient);
  };

  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        roomName={roomName}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />

      <div className="w-full space-y-4">
        {/* Patient list: always a list of cards + "Someone else" */}
        {mode === 'select_multiple' && (
          <>
            <h1 className="text-xl font-semibold text-gray-800">
              Who is this appointment for?
            </h1>

            <div className="space-y-2">
              {existingPatients.map((patient) => (
                <button
                  key={patient.id}
                  onClick={() => confirmExisting(patient.id)}
                  disabled={loading}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-teal-500 hover:bg-teal-50 disabled:opacity-50"
                >
                  <span className="text-base font-medium text-gray-800">
                    {patient.first_name} {patient.last_name}
                  </span>
                  {patient.date_of_birth && (
                    <span className="ml-2 text-sm text-gray-400">
                      DOB: {patient.date_of_birth}
                    </span>
                  )}
                </button>
              ))}

              <button
                onClick={() => setMode('new_patient')}
                disabled={loading}
                className="w-full rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-left transition-colors hover:border-teal-500 hover:bg-teal-50 disabled:opacity-50"
              >
                <span className="text-base font-medium text-teal-500">
                  Someone else
                </span>
              </button>
            </div>
          </>
        )}

        {/* New patient: capture form */}
        {mode === 'new_patient' && (
          <>
            <h1 className="text-xl font-semibold text-gray-800">
              Your details
            </h1>

            <FormField label="First name" htmlFor="firstName">
              <TextInput
                id="firstName"
                type="text"
                inputSize="lg"
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </FormField>

            <FormField label="Last name" htmlFor="lastName">
              <TextInput
                id="lastName"
                type="text"
                inputSize="lg"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </FormField>

            <FormField label="Date of birth" htmlFor="dob">
              <TextInput
                id="dob"
                type="date"
                inputSize="lg"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </FormField>

            <button
              onClick={createNew}
              disabled={!firstName.trim() || !lastName.trim() || loading}
              className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Continue'}
            </button>

            {existingPatients.length > 0 && (
              <button
                onClick={() => setMode('select_multiple')}
                className="w-full text-center text-sm text-gray-400 hover:text-gray-600"
              >
                Back
              </button>
            )}
          </>
        )}

        {error && (
          <p className="text-center text-sm text-red-500" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
