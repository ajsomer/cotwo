"use client";

import { useState, useEffect, useCallback } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { fetchReviewData, intakeHandoffUrl } from "./review-prefetch-cache";

interface IntakePackageHandoffPanelProps {
  appointmentId: string;
  actionId: string;
  patientName: string;
  /**
   * Completion time of the intake_package action — seeds the header timestamp
   * before the fetch lands. A package can hold multiple forms with differing
   * per-form completion times, so the header uses the action's time, not a
   * single form's.
   */
  submittedAt?: string | null;
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
  submittedAt: seedSubmittedAt = null,
  onClose,
  onTranscribed,
}: IntakePackageHandoffPanelProps) {
  const [payload, setPayload] = useState<HandoffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PMS write-back gate: shown only when this appointment has pushable PMS-bound
  // form data (a form with field mappings + values). Plain "Complete" otherwise.
  const [pmsGate, setPmsGate] = useState<{ active: boolean; label: string } | null>(
    null
  );
  const [pushResults, setPushResults] = useState<
    Array<{ label: string; status: string; detail?: string }> | null
  >(null);

  const loadHandoff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReviewData(intakeHandoffUrl(appointmentId));
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

  // Resolve the PMS write-back gate for this appointment.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/pms/push-appointment?appointmentId=${appointmentId}`
        );
        if (cancelled) return;
        const data = res.ok
          ? ((await res.json()) as { active?: boolean; providerLabel?: string | null })
          : null;
        if (cancelled) return;
        setPmsGate(
          data?.active
            ? { active: true, label: data.providerLabel ?? "PMS" }
            : { active: false, label: "" }
        );
      } catch {
        if (!cancelled) setPmsGate({ active: false, label: "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  const markTranscribed = async (): Promise<boolean> => {
    const res = await fetch("/api/tasks/mark-intake-transcribed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: actionId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to mark as transcribed");
      return false;
    }
    return true;
  };

  const handleMarkTranscribed = async () => {
    setMarking(true);
    setError(null);
    try {
      if (await markTranscribed()) onTranscribed();
    } catch {
      setError("Network error");
    } finally {
      setMarking(false);
    }
  };

  // Sync to the PMS, render per-field results, then mark transcribed.
  const handleSyncAndComplete = async () => {
    setMarking(true);
    setError(null);
    setPushResults(null);
    try {
      const res = await fetch("/api/pms/push-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        submissions?: Array<{
          fields: Array<{ label: string; status: string; detail?: string }>;
        }>;
        error?: string;
      };
      if (res.ok && data.ok) {
        const fields = (data.submissions ?? []).flatMap((s) => s.fields);
        setPushResults(
          fields.map((f) => ({ label: f.label, status: f.status, detail: f.detail }))
        );
        await markTranscribed();
        // Leave the panel open so staff can see what landed; onTranscribed
        // refreshes the dashboard behind it.
        onTranscribed();
      } else {
        setError(data.error ?? "Sync failed.");
      }
    } catch {
      setError("Network error");
    } finally {
      setMarking(false);
    }
  };

  // Fetched action time overrides the seed once present.
  const submittedAt = payload?.action.completed_at ?? seedSubmittedAt;

  const header = (
    <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
      <div className="min-w-0">
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
      <button
        onClick={onClose}
        className="shrink-0 -mt-0.5 p-1 text-gray-500 hover:text-gray-800 transition-colors rounded"
        aria-label="Close"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Intake package completed"
      width="w-[420px]"
      customHeader={header}
    >
      <div className="flex h-full flex-col">
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

          {/* Per-field push results (after a Sync). */}
          {pushResults && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-1">
              <p className="text-xs font-medium text-gray-700">
                {pmsGate?.label ?? "PMS"} sync results
              </p>
              {pushResults.length === 0 && (
                <p className="text-xs text-gray-500">No fields to send.</p>
              )}
              {pushResults.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-700">{r.label}</span>
                  <span
                    className={
                      r.status === "written"
                        ? "text-green-600"
                        : r.status === "skipped_existing"
                          ? "text-amber-600"
                          : r.status === "failed"
                            ? "text-red-500"
                            : "text-gray-400"
                    }
                    title={r.detail}
                  >
                    {r.status === "written"
                      ? "Sent"
                      : r.status === "skipped_existing"
                        ? "Kept existing"
                        : r.status === "failed"
                          ? "Failed"
                          : "Coviu only"}
                  </span>
                </div>
              ))}
            </div>
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
            onClick={() =>
              window.open(
                `/api/tasks/intake-handoff/pdf?appointment_id=${appointmentId}`,
                "_blank",
              )
            }
            disabled={loading || !payload}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Download
          </button>
          {pmsGate?.active ? (
            <button
              onClick={handleSyncAndComplete}
              disabled={marking || loading || !payload}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {marking ? "Syncing…" : `Sync to ${pmsGate.label} & complete`}
            </button>
          ) : (
            <button
              onClick={handleMarkTranscribed}
              disabled={marking || loading || !payload}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {marking ? "Completing..." : "Complete"}
            </button>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
