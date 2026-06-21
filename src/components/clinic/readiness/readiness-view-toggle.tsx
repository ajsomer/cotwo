"use client";

import { LayoutGrid, List, Rows3 } from "lucide-react";

export type ReadinessView = "status" | "list" | "kanban";

const OPTIONS: { value: ReadinessView; label: string; icon: typeof List }[] = [
  { value: "status", label: "Group by status", icon: Rows3 },
  { value: "list", label: "Task list", icon: List },
  { value: "kanban", label: "Kanban", icon: LayoutGrid },
];

interface ReadinessViewToggleProps {
  view: ReadinessView;
  onChange: (view: ReadinessView) => void;
}

/**
 * Segmented control letting staff switch how tasks are laid out: the existing
 * status-grouped sections, a flat task list, or a Kanban board. Sits at the
 * left of the filter bar.
 */
export function ReadinessViewToggle({ view, onChange }: ReadinessViewToggleProps) {
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
