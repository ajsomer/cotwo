"use client";

import type { ReadinessDirection, ReadinessCounts } from "@/stores/clinic-store";

interface ReadinessModeToggleProps {
  direction: ReadinessDirection;
  counts: ReadinessCounts;
  hasPreOverdue: boolean;
  hasPostOverdue: boolean;
  onChange: (direction: ReadinessDirection) => void;
}

export function ReadinessModeToggle({
  direction,
  counts,
  hasPreOverdue,
  hasPostOverdue,
  onChange,
}: ReadinessModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => onChange("pre_appointment")}
        className={`px-4 py-2 text-sm font-medium transition-colors border-r border-gray-200 ${
          direction === "pre_appointment"
            ? "bg-teal-500 text-white"
            : "bg-white text-gray-800 hover:bg-gray-50"
        }`}
      >
        Pre-appointment{" "}
        <span
          className={
            direction !== "pre_appointment" && hasPreOverdue
              ? "text-red-500 font-semibold"
              : ""
          }
        >
          ({counts.pre})
        </span>
      </button>
      <button
        onClick={() => onChange("post_appointment")}
        className={`px-4 py-2 text-sm font-medium transition-colors ${
          direction === "post_appointment"
            ? "bg-teal-500 text-white"
            : "bg-white text-gray-800 hover:bg-gray-50"
        }`}
      >
        Post-appointment{" "}
        <span
          className={
            direction !== "post_appointment" && hasPostOverdue
              ? "text-red-500 font-semibold"
              : ""
          }
        >
          ({counts.post})
        </span>
      </button>
    </div>
  );
}
