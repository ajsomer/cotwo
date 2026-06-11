'use client';

import { useState } from 'react';
import { postJson } from '@/lib/api-client';
import { PersistentHeader } from './persistent-header';

interface ConsentStepProps {
  clinicName: string;
  logoUrl: string | null;
  currentStep: number;
  totalSteps: number;
  token: string;
  onComplete: () => void;
}

export function ConsentStep({
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
