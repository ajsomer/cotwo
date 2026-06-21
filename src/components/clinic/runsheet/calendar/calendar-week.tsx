"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { addWeeks, startOfWeek, addDays, format, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
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

interface CalendarWeekProps {
  groups: RoomGroup[];
  now: Date;
  onAction: (sessionId: string, action: string) => void;
  onPatientClick?: (sessionId: string) => void;
  /** Day/Week toggle rendered in this calendar's nav bar. */
  modeToggle?: React.ReactNode;
}

// Monday–Friday working week.
const WEEKDAY_COUNT = 5;

/**
 * Calendar: Week. A single provider is selected via the top-right dropdown;
 * columns are the days of the week (Mon–Fri). Data is today's loaded sessions,
 * so only today's column populates — other days render empty (the prototype
 * doesn't fetch historical/future appointments yet).
 */
export function CalendarWeek({
  groups,
  now,
  onAction,
  onPatientClick,
  modeToggle,
}: CalendarWeekProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [providerId, setProviderId] = useState<string>(
    groups[0]?.room_id ?? ""
  );

  // Keep selection valid if the group set changes (location switch, etc.).
  const selectedGroup =
    groups.find((g) => g.room_id === providerId) ?? groups[0] ?? null;

  const weekStart = startOfWeek(addWeeks(now, weekOffset), {
    weekStartsOn: 1,
  });
  const days = useMemo(
    () => Array.from({ length: WEEKDAY_COUNT }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const gridHeight = HOURS.length * HOUR_HEIGHT;
  const isThisWeek = weekOffset === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Nav + provider selector */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200">
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => setWeekOffset((w) => w + 1)}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Next week"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-sm font-semibold text-gray-800">
          Week of {format(weekStart, "d MMM")}
        </span>
        {!isThisWeek && (
          <button
            onClick={() => setWeekOffset(0)}
            className="ml-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            This week
          </button>
        )}

        {modeToggle && <span className="ml-2">{modeToggle}</span>}

        <div className="flex-1" />

        <ProviderSelect
          groups={groups}
          selectedId={selectedGroup?.room_id ?? ""}
          onChange={setProviderId}
        />
      </div>

      {/* Header row: day labels */}
      <div className="flex border-b border-gray-200 bg-gray-50/50">
        <div style={{ width: GUTTER_WIDTH }} className="flex-shrink-0" />
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className="flex-1 min-w-[120px] border-l border-gray-200 px-3 py-2 text-center"
            >
              <div
                className={`text-sm font-semibold ${
                  today ? "text-teal-600" : "text-gray-800"
                }`}
              >
                {format(day, "EEE")}
              </div>
              <div
                className={`text-[11px] ${
                  today ? "text-teal-600" : "text-gray-400"
                }`}
              >
                {format(day, "d MMM")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid — fixed window, scrolls internally so the nav
          and day headers stay pinned and the page itself doesn't grow. */}
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <div className="flex" style={{ height: gridHeight }}>
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

          {days.map((day) => {
            const today = isSameDay(day, now);
            // Today-only data: a session lands on a day column when its
            // scheduled date matches that column's date.
            const daySessions = selectedGroup
              ? selectedGroup.sessions.filter(
                  (s) =>
                    s.scheduled_at &&
                    isSameDay(new Date(s.scheduled_at), day)
                )
              : [];
            return (
              <div
                key={day.toISOString()}
                className="relative flex-1 min-w-[120px] border-l border-gray-200"
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
                  />
                ))}
                {today && <NowLine now={now} />}
                {daySessions.map((session) => (
                  <CalendarBlock
                    key={session.session_id}
                    session={session}
                    onAction={onAction}
                    onPatientClick={onPatientClick}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProviderSelect({
  groups,
  selectedId,
  onChange,
}: {
  groups: RoomGroup[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, handleOutside]);

  const selected = groups.find((g) => g.room_id === selectedId);
  const label = selected?.clinician_name ?? selected?.room_name ?? "Provider";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
      >
        {label}
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-48 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
          {groups.map((group) => (
            <button
              key={group.room_id}
              onClick={() => {
                onChange(group.room_id);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${
                group.room_id === selectedId
                  ? "text-teal-600 font-medium"
                  : "text-gray-700"
              }`}
            >
              {group.clinician_name ?? group.room_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
