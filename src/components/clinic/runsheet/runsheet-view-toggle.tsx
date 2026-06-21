"use client";

import { Rows3, List, Calendar } from "lucide-react";

export type RunsheetView = "provider" | "list" | "calendar";

const OPTIONS: { value: RunsheetView; label: string; icon: typeof List }[] = [
  { value: "provider", label: "Group by provider", icon: Rows3 },
  { value: "list", label: "Appointment list", icon: List },
  { value: "calendar", label: "Calendar", icon: Calendar },
];

interface RunsheetViewToggleProps {
  view: RunsheetView;
  onChange: (view: RunsheetView) => void;
}

/**
 * Segmented control for the run sheet layout: provider-grouped sections, a
 * flat appointment list, or a day / week calendar. Mirrors the tasks
 * dashboard view toggle.
 */
export function RunsheetViewToggle({ view, onChange }: RunsheetViewToggleProps) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = view === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-gray-100 text-gray-800"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon size={14} className="flex-shrink-0" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
