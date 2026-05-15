"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/clinic/shared/status-badge";
import type { EnrichedSession } from "@/lib/supabase/types";
import type { AppointmentRow, PatientDetails } from "./types";

interface AppointmentsSectionProps {
  details: PatientDetails;
  session?: EnrichedSession | null;
  activeAppointmentId: string | null;
  activeSessionId: string | null;
  isReadinessMode: boolean;
}

export function AppointmentsSection({
  details,
  session,
  activeAppointmentId,
  activeSessionId,
  isReadinessMode,
}: AppointmentsSectionProps) {
  const orderedAppointments = useMemo(
    () =>
      orderAppointmentsForDisplay(
        details.appointments,
        activeAppointmentId,
        activeSessionId
      ),
    [details.appointments, activeAppointmentId, activeSessionId]
  );

  const hiddenAppointmentCount = Math.max(
    0,
    details.total_appointment_count - orderedAppointments.length
  );

  return (
    <section>
      <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
        Appointments
      </h4>
      {orderedAppointments.length === 0 ? (
        <p className="text-sm text-gray-400">No appointments yet</p>
      ) : (
        <div className="space-y-1.5">
          {orderedAppointments.map((row) => {
            const isActive = isActiveRow(
              row,
              activeAppointmentId,
              activeSessionId
            );
            return (
              <AppointmentRowView
                key={appointmentRowKey(row)}
                row={row}
                isActive={isActive}
                sessionDerivedState={
                  isActive ? session?.derived_state ?? null : null
                }
              />
            );
          })}
        </div>
      )}
      {hiddenAppointmentCount > 0 && (
        <p className="text-[11px] text-gray-400 mt-2">
          + {hiddenAppointmentCount} earlier appointment
          {hiddenAppointmentCount === 1 ? "" : "s"}
        </p>
      )}
      {isReadinessMode && (
        <p className="text-[10px] text-gray-400 italic mt-1">
          Coviu appointments only — not a complete clinical history
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

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
        {row.appointment_status === "no_show" && (
          <Badge variant="faded">No show</Badge>
        )}
        {showUpcomingTag && (
          <span className="text-[10px] text-gray-400">Upcoming</span>
        )}
        {isActive && sessionDerivedState && (
          <StatusBadge state={sessionDerivedState} />
        )}
        {showModality && (
          <span className="text-xs text-gray-400">{modality}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appointmentRowKey(row: AppointmentRow): string {
  return row.appointment_id ?? `session:${row.session_id ?? ""}`;
}

function isActiveRow(
  row: AppointmentRow,
  activeAppointmentId: string | null,
  activeSessionId: string | null
): boolean {
  if (activeAppointmentId && row.appointment_id === activeAppointmentId)
    return true;
  if (
    !activeAppointmentId &&
    activeSessionId &&
    row.session_id === activeSessionId
  )
    return true;
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
  activeSessionId: string | null
): AppointmentRow[] {
  const todayActiveIdx = rows.findIndex(
    (r) =>
      r.bucket === "today" &&
      isActiveRow(r, activeAppointmentId, activeSessionId)
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
  const partOf = (type: string) =>
    Number(dayParts.find((p) => p.type === type)?.value ?? "0");
  const rowDay = {
    y: partOf("year"),
    m: partOf("month"),
    d: partOf("day"),
  };

  const nowParts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const nowPartOf = (type: string) =>
    Number(nowParts.find((p) => p.type === type)?.value ?? "0");
  const nowDay = {
    y: nowPartOf("year"),
    m: nowPartOf("month"),
    d: nowPartOf("day"),
  };

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
  b: { y: number; m: number; d: number }
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

function isWithinNextDays(row: AppointmentRow, days: number): boolean {
  if (!row.scheduled_at) return false;
  const ms = new Date(row.scheduled_at).getTime() - Date.now();
  if (ms < 0) return false;
  return ms <= days * 24 * 60 * 60 * 1000;
}
