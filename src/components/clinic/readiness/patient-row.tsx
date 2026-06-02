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
      {/* Row — matches session-row layout */}
      <div
        className={`flex items-stretch border-l-[3px] ${slot.borderColor} transition-colors ${slot.rowTint}`}
      >
        {/* Time column — matches run sheet exactly */}
        <span className="flex items-center justify-center w-[94px] flex-shrink-0 text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A]">
          {appointment.scheduled_at ? formatDateTime(appointment.scheduled_at) : "—"}
        </span>

        {/* Content area — matches session-row h-12, px-5 */}
        <div className="flex items-center flex-1 min-w-0 px-5 h-12">
          {/* Patient name */}
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

          {/* Separator + appointment type */}
          {appointment.appointment_type_name && (
            <>
              <span className="mx-2 text-gray-300 leading-none flex-shrink-0">
                &middot;
              </span>
              <span className="text-xs text-gray-500 truncate flex-shrink min-w-0 leading-none">
                {appointment.appointment_type_name}
              </span>
            </>
          )}

          {/* Separator + room */}
          {appointment.room_name && (
            <>
              <span className="mx-2 text-gray-300 leading-none flex-shrink-0">
                &middot;
              </span>
              <span className="text-xs text-gray-500 truncate flex-shrink min-w-0 leading-none">
                {appointment.room_name}
              </span>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Status badge */}
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

          {/* Action button — uses Button component matching run sheet */}
          {actionBtn && (
            <div className="ml-2 flex-shrink-0">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
