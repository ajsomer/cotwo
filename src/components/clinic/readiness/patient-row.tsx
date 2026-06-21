"use client";

import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import {
  getPriorityBadgeConfig,
  getActionButtonConfig,
} from "@/lib/readiness/derived-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "./utils";
import { ACTION_BUTTON_VARIANT_MAP, type PrioritySlot } from "./types";

interface PatientRowProps {
  appointment: ReadinessAppointment;
  slot: PrioritySlot;
  now: Date;
  onNameClick: () => void;
  /** Warm the patient-card fetches on hover / pointer-down of the name. */
  onNameIntent?: () => void;
  onAction: () => void;
  /** Warm the review fetch on hover / pointer-down of the action control. */
  onActionIntent?: () => void;
}

export function PatientRow({
  appointment,
  slot,
  onNameClick,
  onNameIntent,
  onAction,
  onActionIntent,
}: PatientRowProps) {
  const priority = appointment.priority as ReadinessPriority;
  const actionBtn = getActionButtonConfig(priority);

  return (
    <div
      className={`border-b border-gray-200 last:border-b-0 ${
        priority === "recently_completed" ? "opacity-40" : ""
      }`}
      // Whole-row hover warms the review fetch — far more lead time than waiting
      // for the pointer to reach the Review button. No-op for non-reviewable
      // rows (handler early-returns). Cheap and capped by the cache's
      // concurrency guard.
      onMouseEnter={onActionIntent}
    >
      {/* Row — matches session-row grid layout */}
      <div
        className={`grid grid-cols-[100px_160px_120px_1fr_auto] items-center border-l-[3px] ${slot.borderColor} transition-colors ${slot.rowTint}`}
      >
        {/* Time column — matches run sheet exactly */}
        <span className="self-stretch flex items-center justify-center text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A] h-12">
          {appointment.scheduled_at ? formatDateTime(appointment.scheduled_at) : "—"}
        </span>

        {/* Patient name column */}
        <div className="flex items-center min-w-0 pl-5 pr-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNameClick();
            }}
            onMouseEnter={onNameIntent}
            onPointerDown={onNameIntent}
            className="text-[14px] font-semibold text-gray-800 truncate leading-none hover:underline hover:text-teal-600 transition-colors"
          >
            {appointment.patient_first_name} {appointment.patient_last_name}
          </button>
        </div>

        {/* Task type column */}
        <div className="flex items-center min-w-0 px-2">
          {appointment.appointment_type_name && (
            <span className="text-xs text-gray-500 truncate leading-none">
              {appointment.appointment_type_name}
            </span>
          )}
        </div>

        {/* Status column */}
        <div className="flex items-center min-w-0 px-2">
          <Badge
            variant={
              getPriorityBadgeConfig(priority).variant as
                | "red"
                | "amber"
                | "teal"
                | "gray"
                | "faded"
            }
            className="flex-shrink-0"
          >
            {getPriorityBadgeConfig(priority).label}
          </Badge>
        </div>

        {/* Action column */}
        <div className="flex items-center justify-end pr-5 pl-3">
          {actionBtn && (
            <Button
              variant={ACTION_BUTTON_VARIANT_MAP[actionBtn.variant] ?? "primary"}
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAction();
              }}
              onMouseEnter={onActionIntent}
              onPointerDown={onActionIntent}
            >
              {actionBtn.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
