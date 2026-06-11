"use client";

import { useState, useEffect, useCallback } from "react";
import { getJson, postJson } from "@/lib/api-client";
import { SlideOver } from "@/components/ui/slide-over";
import { CloseButton } from "@/components/ui/close-button";
import { usePmsConnection } from "@/hooks/usePmsConnection";
import { formatDayMonthTime } from "@/lib/runsheet/format";
import { fetchReviewData, intakeHandoffUrl } from "./review-prefetch-cache";
import {
  FieldRow,
  ReviewCopyButton,
  ReviewFooter,
  ReviewFooterButton,
  ReviewSkeleton,
} from "./review-panel-parts";

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

export function IntakePackageHandoffPanel({
  appointmentId,
  actionId,
  patientName,
  submittedAt: seedSubmittedAt = null,
  onClose,
  onTranscribed,
}: IntakePackageHandoffPanelProps) {
  const { syncActive: pmsSyncActive } = usePmsConnection();
  const [payload, setPayload] = useState<HandoffPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PMS write-back gate: shown when this appointment has pushable PMS-bound
  // form data OR an intake PDF the provider can take (attachment-only path,
  // e.g. Nookal with writeForms:false). Plain "Complete" otherwise.
  // writeAttachments / hasPushableFields gate the two halves of the sync.
  const [pmsGate, setPmsGate] = useState<{
    active: boolean;
    label: string;
    writeAttachments: boolean;
    hasPushableFields: boolean;
  } | null>(null);
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

  // Resolve the PMS write-back gate for this appointment — but only when the
  // location has a sync-active PMS (from shared context). This gate is still
  // per-appointment (it checks for pushable field data), so it needs its own
  // call, but gating on syncActive avoids firing it when there's no PMS.
  useEffect(() => {
    let cancelled = false;
    const inactive = {
      active: false,
      label: "",
      writeAttachments: false,
      hasPushableFields: false,
    };
    if (!pmsSyncActive) {
      setPmsGate(inactive);
      return;
    }
    (async () => {
      const result = await getJson<{
        active?: boolean;
        providerLabel?: string | null;
        writeAttachments?: boolean;
        hasPushableFields?: boolean;
      }>(`/api/pms/push-appointment?appointmentId=${appointmentId}`);
      if (cancelled) return;
      const data = result.ok ? result.data : null;
      setPmsGate(
        data?.active
          ? {
              active: true,
              label: data.providerLabel ?? "PMS",
              writeAttachments: data.writeAttachments === true,
              hasPushableFields: data.hasPushableFields === true,
            }
          : inactive
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [appointmentId, pmsSyncActive]);

  const markTranscribed = async (): Promise<boolean> => {
    const result = await postJson(
      "/api/tasks/mark-intake-transcribed",
      { action_id: actionId },
      "Failed to mark as transcribed"
    );
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    return true;
  };

  const handleMarkTranscribed = async () => {
    setMarking(true);
    setError(null);
    if (await markTranscribed()) onTranscribed();
    setMarking(false);
  };

  // Sync to the PMS: push the field write-back AND — when the provider supports
  // attachments — attach the intake PDF in one action, then render per-field
  // results + the attachment outcome. Does NOT complete — that's a separate
  // action, so staff review what landed first.
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  const handleSync = async () => {
    setMarking(true);
    setError(null);
    setPushResults(null);
    setAttachMsg(null);
    try {
      const [fieldRes, attachRes] = await Promise.all([
        // Skip the field half when there's no mapped data to push
        // (attachment-only sync, e.g. Nookal's document path).
        pmsGate?.hasPushableFields
          ? fetch("/api/pms/push-appointment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ appointmentId }),
            })
          : Promise.resolve(null),
        // Skip the attach half entirely for providers without writeAttachments
        // (it would just error with "doesn't support attachments").
        pmsGate?.writeAttachments
          ? fetch("/api/pms/attach-pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ appointmentId }),
            })
          : Promise.resolve(null),
      ]);

      if (fieldRes) {
        const fieldData = (await fieldRes.json().catch(() => ({}))) as {
          ok?: boolean;
          submissions?: Array<{
            fields: Array<{ label: string; status: string; detail?: string }>;
          }>;
          error?: string;
        };
        if (fieldRes.ok && fieldData.ok) {
          const fields = (fieldData.submissions ?? []).flatMap((s) => s.fields);
          setPushResults(
            fields.map((f) => ({ label: f.label, status: f.status, detail: f.detail }))
          );
        } else {
          setError(fieldData.error ?? "Field sync failed.");
        }
      }

      if (attachRes) {
        const attachData = (await attachRes.json().catch(() => ({}))) as {
          ok?: boolean;
          detail?: string;
          error?: string;
        };
        setAttachMsg(
          attachRes.ok && attachData.ok
            ? `Intake PDF attached to ${pmsGate?.label ?? "the PMS"}.`
            : `PDF: ${attachData.detail ?? attachData.error ?? "couldn't attach."}`
        );
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
              &middot; Submitted {formatDayMonthTime(submittedAt)}
            </>
          )}
        </p>
      </div>
      <CloseButton
        onClick={onClose}
        className="shrink-0 -mt-0.5 p-1 text-gray-500 hover:text-gray-800 transition-colors rounded"
      />
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
            <ReviewSkeleton />
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
                            Submitted {formatDayMonthTime(form.submitted_at)}
                          </p>
                        )}
                      </div>
                      {form.fields.length > 0 && (
                        <ReviewCopyButton text={allText} label="Copy all" />
                      )}
                    </div>

                    {form.fields.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        No submission data available.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {form.fields.map((field, i) => (
                          <FieldRow
                            key={i}
                            label={field.label}
                            value={field.value}
                          />
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
                      &middot; captured {formatDayMonthTime(payload.card.captured_at)}
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
                    Recorded {formatDayMonthTime(payload.consent.completed_at)}
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

          {/* Per-field push results and/or attach outcome (after a Sync). */}
          {(pushResults || attachMsg) && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-1">
              <p className="text-xs font-medium text-gray-700">
                {pmsGate?.label ?? "PMS"} sync results
              </p>
              {pushResults?.length === 0 && (
                <p className="text-xs text-gray-500">No fields to send.</p>
              )}
              {(pushResults ?? []).map((r, i) => (
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
              {attachMsg && (
                <p className="pt-1 mt-1 border-t border-gray-100 text-xs text-gray-600">
                  {attachMsg}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <ReviewFooter>
          <ReviewFooterButton onClick={onClose}>Back</ReviewFooterButton>
          <ReviewFooterButton
            onClick={() =>
              window.open(
                `/api/tasks/intake-handoff/pdf?appointment_id=${appointmentId}`,
                "_blank",
              )
            }
            disabled={loading || !payload}
          >
            Download
          </ReviewFooterButton>
          {pmsGate?.active && (
            <ReviewFooterButton
              variant="tealOutline"
              onClick={handleSync}
              disabled={marking || loading || !payload}
            >
              {marking ? "Syncing…" : `Sync to ${pmsGate.label}`}
            </ReviewFooterButton>
          )}
          <ReviewFooterButton
            variant="primary"
            onClick={handleMarkTranscribed}
            disabled={marking || loading || !payload}
          >
            {marking ? "Completing..." : "Complete"}
          </ReviewFooterButton>
        </ReviewFooter>
      </div>
    </SlideOver>
  );
}
