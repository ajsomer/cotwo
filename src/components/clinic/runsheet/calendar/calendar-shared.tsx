"use client";

import { StatusBadge } from "@/components/clinic/shared/status-badge";
import { ActionButton } from "../action-button";
import { formatPatientName } from "@/lib/runsheet/format";
import { getRowBorderColor } from "@/lib/runsheet/derived-state";
import type { EnrichedSession } from "@/lib/types/domain";

// Time-grid geometry. The grid spans DAY_START_HOUR..DAY_END_HOUR; each hour
// is HOUR_HEIGHT px tall. Blocks are positioned by offset from DAY_START_HOUR.
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 19;
export const HOUR_HEIGHT = 64;
export const GUTTER_WIDTH = 56; // left time-label column

export const HOURS: number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i
);

/** Top offset (px) for a given Date within the grid. */
export function topForDate(date: Date): number {
  const minutes =
    (date.getHours() - DAY_START_HOUR) * 60 + date.getMinutes();
  return (minutes / 60) * HOUR_HEIGHT;
}

/** Block height (px) for a duration in minutes (min one 30-min slot tall). */
export function heightForDuration(durationMinutes: number | null): number {
  const mins = Math.max(durationMinutes ?? 30, 20);
  return (mins / 60) * HOUR_HEIGHT;
}

export function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

/**
 * One appointment block in a calendar column, absolutely positioned by its
 * scheduled time. Carries the same status colour / action affordance as the
 * run sheet rows.
 */
export function CalendarBlock({
  session,
  onAction,
  onPatientClick,
}: {
  session: EnrichedSession;
  onAction: (sessionId: string, action: string) => void;
  onPatientClick?: (sessionId: string) => void;
}) {
  if (!session.scheduled_at) return null;
  const start = new Date(session.scheduled_at);
  const top = topForDate(start);
  const height = heightForDuration(session.duration_minutes);
  const borderColor = getRowBorderColor(session.derived_state);
  const isDone = session.derived_state === "done";
  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name,
    session.phone_number
  );
  const time = start.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div
      className={`absolute left-1 right-1 rounded-md border border-gray-200 border-l-[3px] ${borderColor} bg-white shadow-sm overflow-hidden ${
        isDone ? "opacity-40" : ""
      }`}
      style={{ top, height: Math.max(height, 40) }}
    >
      <div className="flex h-full flex-col px-2 py-1.5">
        <div className="flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPatientClick?.(session.session_id);
            }}
            className="min-w-0 text-left text-[12px] font-semibold text-gray-800 truncate hover:underline hover:text-teal-600"
          >
            {patientName}
            {session.type_name && (
              <span className="font-normal text-gray-400">
                {" "}
                · {session.type_name}
              </span>
            )}
          </button>
          <span className="flex-shrink-0 text-[11px] font-medium text-gray-400 whitespace-nowrap">
            {time}
          </span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-1 pt-1">
          <StatusBadge state={session.derived_state} className="flex-shrink-0" />
          <ActionButton
            state={session.derived_state}
            modality={session.modality}
            sessionId={session.session_id}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}

/** The current-time red line, only drawn when `now` is within the grid range. */
export function NowLine({ now }: { now: Date }) {
  const hour = now.getHours();
  if (hour < DAY_START_HOUR || hour > DAY_END_HOUR) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-10 border-t border-red-500"
      style={{ top: topForDate(now) }}
    >
      <span className="absolute -left-1 -top-[3px] h-1.5 w-1.5 rounded-full bg-red-500" />
    </div>
  );
}
