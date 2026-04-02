'use client';

import { PersistentHeader } from './persistent-header';

interface PrimerScreenProps {
  clinicName: string;
  logoUrl: string | null;
  roomName: string | null;
  paymentsEnabled: boolean;
  onStart: () => void;
}

export function PrimerScreen({
  clinicName,
  logoUrl,
  roomName,
  paymentsEnabled,
  onStart,
}: PrimerScreenProps) {
  const paymentText = paymentsEnabled
    ? ', and store a payment method'
    : '';

  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        roomName={roomName}
      />

      <div className="w-full space-y-6 text-center">
        <h1 className="text-2xl font-semibold text-gray-800">
          Welcome to {clinicName}
        </h1>

        <p className="text-sm leading-relaxed text-gray-500">
          Before your appointment, we&apos;ll ask you to verify your phone
          number, confirm your details{paymentText}. This takes about 2 minutes.
        </p>

        <button
          onClick={onStart}
          className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600 active:bg-teal-700"
        >
          Get started
        </button>
      </div>
    </div>
  );
}
