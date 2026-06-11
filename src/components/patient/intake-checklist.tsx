'use client';

import { PersistentHeader } from './persistent-header';
import type { ItemSlot } from './use-intake-journey';

interface IntakeChecklistProps {
  clinicName: string;
  logoUrl: string | null;
  patientFirstName: string | null;
  items: ItemSlot[];
  itemsDone: number;
  onContinue: () => void;
}

export function IntakeChecklist({
  clinicName,
  logoUrl,
  patientFirstName,
  items,
  itemsDone,
  onContinue,
}: IntakeChecklistProps) {
  return (
    <div className="flex flex-col items-center">
      <PersistentHeader clinicName={clinicName} logoUrl={logoUrl} />
      <div className="w-full space-y-4">
        <h1 className="text-xl font-semibold text-gray-800">
          {patientFirstName ? `Hi ${patientFirstName}` : 'Your intake'}
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
          onClick={onContinue}
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
