"use client";

import { useMemo } from "react";
import { WifiOff, CalendarClock, LogIn } from "lucide-react";
import { StatusBadge } from "@/components/clinic/shared/status-badge";
import { ActionButton } from "./action-button";
import { CardIndicator } from "./card-indicator";
import { Tooltip } from "@/components/ui/tooltip";
import { getRowBorderColor } from "@/lib/runsheet/derived-state";
import { PRIORITY_ORDER } from "@/lib/runsheet/grouping";
import { resolveSessionTime, formatPatientName } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/types/domain";

interface RunsheetAppointmentListProps {
  sessions: EnrichedSession[];
  onAction: (sessionId: string, action: string) => void;
  onSessionClick?: (sessionId: string) => void;
  onPatientClick?: (sessionId: string) => void;
}

const GRID = "grid-cols-[100px_160px_28px_120px_120px_140px_1fr_auto_auto]";

/**
 * Flat "Appointment list" view: every session for the location in one table,
 * ungrouped, under a column header. Sorted by the same priority order the
 * grouped view uses, then by time. Reuses the run sheet row primitives.
 */
export function RunsheetAppointmentList({
  sessions,
  onAction,
  onSessionClick,
  onPatientClick,
}: RunsheetAppointmentListProps) {
  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const pd =
        PRIORITY_ORDER[a.derived_state] - PRIORITY_ORDER[b.derived_state];
      if (pd !== 0) return pd;
      const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return ta - tb;
    });
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-500">No sessions for this location today.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Column header — grid template matches the row layout exactly */}
      <div
        className={`grid ${GRID} items-center border-b border-gray-200 bg-gray-50/50 h-9 text-[11px] font-semibold uppercase tracking-wide text-gray-400`}
      >
        <span className="flex items-center justify-center">Time</span>
        <span className="pl-5 pr-2">Patient</span>
        <span />
        <span className="px-2">Status</span>
        <span className="px-2">Type</span>
        <span className="px-2">Provider</span>
        <span />
        <span />
        <span className="pr-5" />
      </div>

      {sorted.map((session) => (
        <AppointmentListRow
          key={session.session_id}
          session={session}
          onAction={onAction}
          onClick={onSessionClick}
          onPatientClick={onPatientClick}
        />
      ))}
    </div>
  );
}

function AppointmentListRow({
  session,
  onAction,
  onClick,
  onPatientClick,
}: {
  session: EnrichedSession;
  onAction: (sessionId: string, action: string) => void;
  onClick?: (sessionId: string) => void;
  onPatientClick?: (sessionId: string) => void;
}) {
  const borderColor = getRowBorderColor(session.derived_state);
  const isDone = session.derived_state === "done";
  const isActive =
    session.derived_state === "in_session" ||
    session.derived_state === "running_over" ||
    session.derived_state === "waiting" ||
    session.derived_state === "checked_in";
  const activeBg = isActive ? "bg-teal-50/40" : "";
  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name,
    session.phone_number
  );
  const { text: time, source: timeSource } = resolveSessionTime(session);

  return (
    <div
      className={`grid ${GRID} items-center border-b border-gray-200 last:border-b-0 border-l-[3px] ${borderColor} ${activeBg} transition-colors ${
        isDone ? "opacity-40" : ""
      } ${onClick ? "cursor-pointer hover:bg-gray-50/50" : ""}`}
      onClick={() => onClick?.(session.session_id)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(session.session_id);
        }
      }}
    >
      {/* Time */}
      <span className="self-stretch flex items-center justify-center gap-1 text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A] h-12">
        {timeSource === "scheduled" && (
          <Tooltip content="Scheduled appointment">
            <CalendarClock size={12} className="text-gray-400 flex-shrink-0" />
          </Tooltip>
        )}
        {timeSource === "joined" && (
          <Tooltip content="On-demand — joined the waiting room at this time">
            <LogIn size={12} className="text-teal-500 flex-shrink-0" />
          </Tooltip>
        )}
        {time ?? "--:--"}
      </span>

      {/* Patient name */}
      <div className="flex items-center min-w-0 pl-5 pr-2">
        {session.patient_id && onPatientClick ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPatientClick(session.session_id);
            }}
            className="text-[14px] font-semibold text-gray-800 truncate leading-none hover:underline hover:text-teal-600 transition-colors"
          >
            {patientName}
          </button>
        ) : (
          <span className="text-[14px] font-semibold text-gray-800 truncate leading-none">
            {patientName}
          </span>
        )}
      </div>

      {/* Disconnect indicator column */}
      <div className="flex items-center justify-center">
        {session.patient_disconnected && (
          <Tooltip content="Patient disconnected">
            <span className="flex-shrink-0 inline-flex items-center text-amber-500">
              <WifiOff size={14} />
            </span>
          </Tooltip>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center min-w-0 px-2">
        <StatusBadge state={session.derived_state} className="flex-shrink-0" />
      </div>

      {/* Type */}
      <div className="flex items-center min-w-0 px-2">
        {session.type_name && (
          <span className="text-xs text-gray-500 truncate leading-none">
            {session.type_name}
          </span>
        )}
      </div>

      {/* Provider */}
      <div className="flex items-center min-w-0 px-2">
        {session.clinician_name && (
          <span className="text-xs text-gray-500 truncate leading-none">
            {session.clinician_name}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div />

      {/* Card */}
      <div className="flex items-center justify-center px-3">
        <CardIndicator hasCard={session.has_card_on_file} />
      </div>

      {/* Action */}
      <div className="flex items-center justify-end pr-5 pl-3">
        <ActionButton
          state={session.derived_state}
          modality={session.modality}
          sessionId={session.session_id}
          onAction={onAction}
        />
      </div>
    </div>
  );
}
