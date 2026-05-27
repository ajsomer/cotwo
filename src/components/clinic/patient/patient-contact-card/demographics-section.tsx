"use client";

import { formatPhoneNumber } from "@/lib/runsheet/format";
import type { PatientDetails } from "./types";

interface DemographicsSectionProps {
  details: PatientDetails;
  onTakePayment: () => void;
  onSendSms: () => void;
  // Readiness mode adds a delete affordance below the quick actions.
  readinessActions?: React.ReactNode;
}

export function DemographicsSection({
  details,
  onTakePayment,
  onSendSms,
  readinessActions,
}: DemographicsSectionProps) {
  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <div className="h-12 w-12 rounded-full bg-teal-50 flex items-center justify-center">
          <span className="text-base font-semibold text-teal-600">
            {details.patient.first_name[0]}
            {details.patient.last_name[0]}
          </span>
        </div>
        <h3 className="text-xl font-semibold text-gray-800">
          {details.patient.first_name} {details.patient.last_name}
        </h3>
        {details.patient.date_of_birth && (
          <p className="text-sm text-gray-500">
            DOB: {formatDob(details.patient.date_of_birth)}
          </p>
        )}

        {/* Quick actions */}
        <div className="flex items-center gap-2 pt-1">
          {details.payment_methods.length > 0 && (
            <QuickActionButton
              icon={<CreditCardIcon />}
              label="Take payment"
              onClick={onTakePayment}
            />
          )}
          <QuickActionButton
            icon={<SmsIcon />}
            label="Send SMS"
            onClick={onSendSms}
          />
        </div>

        {readinessActions}
      </div>

      <div className="h-px bg-gray-200" />

      {/* Contact */}
      <section>
        <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
          Contact
        </h4>
        <div className="space-y-1.5">
          {details.phone_numbers.map((p) => (
            <div
              key={p.phone_number}
              className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
            >
              <PhoneIcon />
              <span className="text-sm text-gray-800">
                {formatPhoneNumber(p.phone_number)}
              </span>
              {details.phone_numbers.length > 1 && p.is_primary && (
                <span className="text-[10px] font-medium uppercase text-gray-400 ml-auto">
                  Primary
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function PaymentSection({ details }: { details: PatientDetails }) {
  return (
    <section>
      <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
        Payment
      </h4>
      {details.payment_methods.length > 0 ? (
        <div className="space-y-1.5">
          {details.payment_methods.map((pm, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
            >
              <CreditCardIcon />
              <div>
                <span className="text-sm text-gray-800">
                  {capitalise(pm.card_brand)} ending {pm.card_last_four}
                </span>
                {pm.card_expiry && (
                  <p className="text-xs text-gray-400">
                    Expires {pm.card_expiry}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No card on file</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDob(dob: string): string {
  const date = new Date(dob + "T00:00:00");
  const formatted = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const age = Math.floor(
    (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
  return `${formatted} (${age})`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PhoneIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-400 flex-shrink-0"
    >
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function QuickActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300"
    >
      {icon}
      {label}
    </button>
  );
}

function CreditCardIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-400 flex-shrink-0"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-400 flex-shrink-0"
    >
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
