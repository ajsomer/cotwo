"use client";

import type { CalendarMode } from "@/hooks/useRunsheetView";

interface CalendarModeToggleProps {
  mode: CalendarMode;
  onChange: (mode: CalendarMode) => void;
}

const OPTIONS: { value: CalendarMode; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

/**
 * Day/Week segmented control that lives inside the calendar's own nav bar
 * (next to the date stepper and provider selector), rather than in the
 * top-level view toggle.
 */
export function CalendarModeToggle({ mode, onChange }: CalendarModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
      {OPTIONS.map((option) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-gray-100 text-gray-800"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
