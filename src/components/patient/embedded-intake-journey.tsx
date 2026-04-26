'use client';

import { useEffect, useState } from 'react';
import { IntakeJourney, IntakeJourneyContext } from './intake-journey';
import type { PatientContact } from '@/lib/supabase/types';

interface EmbeddedIntakeJourneyProps {
  token: string;
  preConfirmedPatient: PatientContact;
  onAllItemsComplete: () => void;
}

/**
 * Embedded host for `<IntakeJourney>` used inside the arrival-flow gate.
 * Fetches the heavy `IntakeJourneyContext` from `GET /api/intake/[token]`
 * and renders the underlying journey with `skipIdentity` set, since the
 * arrival flow has already verified the patient.
 */
export function EmbeddedIntakeJourney({
  token,
  preConfirmedPatient,
  onAllItemsComplete,
}: EmbeddedIntakeJourneyProps) {
  const [context, setContext] = useState<IntakeJourneyContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/intake/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load intake (${res.status})`);
        return res.json();
      })
      .then((data: IntakeJourneyContext) => {
        if (cancelled) return;
        setContext(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load intake');
      });

    return () => {
      cancelled = true;
    };
  }, [token, retry]);

  // Resetting on retry is handled by the key prop on the wrapper at the
  // call-site (the embedded host re-mounts with a new key per journey token),
  // so we don't need to clear state inside this effect.

  if (error) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <span className="text-lg text-red-500">!</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-800">
          Couldn&apos;t load your intake
        </h1>
        <p className="mt-2 text-sm text-gray-500">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setContext(null);
            setRetry((n) => n + 1);
          }}
          className="mt-4 rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="flex h-32 w-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <IntakeJourney
      context={context}
      token={token}
      skipIdentity
      preConfirmedPatient={preConfirmedPatient}
      onAllItemsComplete={onAllItemsComplete}
    />
  );
}
