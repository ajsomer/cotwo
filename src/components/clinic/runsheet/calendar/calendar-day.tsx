"use client";

import { useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RoomGroup } from "@/lib/types/domain";
import {
  HOURS,
  HOUR_HEIGHT,
  GUTTER_WIDTH,
  DAY_START_HOUR,
  formatHourLabel,
  CalendarBlock,
  NowLine,
} from "./calendar-shared";

interface CalendarDayProps {
  groups: RoomGroup[];
  now: Date;
  onAction: (sessionId: string, action: string) => void;
  onPatientClick?: (sessionId: string) => void;
  /** Day/Week toggle rendered in this calendar's nav bar. */
  modeToggle?: React.ReactNode;
}

/**
 * Calendar: Day. One column per provider; appointment blocks positioned by
 * scheduled time. Data is today's loaded sessions — the date nav is cosmetic
 * for the prototype (no historical fetch wired up), so changing the day just
 * shows the empty grid for other dates.
 */
export function CalendarDay({
  groups,
  now,
  onAction,
  onPatientClick,
  modeToggle,
}: CalendarDayProps) {
  const [dayOffset, setDayOffset] = useState(0);
  const day = addDays(now, dayOffset);
  const isToday = dayOffset === 0;
  const gridHeight = HOURS.length * HOUR_HEIGHT;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Date nav */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200">
        <button
          onClick={() => setDayOffset((d) => d - 1)}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => setDayOffset((d) => d + 1)}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Next day"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-sm font-semibold text-gray-800">
          {format(day, "EEE d MMM")}
        </span>
        {!isToday && (
          <button
            onClick={() => setDayOffset(0)}
            className="ml-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Today
          </button>
        )}
        {modeToggle && <span className="ml-2">{modeToggle}</span>}
      </div>

      {/* Header row: provider names */}
      <div className="flex border-b border-gray-200 bg-gray-50/50">
        <div style={{ width: GUTTER_WIDTH }} className="flex-shrink-0" />
        {groups.map((group) => (
          <div
            key={group.room_id}
            className="flex-1 min-w-[160px] border-l border-gray-200 px-3 py-2 text-center"
          >
            <div className="text-sm font-semibold text-gray-800 truncate">
              {group.clinician_name ?? group.room_name}
            </div>
            <div className="text-[11px] text-gray-400">
              {group.sessions.length}{" "}
              {group.sessions.length === 1 ? "appt" : "appts"}
            </div>
          </div>
        ))}
      </div>

      {/* Scrollable time grid — fixed window, scrolls internally so the nav
          and provider headers stay pinned and the page itself doesn't grow. */}
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <div className="flex" style={{ height: gridHeight }}>
          {/* Hour gutter */}
          <div style={{ width: GUTTER_WIDTH }} className="relative flex-shrink-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-gray-400"
                style={{ top: (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Provider columns */}
          {groups.map((group) => (
            <div
              key={group.room_id}
              className="relative flex-1 min-w-[160px] border-l border-gray-200"
            >
              {/* Hour gridlines */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-t border-gray-100"
                  style={{ top: (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
                />
              ))}
              {isToday && <NowLine now={now} />}
              {group.sessions.map((session) => (
                <CalendarBlock
                  key={session.session_id}
                  session={session}
                  onAction={onAction}
                  onPatientClick={onPatientClick}
                />
              ))}
            </div>
          ))}

          {groups.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              No providers for this location.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
