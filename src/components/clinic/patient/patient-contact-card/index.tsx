"use client";

import { useEffect, useState } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import type { EnrichedSession } from "@/lib/supabase/types";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import { DemographicsSection, PaymentSection } from "./demographics-section";
import { AppointmentsSection } from "./appointments-section";
import { WorkflowTimeline, CompletedFormsList } from "./forms-section";
import { ReadinessActions } from "./readiness-actions";
import type { PatientDetails } from "./types";

interface PatientContactCardProps {
  session?: EnrichedSession | null;
  patientId?: string | null;
  open: boolean;
  onClose: () => void;
  // Readiness-specific (optional — omit for run sheet usage)
  appointment?: ReadinessAppointment | null;
  onDeleted?: () => void;
}

export function PatientContactCard({
  session,
  patientId: propPatientId,
  open,
  onClose,
  appointment,
  onDeleted,
}: PatientContactCardProps) {
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const resolvedPatientId =
    propPatientId || appointment?.patient_id || session?.patient_id || null;
  const isReadinessMode = !!appointment;

  useEffect(() => {
    if (!open || !resolvedPatientId) {
      setDetails(null);
      setFetchError(null);
      return;
    }

    setLoading(true);
    setFetchError(null);
    const params = new URLSearchParams();
    // Active row hints — let the server force-include the active row even if
    // it falls outside the regular candidate window.
    if (session?.session_id) params.set("session_id", session.session_id);
    if (appointment?.appointment_id)
      params.set("appointment_id", appointment.appointment_id);
    else if (session?.appointment_id)
      params.set("appointment_id", session.appointment_id);
    const qs = params.toString();
    const url = qs
      ? `/api/patient/${resolvedPatientId}?${qs}`
      : `/api/patient/${resolvedPatientId}`;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (cancelled) return;
        if (!res.ok) {
          setDetails(null);
          setFetchError(
            res.status === 401
              ? "Your session has expired. Please reload."
              : res.status === 404
                ? "Patient not found."
                : "Failed to load patient details."
          );
          return;
        }
        const data = (await res.json()) as PatientDetails;
        if (cancelled) return;
        setDetails(data);
      } catch (err) {
        if (cancelled) return;
        console.error("[ContactCard] fetch failed:", err);
        setFetchError("Failed to load patient details.");
        setDetails(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  return (
    <SlideOver open={open} onClose={onClose} title="Patient details">
      {fetchError ? (
        <div className="p-5">
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </div>
        </div>
      ) : loading || !details || !details.patient ? (
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
            onTakePayment={() => {
              console.log(
                "[ContactCard] Take payment stub — patient:",
                details.patient.id,
                "session:",
                session?.session_id
              );
            }}
            onSendSms={() => {
              console.log(
                "[ContactCard] Send SMS stub — patient:",
                details.patient.id,
                "phone:",
                details.phone_numbers[0]?.phone_number
              );
            }}
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
          />

          <div className="h-px bg-gray-200" />

          {isReadinessMode && appointment && (
            <>
              <WorkflowTimeline appointment={appointment} />
              <div className="h-px bg-gray-200" />
            </>
          )}

          <CompletedFormsListWithDivider
            details={details}
            appointment={appointment}
            session={session}
            isReadinessMode={isReadinessMode}
          />

          <PaymentSection details={details} />
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
