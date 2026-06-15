"use client";

import { SlideOver } from "@/components/ui/slide-over";
import { formatPhoneNumber } from "@/lib/runsheet/format";

interface UnknownCallerCardProps {
  open: boolean;
  /** Caller number (E.164 where parseable, else the raw/"Unknown" string). */
  number: string | null;
  onClose: () => void;
}

/**
 * Generic panel shown when an inbound call's number doesn't match any patient
 * (call-pop test trigger). Surfaces the absent record — the "see what is not
 * there" value — rather than failing silently.
 */
export function UnknownCallerCard({ open, number, onClose }: UnknownCallerCardProps) {
  const display = (number && formatPhoneNumber(number)) || number || "Unknown";

  return (
    <SlideOver open={open} onClose={onClose} title="Incoming call">
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <PhoneIcon />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-800">Unknown caller</p>
            <p className="font-mono text-sm text-gray-600">{display}</p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            No patient record matches this number. They may be a new patient, or
            calling from a different phone.
          </p>
        </div>
      </div>
    </SlideOver>
  );
}

function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
