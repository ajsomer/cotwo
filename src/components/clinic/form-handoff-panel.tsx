"use client";

import { useState, useEffect } from "react";
import { SlideOver } from "@/components/ui/slide-over";

interface FormHandoffPanelProps {
  actionId: string;
  formName: string;
  patientName: string;
  appointmentId: string;
  onClose: () => void;
  onTranscribed: () => void;
}

interface FormField {
  label: string;
  value: string;
}

function CopyButton({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`shrink-0 ${
        small
          ? "text-[10px] text-gray-400 hover:text-teal-600"
          : "rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
      }`}
    >
      {copied ? (small ? "\u2713" : "Copied!") : small ? "Copy" : "Copy all fields"}
    </button>
  );
}

export function FormHandoffPanel({
  actionId,
  formName,
  patientName,
  appointmentId,
  onClose,
  onTranscribed,
}: FormHandoffPanelProps) {
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  useEffect(() => {
    loadFormData();
  }, [appointmentId]);

  async function loadFormData() {
    try {
      // Fetch form submission for this appointment
      const res = await fetch(
        `/api/readiness/form-submission?appointment_id=${appointmentId}&form_name=${encodeURIComponent(formName)}`
      );

      if (res.ok) {
        const data = await res.json();
        setFields(data.fields ?? []);
        setSubmittedAt(data.submitted_at ?? null);
      } else {
        // If no dedicated endpoint exists, show a message
        setFields([]);
        setError("Form submission data not available for review.");
      }
    } catch {
      setError("Failed to load form data");
    } finally {
      setLoading(false);
    }
  }

  const handleMarkTranscribed = async () => {
    setMarking(true);
    setError(null);

    try {
      const res = await fetch("/api/readiness/mark-transcribed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: actionId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to mark as transcribed");
        return;
      }

      onTranscribed();
    } catch {
      setError("Network error");
    } finally {
      setMarking(false);
    }
  };

  const allFieldsText = fields
    .map((f) => `${f.label}: ${f.value}`)
    .join("\n");

  return (
    <SlideOver open onClose={onClose} title="" width="w-[420px]">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-800">
            Form completed: {formName}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {patientName}
            {submittedAt && (
              <>
                {" "}
                &middot; Submitted{" "}
                {new Date(submittedAt).toLocaleString("en-AU", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </>
            )}
          </p>
        </div>

        {/* Field list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-1/3 mb-1" />
                  <div className="h-4 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : fields.length > 0 ? (
            <>
              {/* Bulk copy */}
              <div className="mb-4">
                <CopyButton text={allFieldsText} />
              </div>

              <div className="space-y-3">
                {fields.map((field, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                        {field.label}
                      </p>
                      <p className="text-sm text-gray-800 break-words">
                        {field.value || "—"}
                      </p>
                    </div>
                    <CopyButton text={field.value} small />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">
                {error ?? "No form fields to display"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                The patient may not have submitted the form yet, or the
                submission data is not available for inline review.
              </p>
            </div>
          )}

          {error && fields.length > 0 && (
            <p className="text-xs text-red-500 mt-4">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={handleMarkTranscribed}
            disabled={marking}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {marking ? "Marking..." : "Mark as transcribed"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
