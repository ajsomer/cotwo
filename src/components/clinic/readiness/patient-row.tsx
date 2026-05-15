"use client";

import { useState } from "react";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import {
  getPriorityBadgeConfig,
  getActionButtonConfig,
  getTriggeringActions,
} from "@/lib/readiness/derived-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionTypeIcon } from "@/components/clinic/shared/action-type-icon";
import type { ActionType } from "@/lib/workflows/types";
import { formatDateTime, relativeTime } from "./utils";
import {
  ACTION_BUTTON_VARIANT_MAP,
  ACTION_STATUS_BADGE,
  type PrioritySlot,
} from "./types";

interface PatientRowProps {
  appointment: ReadinessAppointment;
  slot: PrioritySlot;
  now: Date;
  isExpanded: boolean;
  isAutoExpanded: boolean;
  onToggle: () => void;
  onNameClick: () => void;
  onAction: () => void;
}

export function PatientRow({
  appointment,
  slot,
  now,
  isExpanded,
  isAutoExpanded,
  onToggle,
  onNameClick,
  onAction,
}: PatientRowProps) {
  const priority = appointment.priority as ReadinessPriority;
  const actionBtn = getActionButtonConfig(priority);
  const triggeringActions = isExpanded
    ? getTriggeringActions(
        appointment as Parameters<typeof getTriggeringActions>[0],
        now
      )
    : [];
  const [showAll, setShowAll] = useState(false);
  // Manual expand → show all actions. Auto-expand → show triggering actions
  // with a "Show all steps" toggle.
  const useFiltered = isAutoExpanded && triggeringActions.length > 0 && !showAll;
  const displayedActions = useFiltered ? triggeringActions : appointment.actions;

  return (
    <div
      className={`border-b border-gray-200 last:border-b-0 ${
        priority === "recently_completed" ? "opacity-40" : ""
      }`}
    >
      {/* Row — matches session-row layout, clickable to expand */}
      <div
        className={`flex items-stretch border-l-[3px] ${slot.borderColor} transition-colors ${slot.rowTint} cursor-pointer`}
        onClick={() => onToggle()}
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
              >
                {actionBtn.label}
              </Button>
            </div>
          )}

          {/* Expand/collapse chevron */}
          {appointment.actions.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
            >
              <svg
                className={`h-4 w-4 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Expanded workflow timeline */}
      {isExpanded && displayedActions.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50/30 px-5 py-3 ml-[94px]">
          <div className="relative pl-5 space-y-3">
            {/* Vertical timeline line */}
            <div className="absolute left-[3px] top-1 bottom-1 w-px bg-gray-200" />

            {displayedActions.map((action) => {
              // Post-appointment SMS/form past scheduled_for: show as "Done" for demo
              const isPostDemoComplete =
                action.session_id &&
                action.action_type !== "task" &&
                action.status === "scheduled" &&
                action.scheduled_for &&
                new Date(action.scheduled_for) <= now;

              const statusBadge = isPostDemoComplete
                ? { label: "Done", variant: "teal" }
                : ACTION_STATUS_BADGE[action.status] ?? {
                    label: action.status,
                    variant: "gray",
                  };
              const isActionOverdue =
                !isPostDemoComplete &&
                action.status !== "completed" &&
                action.status !== "transcribed" &&
                action.status !== "captured" &&
                action.status !== "verified" &&
                action.status !== "skipped" &&
                action.status !== "failed" &&
                action.scheduled_for &&
                new Date(action.scheduled_for) < now;

              return (
                <div
                  key={action.action_id}
                  className="relative flex items-center gap-3"
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute -left-5 top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full border-2 border-white ${
                      isActionOverdue ? "bg-red-400" : "bg-gray-300"
                    }`}
                  />

                  <ActionTypeIcon
                    actionType={action.action_type as ActionType}
                    size={16}
                    className="text-gray-400 flex-shrink-0"
                  />

                  <span className="text-xs text-gray-700 truncate flex-1 min-w-0">
                    {action.pathway_name && (
                      <span className="text-gray-400">{action.pathway_name} → </span>
                    )}
                    {action.action_label}
                  </span>

                  {action.scheduled_for && (
                    <span className="text-[11px] text-gray-400 flex-shrink-0">
                      {relativeTime(action.scheduled_for)}
                    </span>
                  )}

                  <Badge
                    variant={
                      statusBadge.variant as
                        | "red"
                        | "amber"
                        | "teal"
                        | "gray"
                        | "faded"
                    }
                    className="flex-shrink-0"
                  >
                    {statusBadge.label}
                  </Badge>

                  {action.error_message && (
                    <span
                      className="text-[10px] text-red-500 truncate max-w-[120px] flex-shrink-0"
                      title={action.error_message}
                    >
                      {action.error_message}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show all / show relevant toggle — only for auto-expanded rows */}
          {isAutoExpanded && triggeringActions.length > 0 && triggeringActions.length < appointment.actions.length && (
            showAll ? (
              <button
                onClick={() => setShowAll(false)}
                className="w-full py-1 text-[11px] text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors text-center mt-3"
              >
                Show only relevant
              </button>
            ) : (
              <button
                onClick={() => setShowAll(true)}
                className="w-full py-1 text-[11px] text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors text-center mt-3"
              >
                Show all steps ({appointment.actions.length})
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
