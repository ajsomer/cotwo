"use client";

import { useEffect, useState } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { useLocation } from "@/hooks/useLocation";
import { usePmsConnection } from "@/hooks/usePmsConnection";
import type { EnrichedSession } from "@/lib/types/domain";
import type { ReadinessAppointment, WorkflowAction } from "@/stores/clinic-store";
import { DemographicsSection, PaymentSection } from "./demographics-section";
import { AppointmentsSection } from "./appointments-section";
import { CompletedFormsList } from "./forms-section";
import { WorkflowsSection } from "./workflows-section";
import { ReadinessActions } from "./readiness-actions";
import type {
  PatientDetails,
  PatientSeed,
  PatientSummaryResponse,
  PatientHistoryResponse,
} from "./types";
import {
  summaryCache,
  historyCache,
  cacheSummary,
  cacheHistory,
  patientSummaryUrl,
  patientHistoryUrl,
} from "./patient-details-cache";

interface PatientContactCardProps {
  session?: EnrichedSession | null;
  patientId?: string | null;
  open: boolean;
  onClose: () => void;
  // Readiness-specific (optional — omit for run sheet usage)
  appointment?: ReadinessAppointment | null;
  // Generic seed for instant-open when there's no readiness appointment
  // (e.g. standalone form rows). Lower priority than `appointment`.
  patientSeed?: PatientSeed | null;
  onDeleted?: () => void;
}

/**
 * Build a synthetic shell `PatientDetails` from the row data we already have,
 * so the panel can paint immediately. Fields the row genuinely knows (name,
 * primary phone) are seeded; everything else is empty and gated behind a
 * per-section loading flag, never rendered as a false "none". Priority:
 * readiness `appointment` → generic `patientSeed` → null (no shell).
 */
function buildShell(
  patientId: string,
  appointment: ReadinessAppointment | null | undefined,
  seed: PatientSeed | null | undefined
): PatientDetails | null {
  let firstName: string | null = null;
  let lastName: string | null = null;
  let primaryPhone: string | null | undefined;

  if (appointment) {
    firstName = appointment.patient_first_name;
    lastName = appointment.patient_last_name;
    primaryPhone = appointment.primary_phone;
  } else if (seed) {
    firstName = seed.firstName;
    lastName = seed.lastName;
    primaryPhone = seed.primaryPhone;
  }

  if (firstName === null) return null;

  return {
    patient: {
      id: patientId,
      first_name: firstName,
      last_name: lastName ?? "",
      date_of_birth: null, // filled by summary fetch
    },
    phone_numbers: primaryPhone
      ? [{ phone_number: primaryPhone, is_primary: true }]
      : [],
    payment_methods: [],
    appointments: [],
    total_appointment_count: 0,
    form_assignments: [],
    form_submissions: [],
  };
}

/**
 * A shape-complete but empty `PatientDetails`. Used as the merge fallback so
 * `details` always has every array present (never `undefined`), even in
 * run-sheet mode where there's no shell seed and `summary` may land before
 * `history`. The patient sub-object is overwritten by the first merge.
 */
function emptyDetails(patientId: string): PatientDetails {
  return {
    patient: { id: patientId, first_name: "", last_name: "", date_of_birth: null },
    phone_numbers: [],
    payment_methods: [],
    appointments: [],
    total_appointment_count: 0,
    form_assignments: [],
    form_submissions: [],
  };
}

export function PatientContactCard({
  session,
  patientId: propPatientId,
  open,
  onClose,
  appointment,
  patientSeed,
  onDeleted,
}: PatientContactCardProps) {
  const [details, setDetails] = useState<PatientDetails | null>(null);
  // Per-section loading flags. `summary` covers DOB + cards (+ phones), which
  // the row only partially seeds; `history` covers the appointments timeline +
  // count + forms. Both start true on open; their fetch flips them false.
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Workflow actions for the active appointment (Stage 7) — fetched on the
  // fast path via /summary?appointment_id, gated by summaryLoading. In
  // readiness mode we already have them on the appointment, so this stays null.
  const [fetchedWorkflowActions, setFetchedWorkflowActions] = useState<
    WorkflowAction[] | null
  >(null);
  // "Open in {PMS}" deep link for this patient (§6.2). Null when no sync-active
  // PMS / no link / no web links — the button then hides.
  const [pmsLink, setPmsLink] = useState<{
    url: string;
    providerLabel: string;
  } | null>(null);
  const { selectedLocation } = useLocation();
  const { syncActive: pmsSyncActive } = usePmsConnection();

  const resolvedPatientId =
    propPatientId ||
    appointment?.patient_id ||
    patientSeed?.id ||
    session?.patient_id ||
    null;
  const isReadinessMode = !!appointment;

  // Resolve the "Open in {PMS}" deep link — but only when the location has a
  // sync-active PMS (from shared context, no extra connection poll). The
  // patient-link call still needs the patient id, so it can't be fully shared,
  // but gating on syncActive means it never fires when there's no PMS.
  useEffect(() => {
    let cancelled = false;
    const locationId = selectedLocation?.id;
    if (!open || !resolvedPatientId || !locationId || !pmsSyncActive) {
      setPmsLink(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/pms/patient-link?locationId=${locationId}&patientId=${resolvedPatientId}`
        );
        if (cancelled) return;
        const data = res.ok
          ? ((await res.json()) as { url: string | null; providerLabel: string | null })
          : { url: null, providerLabel: null };
        if (cancelled) return;
        setPmsLink(
          data.url && data.providerLabel
            ? { url: data.url, providerLabel: data.providerLabel }
            : null
        );
      } catch {
        if (!cancelled) setPmsLink(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resolvedPatientId, selectedLocation?.id, pmsSyncActive]);

  // Whether the row gives us enough to paint a shell on open. When true, we
  // never show the full-panel skeleton — sections shimmer individually.
  const hasShellSeed = !!appointment || !!patientSeed;

  useEffect(() => {
    if (!open || !resolvedPatientId) {
      setDetails(null);
      setFetchError(null);
      setSummaryLoading(false);
      setSummaryError(false);
      setHistoryLoading(false);
      setHistoryError(false);
      setFetchedWorkflowActions(null);
      return;
    }

    // Seed the shell synchronously so the panel paints before any fetch.
    const shell = buildShell(resolvedPatientId, appointment, patientSeed);
    setDetails(shell);
    setFetchError(null);
    setSummaryError(false);
    setHistoryError(false);
    setSummaryLoading(true);
    setHistoryLoading(true);
    setFetchedWorkflowActions(null);

    // Active-row hints — let the server force-include the active row even if
    // it falls outside the regular candidate window.
    const activeApptId =
      appointment?.appointment_id ?? session?.appointment_id ?? null;
    const sessionId = session?.session_id ?? null;

    // Shared URL builders so these match the hover-prefetch URLs exactly (a
    // cache hit depends on byte-identical keys).
    const summaryUrl = patientSummaryUrl(resolvedPatientId);
    const historyUrl = patientHistoryUrl(
      resolvedPatientId,
      activeApptId,
      sessionId,
    );

    // Cancel/ignore stale responses: a quick A→B click must not let A's late
    // response overwrite B. The closure-captured `cancelled` flag (invalidated
    // by cleanup on unmount/reopen) is the request key; each fetch checks it
    // independently in its own .then.
    let cancelled = false;

    // -- Summary (fast path: DOB, phones, cards, + workflow actions) --------
    const cachedSummary = summaryCache.get(summaryUrl);
    if (cachedSummary && cachedSummary.expiresAt > Date.now()) {
      applySummary(cachedSummary.data);
      setSummaryLoading(false);
    } else {
      (async () => {
        try {
          const res = await fetch(summaryUrl);
          if (cancelled) return;
          if (!res.ok) {
            if (hasShellSeed) {
              // Keep the shell; mark the summary degraded so DOB/cards show a
              // note rather than a false "none".
              setSummaryLoading(false);
              setSummaryError(true);
            } else {
              setDetails(null);
              setFetchError(
                res.status === 401
                  ? "Your session has expired. Please reload."
                  : res.status === 404
                    ? "Patient not found."
                    : "Failed to load patient details."
              );
              setSummaryLoading(false);
            }
            return;
          }
          const data = (await res.json()) as PatientSummaryResponse;
          if (cancelled) return;
          cacheSummary(summaryUrl, data);
          applySummary(data);
          setSummaryLoading(false);
        } catch (err) {
          if (cancelled) return;
          console.error("[ContactCard] summary fetch failed:", err);
          if (hasShellSeed) {
            setSummaryLoading(false);
            setSummaryError(true);
          } else {
            setFetchError("Failed to load patient details.");
            setDetails(null);
            setSummaryLoading(false);
          }
        }
      })();
    }

    // -- History (deferred: appointment timeline + count + forms) -----------
    const cachedHistory = historyCache.get(historyUrl);
    if (cachedHistory && cachedHistory.expiresAt > Date.now()) {
      applyHistory(cachedHistory.data);
      setHistoryLoading(false);
    } else {
      (async () => {
        try {
          const res = await fetch(historyUrl);
          if (cancelled) return;
          if (!res.ok) {
            setHistoryLoading(false);
            setHistoryError(true);
            return;
          }
          const data = (await res.json()) as PatientHistoryResponse;
          if (cancelled) return;
          cacheHistory(historyUrl, data);
          applyHistory(data);
          setHistoryLoading(false);
        } catch (err) {
          if (cancelled) return;
          console.error("[ContactCard] history fetch failed:", err);
          setHistoryLoading(false);
          setHistoryError(true);
        }
      })();
    }

    // Merge helpers — spread onto the CURRENT state functionally so the shell
    // seed and the other request's writes are preserved (the shapes are
    // disjoint, so no field collides). Seeded as locals inside the effect so
    // each open's closure carries its own.
    function applySummary(data: PatientSummaryResponse) {
      setDetails((prev) => ({
        ...(prev ?? shell ?? emptyDetails(resolvedPatientId!)),
        patient: data.patient,
        phone_numbers: data.phone_numbers,
        payment_methods: data.payment_methods,
      }));
      if (data.workflow_actions) setFetchedWorkflowActions(data.workflow_actions);
    }
    function applyHistory(data: PatientHistoryResponse) {
      setDetails((prev) => ({
        ...(prev ?? shell ?? emptyDetails(resolvedPatientId!)),
        appointments: data.appointments,
        total_appointment_count: data.total_appointment_count,
        form_assignments: data.form_assignments,
        form_submissions: data.form_submissions,
        form_history_truncated: data.form_history_truncated,
      }));
    }

    return () => {
      cancelled = true;
    };
    // Deps are intentionally keyed on stable IDs, not on the `appointment` /
    // `patientSeed` objects themselves: the shell is rebuilt and the fetches
    // re-fired only when the patient / appointment / session identity changes,
    // not on every store-driven object re-creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    resolvedPatientId,
    session?.session_id,
    session?.appointment_id,
    appointment?.appointment_id,
  ]);

  // Active row matching: in run-sheet mode, match by appointment_id when
  // present, else by session_id (on-demand sessions). In readiness mode,
  // match by appointment_id.
  const activeAppointmentId =
    appointment?.appointment_id ?? session?.appointment_id ?? null;
  const activeSessionId = !activeAppointmentId
    ? session?.session_id ?? null
    : null;

  // Workflow source: the /summary fetch now returns the patient's recent
  // workflow-run actions (with run-grouping metadata) in every mode. Prefer it
  // once loaded; readiness's appointment.actions is only the instant fallback
  // before the fetch lands (those lack run metadata, so they show under "Other
  // messages" for the sub-second gap). Renders nothing on an empty array.
  const workflowActions: WorkflowAction[] =
    fetchedWorkflowActions ?? appointment?.actions ?? [];

  // Only fall back to the full-panel skeleton when we have no shell seed (a
  // bare patientId open with no row data). With a seed, sections shimmer.
  const showFullSkeleton =
    !details || !details.patient || (!hasShellSeed && summaryLoading);

  return (
    <SlideOver open={open} onClose={onClose} title="Patient details">
      {fetchError ? (
        <div className="p-5">
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </div>
        </div>
      ) : showFullSkeleton ? (
        <div className="p-5 space-y-4">
          {/* Skeleton */}
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 animate-pulse" />
            <div className="h-5 w-32 rounded bg-gray-100 animate-pulse" />
            <div className="h-4 w-40 rounded bg-gray-100 animate-pulse" />
          </div>
          <div className="h-px bg-gray-200" />
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
            <div className="h-10 w-full rounded-lg bg-gray-100 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-5">
          <DemographicsSection
            details={details}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
            onTakePayment={() => {}}
            onSendSms={() => {}}
            pmsLink={pmsLink}
            readinessActions={
              isReadinessMode && appointment && onDeleted ? (
                <ReadinessActions
                  appointment={appointment}
                  onDeleted={onDeleted}
                />
              ) : null
            }
          />

          <div className="h-px bg-gray-200" />

          <AppointmentsSection
            details={details}
            session={session}
            activeAppointmentId={activeAppointmentId}
            activeSessionId={activeSessionId}
            isReadinessMode={isReadinessMode}
            historyLoading={historyLoading}
            historyError={historyError}
          />

          <div className="h-px bg-gray-200" />

          {workflowActions.length > 0 && (
            <>
              <WorkflowsSection
                actions={workflowActions}
                activeAppointmentId={activeAppointmentId}
              />
              <div className="h-px bg-gray-200" />
            </>
          )}

          <CompletedFormsListWithDivider
            details={details}
            appointment={appointment}
            session={session}
            isReadinessMode={isReadinessMode}
          />

          <PaymentSection
            details={details}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
          />
        </div>
      )}
    </SlideOver>
  );
}

// Inline wrapper so the divider only renders when the list is non-empty.
// CompletedFormsList returns null on empty.
function CompletedFormsListWithDivider({
  details,
  appointment,
  session,
  isReadinessMode,
}: {
  details: PatientDetails;
  appointment?: ReadinessAppointment | null;
  session?: EnrichedSession | null;
  isReadinessMode: boolean;
}) {
  // Mirror buildCompletedFormsList's empty check so we don't render an
  // orphaned divider. The detailed list is rendered inside the inner
  // component; here we just decide whether to render at all.
  const hasReadinessForms =
    isReadinessMode &&
    appointment &&
    (appointment.completed_form_submissions ?? []).length > 0;

  const hasOtherForms =
    !isReadinessMode &&
    (details.form_assignments.some(
      (a) => a.status === "completed" && a.submission_id
    ) ||
      details.form_submissions.length > 0);

  if (!hasReadinessForms && !hasOtherForms) return null;

  return (
    <>
      <CompletedFormsList
        details={details}
        appointment={appointment}
        session={session}
        isReadinessMode={isReadinessMode}
      />
      <div className="h-px bg-gray-200" />
    </>
  );
}
