"use client";

import type { WorkflowDirection } from "@/lib/workflows/types";
import { formatFireTime, toOffsetMinutes } from "@/lib/workflows/types";

interface FireTimePickerProps {
  direction: WorkflowDirection;
  offsetMinutes: number;
  onChange: (offsetMinutes: number) => void;
}

type TimeUnit = "minutes" | "hours" | "days";

/**
 * Fire time picker: number input + unit dropdown.
 * Pre-appointment: "X [days|hours|minutes] before"
 * Post-appointment: "Immediately" or "X [days|hours|minutes] after"
 */
export function FireTimePicker({
  direction,
  offsetMinutes,
  onChange,
}: FireTimePickerProps) {
  const isPost = direction === "post_appointment";
  const display = formatFireTime(
    offsetMinutes,
    isPost ? "after" : "before"
  );

  // For post-appointment with 0 offset, show "Immediately" toggle
  const isImmediate = isPost && offsetMinutes === 0;

  const handleValueChange = (newValue: number) => {
    onChange(toOffsetMinutes(Math.max(isPost ? 0 : 1, newValue), display.unit));
  };

  const handleUnitChange = (newUnit: string) => {
    if (newUnit === "immediately") {
      onChange(0);
      return;
    }
    onChange(toOffsetMinutes(display.value || 1, newUnit as TimeUnit));
  };

  const directionLabel = isPost ? "after" : "before";

  const unitOptions = isPost
    ? [
        { value: "immediately", label: "Immediately" },
        { value: "minutes", label: `minutes ${directionLabel}` },
        { value: "hours", label: `hours ${directionLabel}` },
        { value: "days", label: `days ${directionLabel}` },
      ]
    : [
        { value: "minutes", label: `minutes ${directionLabel}` },
        { value: "hours", label: `hours ${directionLabel}` },
        { value: "days", label: `days ${directionLabel}` },
      ];

  const currentUnit = isImmediate ? "immediately" : display.unit;

  return (
    <div className="flex items-center gap-2">
      {!isImmediate && (
        <input
          type="number"
          min={isPost ? 0 : 1}
          max={365}
          value={display.value}
          onChange={(e) => handleValueChange(parseInt(e.target.value) || 1)}
          className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      )}
      <select
        value={currentUnit}
        onChange={(e) => handleUnitChange(e.target.value)}
        className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
      >
        {unitOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Read-only fire time pill for collapsed action cards. */
export function FireTimePill({
  offsetMinutes,
  offsetDirection,
}: {
  offsetMinutes: number;
  offsetDirection: string;
}) {
  const display = formatFireTime(offsetMinutes, offsetDirection);
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
      {display.label}
    </span>
  );
}
