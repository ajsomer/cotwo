'use client';

import Image from 'next/image';

interface PersistentHeaderProps {
  clinicName: string;
  logoUrl: string | null;
  roomName?: string | null;
  currentStep?: number;
  totalSteps?: number;
}

export function PersistentHeader({
  clinicName,
  logoUrl,
  roomName,
  currentStep,
  totalSteps,
}: PersistentHeaderProps) {
  return (
    <div className="mb-6 flex flex-col items-center gap-2">
      {/* Clinic logo */}
      {logoUrl ? (
        <div className="relative h-12 w-32">
          <Image
            src={logoUrl}
            alt={`${clinicName} logo`}
            fill
            className="object-contain"
            unoptimized
          />
        </div>
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
          <span className="text-lg font-semibold text-teal-600">
            {clinicName.charAt(0)}
          </span>
        </div>
      )}

      {/* Clinic name */}
      <h2 className="text-center text-sm font-medium text-gray-500">
        {clinicName}
      </h2>

      {/* Room name */}
      {roomName && (
        <p className="text-center text-xs text-gray-400">{roomName}</p>
      )}

      {/* Stepper */}
      {currentStep !== undefined && totalSteps !== undefined && totalSteps > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          {Array.from({ length: totalSteps }, (_, i) => {
            const stepNum = i + 1;
            const isCompleted = stepNum < currentStep;
            const isCurrent = stepNum === currentStep;

            return (
              <div
                key={i}
                className={`h-2 rounded-full transition-all ${
                  isCurrent
                    ? 'w-6 bg-teal-500'
                    : isCompleted
                      ? 'w-2 bg-teal-500'
                      : 'w-2 bg-gray-200'
                }`}
                role="presentation"
                aria-current={isCurrent ? 'step' : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
