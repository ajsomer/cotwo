"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";

interface Room {
  id: string;
  name: string;
}

interface AppointmentType {
  id: string;
  name: string;
}

export interface ReadinessFilters {
  roomIds: Set<string>;
  typeIds: Set<string>;
  statuses: Set<ReadinessPriority>;
}

interface ReadinessFilterBarProps {
  rooms: Room[];
  appointmentTypes: AppointmentType[];
  filters: ReadinessFilters;
  onChange: (filters: ReadinessFilters) => void;
}

const STATUS_OPTIONS: {
  value: ReadinessPriority;
  label: string;
  dotColor: string;
}[] = [
  { value: "overdue", label: "Overdue", dotColor: "bg-red-500" },
  {
    value: "form_completed_needs_transcription",
    label: "Form Completed",
    dotColor: "bg-amber-500",
  },
  { value: "at_risk", label: "At Risk", dotColor: "bg-amber-500" },
  { value: "in_progress", label: "In Progress", dotColor: "bg-gray-300" },
  { value: "recently_completed", label: "Completed", dotColor: "bg-gray-200" },
];

// ---------------------------------------------------------------------------
// FilterDropdown — reusable multi-select dropdown
// ---------------------------------------------------------------------------

function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  renderOption,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: Set<T>;
  onChange: (selected: Set<T>) => void;
  renderOption?: (option: { value: T; label: string }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [open, handleClickOutside, handleEscape]);

  const toggle = (value: T) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const count = selected.size;
  const hasSelections = count > 0;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          hasSelections
            ? "border border-teal-500 bg-teal-500/5 text-gray-800"
            : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
        }`}
      >
        <span className="font-medium">{label}</span>
        {hasSelections && (
          <span className="inline-flex items-center justify-center rounded-full bg-teal-500 text-white text-[10px] font-semibold leading-none min-w-[18px] h-[18px] px-1">
            {count}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-56 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => toggle(option.value)}
              className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {/* Checkbox */}
              <span
                className={`flex-shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center ${
                  selected.has(option.value)
                    ? "bg-teal-500 border-teal-500"
                    : "border-gray-300 bg-white"
                }`}
              >
                {selected.has(option.value) && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </span>

              {/* Option content */}
              {renderOption ? (
                renderOption(option)
              ) : (
                <span className="truncate">{option.label}</span>
              )}
            </button>
          ))}

          {/* Clear */}
          {hasSelections && (
            <button
              onClick={() => onChange(new Set())}
              className="w-full text-left px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-800 border-t border-gray-100 mt-1 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadinessFilterBar
// ---------------------------------------------------------------------------

export function ReadinessFilterBar({
  rooms,
  appointmentTypes,
  filters,
  onChange,
}: ReadinessFilterBarProps) {
  const hasAnyFilter =
    filters.roomIds.size > 0 ||
    filters.typeIds.size > 0 ||
    filters.statuses.size > 0;

  return (
    <div className="flex items-center gap-2">
      {/* Room dropdown */}
      {rooms.length > 0 && (
        <FilterDropdown
          label="Room"
          options={rooms.map((r) => ({ value: r.id, label: r.name }))}
          selected={filters.roomIds}
          onChange={(roomIds) => onChange({ ...filters, roomIds })}
        />
      )}

      {/* Type dropdown */}
      {appointmentTypes.length > 0 && (
        <FilterDropdown
          label="Type"
          options={appointmentTypes.map((t) => ({ value: t.id, label: t.name }))}
          selected={filters.typeIds}
          onChange={(typeIds) => onChange({ ...filters, typeIds })}
        />
      )}

      {/* Status dropdown */}
      <FilterDropdown
        label="Status"
        options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
        selected={filters.statuses}
        onChange={(statuses) => onChange({ ...filters, statuses })}
        renderOption={(option) => {
          const dot = STATUS_OPTIONS.find((s) => s.value === option.value);
          return (
            <span className="flex items-center gap-2 truncate">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  dot?.dotColor ?? "bg-gray-300"
                }`}
              />
              {option.label}
            </span>
          );
        }}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear all */}
      {hasAnyFilter && (
        <button
          onClick={() =>
            onChange({
              roomIds: new Set(),
              typeIds: new Set(),
              statuses: new Set(),
            })
          }
          className="text-[11px] text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
