"use client";

import { useEffect, useMemo, useState } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/clinic/shared/status-badge";
import { ActionTypeIcon } from "@/components/clinic/shared/action-type-icon";
import { formatPhoneNumber } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/supabase/types";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ActionType } from "@/lib/workflows/types";

interface PatientContactCardProps {
  session?: EnrichedSession | null;
  patientId?: string | null;
  open: boolean;
  onClose: () => void;
  // Readiness-specific (optional — omit for run sheet usage)
  appointment?: ReadinessAppointment | null;
  onDeleted?: () => void;
}

interface AppointmentRow {
  appointment_id: string | null;
  session_id: string | null;
  scheduled_at: string | null;
  created_at: string | null;
  type_name: string | null;
  room_name: string | null;
  modality: "telehealth" | "in_person" | null;
  appointment_status: string | null;
  session_status: string | null;
  bucket: "past" | "today" | "upcoming" | "awaiting_scheduling";
  location_timezone: string | null;
}

interface FormAssignmentRow {
  id: string;
  form_id: string;
  appointment_id: string | null;
  form_name: string;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  submission_id: string | null;
}

interface FormSubmissionRow {
  submission_id: string;
  form_id: string;
  appointment_id: string | null;
  form_name: string;
  completed_at: string;
  created_at: string;
}

interface PatientDetails {
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  };
  phone_numbers: { phone_number: string; is_primary: boolean }[];
  payment_methods: {
    card_brand: string;
    card_last_four: string;
    card_expiry: string | null;
    is_default: boolean;
  }[];
  appointments: AppointmentRow[];
  total_appointment_count: number;
  form_assignments: FormAssignmentRow[];
  form_submissions: FormSubmissionRow[];
}

interface CompletedFormDisplayRow {
  submission_id: string;
  form_name: string;
  completed_at: string;
}

const ACTION_STATUS_BADGE: Record<string, { label: string; variant: string }> = {
  scheduled: { label: "Scheduled", variant: "gray" },
  pending: { label: "Pending", variant: "gray" },
  firing: { label: "Firing", variant: "amber" },
  sent: { label: "Sent", variant: "amber" },
  opened: { label: "Opened", variant: "amber" },
  completed: { label: "Completed", variant: "teal" },
  captured: { label: "Captured", variant: "teal" },
  verified: { label: "Verified", variant: "teal" },
  transcribed: { label: "Transcribed", variant: "teal" },
  skipped: { label: "Skipped", variant: "gray" },
  failed: { label: "Failed", variant: "red" },
};

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
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolvedPatientId = propPatientId || appointment?.patient_id || session?.patient_id || null;
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
    if (appointment?.appointment_id) params.set("appointment_id", appointment.appointment_id);
    else if (session?.appointment_id) params.set("appointment_id", session.appointment_id);
    const qs = params.toString();
    const url = qs ? `/api/patient/${resolvedPatientId}?${qs}` : `/api/patient/${resolvedPatientId}`;
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
                : "Failed to load patient details.",
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
  }, [open, resolvedPatientId, session?.session_id, session?.appointment_id, appointment?.appointment_id]);

  // Reset delete confirm when panel closes
  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  const handleDelete = async () => {
    if (!appointment) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/readiness/delete-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appointment.appointment_id }),
      });
      if (res.ok) {
        onDeleted?.();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Workflow timeline (readiness only) — sorted by offset
  const sortedActions = appointment
    ? [...appointment.actions].sort((a, b) => b.offset_minutes - a.offset_minutes)
    : [];

  // Active row matching: in run-sheet mode, match by appointment_id when present,
  // else by session_id (on-demand sessions). In readiness mode, match by appointment_id.
  const activeAppointmentId = appointment?.appointment_id ?? session?.appointment_id ?? null;
  const activeSessionId = !activeAppointmentId ? session?.session_id ?? null : null;

  const orderedAppointments = useMemo(
    () => orderAppointmentsForDisplay(details?.appointments ?? [], activeAppointmentId, activeSessionId),
    [details?.appointments, activeAppointmentId, activeSessionId],
  );

  // Completed forms list — see "Slide-out data source" in the spec.
  const completedForms = useMemo(
    () => buildCompletedFormsList(details, appointment, session, isReadinessMode),
    [details, appointment, session, isReadinessMode],
  );

  const hiddenAppointmentCount = details
    ? Math.max(0, details.total_appointment_count - orderedAppointments.length)
    : 0;

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
          {/* Header: Avatar + Name + DOB */}
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
                  onClick={() => {
                    console.log("[ContactCard] Take payment stub — patient:", details.patient.id, "session:", session?.session_id);
                  }}
                />
              )}
              <QuickActionButton
                icon={<SmsIcon />}
                label="Send SMS"
                onClick={() => {
                  console.log("[ContactCard] Send SMS stub — patient:", details.patient.id, "phone:", details.phone_numbers[0]?.phone_number);
                }}
              />
            </div>

            {/* Delete button (readiness only) */}
            {isReadinessMode && onDeleted && (
              <div className="pt-1">
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Delete appointment?</span>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium bg-red-500 text-white hover:bg-red-500/90 disabled:opacity-50 transition-colors"
                    >
                      {deleting ? "..." : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Delete appointment
                  </button>
                )}
              </div>
            )}
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

          <div className="h-px bg-gray-200" />

          {/* Appointments — unified past + today + upcoming + awaiting_scheduling */}
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
              Appointments
            </h4>
            {orderedAppointments.length === 0 ? (
              <p className="text-sm text-gray-400">No appointments yet</p>
            ) : (
              <div className="space-y-1.5">
                {orderedAppointments.map((row) => {
                  const isActive = isActiveRow(row, activeAppointmentId, activeSessionId);
                  return (
                    <AppointmentRowView
                      key={appointmentRowKey(row)}
                      row={row}
                      isActive={isActive}
                      sessionDerivedState={isActive ? session?.derived_state ?? null : null}
                    />
                  );
                })}
              </div>
            )}
            {hiddenAppointmentCount > 0 && (
              <p className="text-[11px] text-gray-400 mt-2">
                + {hiddenAppointmentCount} earlier appointment{hiddenAppointmentCount === 1 ? "" : "s"}
              </p>
            )}
            {isReadinessMode && (
              <p className="text-[10px] text-gray-400 italic mt-1">
                Coviu appointments only — not a complete clinical history
              </p>
            )}
          </section>

          <div className="h-px bg-gray-200" />

          {/* Workflow timeline (readiness only) */}
          {isReadinessMode && sortedActions.length > 0 && (
            <>
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                  Workflow
                </h4>
                <div className="relative space-y-3 pl-5">
                  {/* Vertical line */}
                  <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />

                  {sortedActions.map((action) => {
                    const badge = ACTION_STATUS_BADGE[action.status] ?? {
                      label: action.status,
                      variant: "gray",
                    };
                    return (
                      <div key={action.action_id} className="relative flex items-start gap-2">
                        <div className="absolute left-[-16px] top-1 w-2 h-2 rounded-full bg-gray-300 border-2 border-white" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <ActionTypeIcon
                              actionType={action.action_type as ActionType}
                              size={14}
                              className="text-gray-400 shrink-0"
                            />
                            <span className="text-xs text-gray-700 truncate">
                              {action.action_label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge
                              variant={badge.variant as "red" | "amber" | "teal" | "gray" | "faded"}
                            >
                              {badge.label}
                            </Badge>
                            {action.fired_at && (
                              <span className="text-[10px] text-gray-400">
                                {new Date(action.fired_at).toLocaleString("en-AU", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </div>
                          {action.error_message && (
                            <p className="text-[10px] text-red-500 mt-0.5">
                              {action.error_message}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="h-px bg-gray-200" />
            </>
          )}

          {/* Completed forms — read-only, opens PDF in new tab */}
          {completedForms.length > 0 && (
            <>
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                  Completed forms
                </h4>
                <div className="space-y-1.5">
                  {completedForms.map((row) => (
                    <button
                      key={row.submission_id}
                      type="button"
                      onClick={() => window.open(`/api/forms/submissions/${row.submission_id}/pdf`, "_blank")}
                      className="w-full flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
                      title={`Submitted ${formatFullTimestamp(row.completed_at)}`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-gray-800 block truncate">
                          {row.form_name}
                        </span>
                        <span
                          className="text-xs text-gray-400"
                          title={formatFullTimestamp(row.completed_at)}
                        >
                          Submitted {relativeTime(row.completed_at)}
                        </span>
                      </div>
                      <span className="text-[11px] font-medium text-teal-600 ml-2 flex-shrink-0">
                        View
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <div className="h-px bg-gray-200" />
            </>
          )}

          {/* Payment */}
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
        </div>
      )}
    </SlideOver>
  );
}

// ---------------------------------------------------------------------------
// Appointment ordering and rendering
// ---------------------------------------------------------------------------

function appointmentRowKey(row: AppointmentRow): string {
  return row.appointment_id ?? `session:${row.session_id ?? ""}`;
}

function isActiveRow(
  row: AppointmentRow,
  activeAppointmentId: string | null,
  activeSessionId: string | null,
): boolean {
  if (activeAppointmentId && row.appointment_id === activeAppointmentId) return true;
  if (!activeAppointmentId && activeSessionId && row.session_id === activeSessionId) return true;
  return false;
}

/**
 * Within-bucket sort plus active-row hoisting in today.
 *
 * The API has already grouped rows into the right bucket order
 * (upcoming → today → past → awaiting_scheduling) and sorted within each
 * bucket. The slide-out's only adjustment is to float the active row to the
 * top of the today bucket if present, since the API doesn't know which row
 * is active for this caller.
 */
function orderAppointmentsForDisplay(
  rows: AppointmentRow[],
  activeAppointmentId: string | null,
  activeSessionId: string | null,
): AppointmentRow[] {
  const todayActiveIdx = rows.findIndex(
    (r) => r.bucket === "today" && isActiveRow(r, activeAppointmentId, activeSessionId),
  );
  if (todayActiveIdx === -1) return rows;
  const out = [...rows];
  const [active] = out.splice(todayActiveIdx, 1);
  // Find the first today row in the new array and insert before it.
  const firstTodayIdx = out.findIndex((r) => r.bucket === "today");
  out.splice(firstTodayIdx === -1 ? 0 : firstTodayIdx, 0, active);
  return out;
}

function dateLabel(row: AppointmentRow): string {
  if (row.bucket === "awaiting_scheduling") return "Awaiting scheduling";
  const instant = row.scheduled_at ?? row.created_at;
  if (!instant) return "—";
  const tz = row.location_timezone ?? undefined;

  const dayParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const partOf = (type: string) => Number(dayParts.find((p) => p.type === type)?.value ?? "0");
  const rowDay = { y: partOf("year"), m: partOf("month"), d: partOf("day") };

  const nowParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const nowPartOf = (type: string) => Number(nowParts.find((p) => p.type === type)?.value ?? "0");
  const nowDay = { y: nowPartOf("year"), m: nowPartOf("month"), d: nowPartOf("day") };

  const dayDelta = daysBetween(rowDay, nowDay);
  if (dayDelta === 0) return "Today";
  if (dayDelta === 1) return "Tomorrow";
  if (dayDelta === -1) return "Yesterday";

  return new Date(instant).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: dayDelta < -180 || dayDelta > 180 ? "numeric" : undefined,
    timeZone: tz,
  });
}

function daysBetween(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): number {
  const aMs = Date.UTC(a.y, a.m - 1, a.d);
  const bMs = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((aMs - bMs) / (24 * 60 * 60 * 1000));
}

function timeLabel(row: AppointmentRow): string | null {
  if (!row.scheduled_at) return null;
  return new Date(row.scheduled_at).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: row.location_timezone ?? undefined,
  });
}

function modalityLabel(row: AppointmentRow): string | null {
  if (!row.modality) return null;
  return row.modality === "telehealth" ? "Telehealth" : "In-person";
}

function AppointmentRowView({
  row,
  isActive,
  sessionDerivedState,
}: {
  row: AppointmentRow;
  isActive: boolean;
  sessionDerivedState: EnrichedSession["derived_state"] | null;
}) {
  const date = dateLabel(row);
  const time = timeLabel(row);
  const modality = modalityLabel(row);

  const cardClass = isActive
    ? "rounded-lg bg-white border border-gray-200 px-3 py-3"
    : "rounded-lg bg-gray-50 px-3 py-2";

  const showUpcomingTag = row.bucket === "upcoming" && isWithinNextDays(row, 7);
  // Modality is helpful on every actionable row, not just the active one —
  // shown on upcoming and active rows; suppressed on past/awaiting to keep
  // the history list compact.
  const showModality = modality && (isActive || row.bucket === "upcoming");

  return (
    <div className={cardClass}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-gray-800">{date}</span>
        {time && <span className="text-xs text-gray-500">at {time}</span>}
      </div>
      {(row.type_name || row.room_name) && (
        <p className="text-xs text-gray-500 mt-0.5">
          {row.type_name}
          {row.type_name && row.room_name ? " · " : ""}
          {row.room_name}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1">
        {row.appointment_status === "no_show" && <Badge variant="faded">No show</Badge>}
        {showUpcomingTag && <span className="text-[10px] text-gray-400">Upcoming</span>}
        {isActive && sessionDerivedState && <StatusBadge state={sessionDerivedState} />}
        {showModality && (
          <span className="text-xs text-gray-400">{modality}</span>
        )}
      </div>
    </div>
  );
}

function isWithinNextDays(row: AppointmentRow, days: number): boolean {
  if (!row.scheduled_at) return false;
  const ms = new Date(row.scheduled_at).getTime() - Date.now();
  if (ms < 0) return false;
  return ms <= days * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Completed forms list assembly
// ---------------------------------------------------------------------------

function buildCompletedFormsList(
  details: PatientDetails | null,
  appointment: ReadinessAppointment | null | undefined,
  session: EnrichedSession | null | undefined,
  isReadinessMode: boolean,
): CompletedFormDisplayRow[] {
  if (!details) return [];

  // Readiness mode: read directly from the readiness payload's
  // completed_form_submissions (built in fetchers/readiness.ts).
  if (isReadinessMode && appointment) {
    return (appointment.completed_form_submissions ?? [])
      .slice()
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
      .map((s) => ({
        submission_id: s.submission_id,
        form_name: s.form_name,
        completed_at: s.completed_at,
      }));
  }

  // Non-readiness modes: union of form_assignments (completed, with a
  // submission_id) + form_submissions, deduplicated by submission_id.
  const assignmentRows = details.form_assignments
    .filter((a) => a.status === "completed" && a.submission_id)
    .map((a) => ({
      submission_id: a.submission_id!,
      form_name: a.form_name,
      completed_at: a.completed_at ?? a.created_at,
      appointment_id: a.appointment_id,
    }));

  const submissionRows = details.form_submissions.map((s) => ({
    submission_id: s.submission_id,
    form_name: s.form_name,
    completed_at: s.completed_at,
    appointment_id: s.appointment_id,
  }));

  const seen = new Set<string>();
  const merged: { submission_id: string; form_name: string; completed_at: string; appointment_id: string | null }[] = [];
  for (const row of [...assignmentRows, ...submissionRows]) {
    if (seen.has(row.submission_id)) continue;
    seen.add(row.submission_id);
    merged.push(row);
  }

  // Run-sheet mode (regular session): scope to session.appointment_id.
  // Run-sheet on-demand session (no appointment_id): fall back to standalone.
  // Standalone: all rows.
  let scoped = merged;
  if (session?.appointment_id) {
    scoped = merged.filter((r) => r.appointment_id === session.appointment_id);
  }

  return scoped
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
    .slice(0, 10)
    .map((r) => ({
      submission_id: r.submission_id,
      form_name: r.form_name,
      completed_at: r.completed_at,
    }));
}

// --- Helpers ---

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatFullTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function QuickActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
