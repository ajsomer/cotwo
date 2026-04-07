'use client';

import { useState } from 'react';
import { PersistentHeader } from './persistent-header';
import { PatientContact } from '@/lib/supabase/types';

interface IdentityConfirmationProps {
  clinicName: string;
  logoUrl: string | null;
  roomName: string | null;
  currentStep: number;
  totalSteps: number;
  existingPatients: PatientContact[];
  sessionId: string | null;
  orgId: string;
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
  sessionId,
  orgId,
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

    try {
      const res = await fetch('/api/patient/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existing_patient_id: patientId,
          session_id: sessionId,
          org_id: orgId,
          phone_number: phoneNumber,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to confirm identity');
        return;
      }

      onConfirmed(data.patient);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const createNew = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/patient/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          date_of_birth: dob || null,
          session_id: sessionId,
          org_id: orgId,
          phone_number: phoneNumber,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create patient');
        return;
      }

      onConfirmed(data.patient);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
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

            <div>
              <label htmlFor="firstName" className="mb-1 block text-xs font-medium text-gray-500">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-12 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label htmlFor="lastName" className="mb-1 block text-xs font-medium text-gray-500">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-12 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label htmlFor="dob" className="mb-1 block text-xs font-medium text-gray-500">
                Date of birth
              </label>
              <input
                id="dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="h-12 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </div>

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
