"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatSessionTime, formatPatientName } from "@/lib/runsheet/format";
import { chargePayment } from "@/lib/runsheet/actions";
import type { EnrichedSession } from "@/lib/types/domain";

interface ProcessFlowPaymentProps {
  session: EnrichedSession;
  onNext: () => void;
}

export function ProcessFlowPayment({ session, onNext }: ProcessFlowPaymentProps) {
  const defaultAmount = session.default_fee_cents ?? 0;
  const [amountCents, setAmountCents] = useState(defaultAmount);
  const [editing, setEditing] = useState(false);
  // Separate string state for the input so the user can type freely without
  // the value snapping back to a formatted number on every keystroke.
  const [editValue, setEditValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentRequestUrl, setPaymentRequestUrl] = useState<string | null>(null);

  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name
  );

  async function handleCharge() {
    setLoading(true);
    setError(null);
    const result = await chargePayment(session.session_id, amountCents);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Payment failed");
      return;
    }

    // Some providers return a hosted payment URL to surface (e.g. a Tyro org
    // that hasn't switched to the clinic charge window). Show it; otherwise the
    // charge is immediate (Stripe stub / console) and we advance.
    if (result.paymentRequestUrl) {
      setPaymentRequestUrl(result.paymentRequestUrl);
      return;
    }

    onNext();
  }

  return (
    <div className="p-5 space-y-5">
      {/* Patient context */}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-800">{patientName}</p>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {session.type_name && <span>{session.type_name}</span>}
          {session.modality && (
            <>
              <span className="text-gray-200">|</span>
              <span>{session.modality === "telehealth" ? "Telehealth" : "In-person"}</span>
            </>
          )}
          {session.scheduled_at && (
            <>
              <span className="text-gray-200">|</span>
              <span>{formatSessionTime(session.scheduled_at)}</span>
            </>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Amount
        </label>
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-800">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                const parsed = parseFloat(editValue);
                if (!isNaN(parsed) && parsed >= 0) {
                  setAmountCents(Math.round(parsed * 100));
                }
              }}
              className="w-32 text-lg font-semibold text-gray-800 border border-gray-200 rounded-lg px-3 py-1 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const parsed = parseFloat(editValue);
                if (!isNaN(parsed) && parsed >= 0) {
                  setAmountCents(Math.round(parsed * 100));
                }
                setEditing(false);
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-gray-800">
              {formatCurrency(amountCents)}
            </span>
            <button
              onClick={() => {
                setEditValue((amountCents / 100).toFixed(2));
                setEditing(true);
              }}
              className="text-xs text-teal-500 hover:text-teal-600"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Card on file */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Card on file
        </label>
        {session.has_card_on_file ? (
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            <CardIcon brand={session.card_brand} />
            <span className="text-sm text-gray-800">
              {session.card_brand} ending in {session.card_last_four}
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No card stored</p>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Payment request link returned by the provider (e.g. Tyro hosted page).
          The patient completes payment here; staff can copy it or move on. */}
      {paymentRequestUrl && (
        <div className="space-y-2 p-3 bg-teal-50 rounded-lg">
          <p className="text-xs font-medium text-gray-800">
            Payment request created
          </p>
          <p className="text-xs text-gray-500">
            Send this link to the patient to complete payment, or open it to
            process on their behalf.
          </p>
          <div className="flex items-center gap-2">
            <a
              href={paymentRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate text-xs text-teal-600 underline"
            >
              {paymentRequestUrl}
            </a>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigator.clipboard?.writeText(paymentRequestUrl)}
            >
              Copy
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2 pt-2">
        {amountCents > 0 && session.has_card_on_file && !paymentRequestUrl && (
          <Button
            className="w-full"
            onClick={handleCharge}
            disabled={loading}
          >
            {loading ? "Charging..." : `Charge ${formatCurrency(amountCents)}`}
          </Button>
        )}
        {amountCents > 0 && !session.has_card_on_file && !paymentRequestUrl && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleCharge}
            disabled={loading}
          >
            {loading ? "Creating request..." : "Send payment request"}
          </Button>
        )}
        <button
          onClick={onNext}
          className="w-full text-center text-xs text-gray-500 hover:text-gray-800 py-2"
        >
          {paymentRequestUrl ? "Continue" : "Skip payment"}
        </button>
      </div>
    </div>
  );
}

function CardIcon({ brand }: { brand: string | null }) {
  return (
    <div className="h-8 w-12 bg-white border border-gray-200 rounded flex items-center justify-center text-[10px] font-medium text-gray-500">
      {brand ?? "Card"}
    </div>
  );
}
