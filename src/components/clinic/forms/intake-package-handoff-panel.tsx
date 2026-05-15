"use client";

import { useState, useEffect, useCallback } from "react";
import { SlideOver } from "@/components/ui/slide-over";

interface IntakePackageHandoffPanelProps {
  appointmentId: string;
  actionId: string;
  patientName: string;
  onClose: () => void;
  onTranscribed: () => void;
}

interface FormField {
  label: string;
  value: string;
}

interface FormBlock {
  form_id: string;
  form_name: string;
  submitted_at: string | null;
  fields: FormField[];
}

interface HandoffPayload {
  action: {
    id: string;
    status: string;
    completed_at: string | null;
  };
  forms: FormBlock[];
  card: { brand: string; last_four: string; captured_at: string } | null;
  consent: { completed_at: string } | null;
}

function CopyButton({ text, small, label }: { text: string; small?: boolean; label?: string }) {
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
      {copied ? (small ? "\u2713" : "Copied!") : small ? "Copy" : label ?? "Copy all fields"}
    </button>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function IntakePackageHandoffPanel({
  appointmentId,
  actionId,
  patientName,
  onClose,
  onTranscribed,
}: IntakePackageHandoffPanelProps) {
  const [payload, setPayload] = useState<HandoffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHandoff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/readiness/intake-handoff?appointment_id=${appointmentId}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to load intake package");
        setPayload(null);
        return;
      }
      const data = (await res.json()) as HandoffPayload;
      setPayload(data);
    } catch {
      setError("Failed to load intake package");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    loadHandoff();
  }, [loadHandoff]);

  const handleMarkTranscribed = async () => {
    setMarking(true);
    setError(null);
    try {
      const res = await fetch("/api/readiness/mark-intake-transcribed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: actionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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

  const submittedAt = payload?.action.completed_at;

  return (
    <SlideOver open onClose={onClose} title="" width="w-[420px]">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-800">
            Intake package completed
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {patientName}
            {submittedAt && (
              <>
                {" "}
                &middot; Submitted {formatTimestamp(submittedAt)}
              </>
            )}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-1/3 mb-1" />
                  <div className="h-4 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : payload ? (
            <>
              {/* Forms */}
              {payload.forms.length === 0 && !payload.card && !payload.consent ? (
                <p className="text-sm text-gray-500">
                  Nothing to review — the package had no items.
                </p>
              ) : null}

              {payload.forms.map((form) => {
                const allText = form.fields
                  .map((f) => `${f.label}: ${f.value}`)
                  .join("\n");
                return (
                  <div key={form.form_id} className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                          {form.form_name}
                        </p>
                        {form.submitted_at && (
                          <p className="text-[10px] text-gray-400">
                            Submitted {formatTimestamp(form.submitted_at)}
                          </p>
                        )}
                      </div>
                      {form.fields.length > 0 && (
                        <CopyButton text={allText} label="Copy all" />
                      )}
                    </div>

                    {form.fields.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        No submission data available.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {form.fields.map((field, i) => (
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
                    )}
                  </div>
                );
              })}

              {/* Card on file */}
              {payload.card && (
                <div className="rounded-lg border border-gray-100 px-3 py-2">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                    Card on file
                  </p>
                  <p className="text-sm text-gray-800">
                    {payload.card.brand}
                    {payload.card.last_four ? ` ending ${payload.card.last_four}` : ""}{" "}
                    <span className="text-gray-400">
                      &middot; captured {formatTimestamp(payload.card.captured_at)}
                    </span>
                  </p>
                </div>
              )}

              {/* Consent */}
              {payload.consent && (
                <div className="rounded-lg border border-gray-100 px-3 py-2">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                    Consent
                  </p>
                  <p className="text-sm text-gray-800">
                    Recorded {formatTimestamp(payload.consent.completed_at)}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">
              {error ?? "No data to display"}
            </p>
          )}

          {error && payload && (
            <p className="text-xs text-red-500">{error}</p>
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
            disabled={marking || loading || !payload}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {marking ? "Marking..." : "Mark as transcribed"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
