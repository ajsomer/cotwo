"use client";

import { useState, useMemo, useCallback } from "react";
import { useClinicStore } from "@/stores/clinic-store";
import type { ReadinessAppointment, ReadinessDirection } from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import {
  getPriorityBadgeConfig,
  getActionButtonConfig,
  isAttentionPriority,
  getTriggeringActions,
} from "@/lib/readiness/derived-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionTypeIcon } from "@/components/clinic/action-type-icon";
import type { ActionType } from "@/lib/workflows/types";
import { ReadinessModeToggle } from "@/components/clinic/readiness-mode-toggle";
import {
  ReadinessFilterBar,
  type ReadinessFilters,
} from "@/components/clinic/readiness-filter-bar";
import dynamic from "next/dynamic";

const AddPatientPanel = dynamic(
  () =>
    import("@/components/clinic/add-patient-panel").then(
      (m) => m.AddPatientPanel
    ),
  { ssr: false }
);

import { PatientContactCard } from "@/components/clinic/patient-contact-card";

const FormHandoffPanel = dynamic(
  () =>
    import("@/components/clinic/form-handoff-panel").then(
      (m) => m.FormHandoffPanel
    ),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivePanel =
  | { type: "add-patient" }
  | { type: "detail"; appointment: ReadinessAppointment }
  | {
      type: "form-handoff";
      appointment: ReadinessAppointment;
      actionId: string;
      formName: string;
    }
  | null;

// ---------------------------------------------------------------------------
// Priority slot config — matches run sheet room card pattern
// ---------------------------------------------------------------------------

const PRIORITY_SLOTS: {
  key: ReadinessPriority;
  label: string;
  borderColor: string;
  rowTint: string;
  badgeVariant: string;
}[] = [
  {
    key: "overdue",
    label: "Overdue",
    borderColor: "border-l-red-500",
    rowTint: "bg-red-500/[0.03]",
    badgeVariant: "red",
  },
  {
    key: "form_completed_needs_transcription",
    label: "Form Completed",
    borderColor: "border-l-amber-500",
    rowTint: "bg-amber-500/[0.03]",
    badgeVariant: "amber",
  },
  {
    key: "at_risk",
    label: "At Risk",
    borderColor: "border-l-amber-500",
    rowTint: "bg-amber-500/[0.03]",
    badgeVariant: "amber",
  },
  {
    key: "in_progress",
    label: "In Progress",
    borderColor: "border-l-gray-200",
    rowTint: "",
    badgeVariant: "gray",
  },
  {
    key: "recently_completed",
    label: "Completed",
    borderColor: "border-l-gray-200",
    rowTint: "",
    badgeVariant: "faded",
  },
];

const ACTION_BUTTON_VARIANT_MAP: Record<string, "danger" | "accent" | "primary"> = {
  red: "danger",
  amber: "accent",
  teal: "primary",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    return d.toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 0) {
    const futureMins = Math.abs(mins);
    if (futureMins < 60) return `in ${futureMins}m`;
    const hrs = Math.floor(futureMins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `in ${days}d`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const ACTION_STATUS_BADGE: Record<string, { label: string; variant: string }> =
  {
    scheduled: { label: "Scheduled", variant: "gray" },
    pending: { label: "Pending", variant: "gray" },
    firing: { label: "Firing", variant: "amber" },
    sent: { label: "Sent", variant: "amber" },
    opened: { label: "Opened", variant: "amber" },
    completed: { label: "Completed", variant: "teal" },
    captured: { label: "Captured", variant: "teal" },
    verified: { label: "Verified", variant: "teal" },
    transcribed: { label: "Transcribed", variant: "teal" },
    skipped: { label: "Skipped", variant: "gray" },
    failed: { label: "Failed", variant: "red" },
    cancelled: { label: "Cancelled", variant: "gray" },
  };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReadinessShell() {
  const appointments = useClinicStore((s) => s.readinessAppointments);
  const loaded = useClinicStore((s) => s.readinessLoaded);
  const direction = useClinicStore((s) => s.readinessDirection);
  const counts = useClinicStore((s) => s.readinessCounts);
  const setDirection = useClinicStore((s) => s.setReadinessDirection);
  const rooms = useClinicStore((s) => s.rooms);
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes);
  const locationId = useClinicStore((s) => s.locationId);
  const orgId = useClinicStore((s) => s.orgId);
  const refreshReadiness = useClinicStore((s) => s.refreshReadiness);

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(
    new Set()
  );
  const [collapsedSlots, setCollapsedSlots] = useState<Set<ReadinessPriority>>(
    new Set(["recently_completed"])
  );
  const [filters, setFilters] = useState<ReadinessFilters>({
    roomIds: new Set(),
    typeIds: new Set(),
    statuses: new Set(),
  });

  const now = useMemo(() => new Date(), []);

  // Filter appointments client-side
  const filtered = useMemo(() => {
    return appointments.filter((appt) => {
      if (filters.roomIds.size > 0) {
        const roomId = rooms.find((r) => r.name === appt.room_name)?.id;
        if (!roomId || !filters.roomIds.has(roomId)) return false;
      }

      if (filters.typeIds.size > 0) {
        const typeId = appointmentTypes.find(
          (t) => t.name === appt.appointment_type_name
        )?.id;
        if (!typeId || !filters.typeIds.has(typeId)) return false;
      }

      if (filters.statuses.size > 0) {
        if (!filters.statuses.has(appt.priority as ReadinessPriority))
          return false;
      }

      return true;
    });
  }, [appointments, filters, rooms, appointmentTypes]);

  // Group by priority slot
  const slotGroups = useMemo(() => {
    const groups = new Map<ReadinessPriority, ReadinessAppointment[]>();
    for (const slot of PRIORITY_SLOTS) {
      groups.set(slot.key, []);
    }
    for (const appt of filtered) {
      const key = appt.priority as ReadinessPriority;
      groups.get(key)?.push(appt);
    }
    return groups;
  }, [filtered]);

  const totalItems = filtered.length;

  const hasPreOverdue = useMemo(
    () =>
      direction === "pre_appointment"
        ? appointments.some((a) => a.priority === "overdue")
        : false,
    [appointments, direction]
  );
  const hasPostOverdue = useMemo(
    () =>
      direction === "post_appointment"
        ? appointments.some((a) => a.priority === "overdue")
        : false,
    [appointments, direction]
  );

  const toggleRow = useCallback(
    (id: string) => {
      if (expandedIds.has(id)) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setManuallyCollapsed((prev) => new Set(prev).add(id));
      } else {
        setExpandedIds((prev) => new Set(prev).add(id));
        setManuallyCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [expandedIds]
  );

  const toggleSlot = useCallback((slot: ReadinessPriority) => {
    setCollapsedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }, []);

  const handleActionButton = useCallback(
    (appt: ReadinessAppointment) => {
      const priority = appt.priority as ReadinessPriority;
      if (priority === "overdue") {
        setActivePanel({ type: "detail", appointment: appt });
      } else if (priority === "form_completed_needs_transcription") {
        const formAction = appt.actions.find(
          (a) => a.action_type === "deliver_form" && a.status === "completed"
        );
        if (formAction) {
          setActivePanel({
            type: "form-handoff",
            appointment: appt,
            actionId: formAction.action_id,
            formName: formAction.form_name ?? "Unknown form",
          });
        }
      }
      // at_risk "Nudge" would trigger SMS — stubbed for prototype
    },
    []
  );

  const handleSaved = useCallback(() => {
    setActivePanel(null);
    if (locationId) refreshReadiness(locationId);
  }, [locationId, refreshReadiness]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!loaded) {
    return (
      <div className="p-6 max-w-[860px] mx-auto space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <div className="px-6 py-2.5 border-b border-gray-200">
              <div className="h-5 w-24 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="space-y-0">
              {[1, 2].map((j) => (
                <div
                  key={j}
                  className="flex items-stretch border-b border-gray-200 last:border-b-0"
                >
                  <div className="w-[94px] flex-shrink-0 bg-[#FAF9F7] h-12" />
                  <div className="flex-1 h-12 px-5 flex items-center">
                    <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Header — matches run sheet header card */}
      <div className="flex items-center bg-white rounded-xl border border-gray-200 px-6 py-2.5 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-gray-800">Readiness</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ReadinessModeToggle
            direction={direction}
            counts={counts}
            hasPreOverdue={hasPreOverdue}
            hasPostOverdue={hasPostOverdue}
            onChange={setDirection}
          />
          <div className="w-px h-5 bg-gray-200" />
          <button
            onClick={() => setActivePanel({ type: "add-patient" })}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 transition-colors"
          >
            + Add patient
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <ReadinessFilterBar
          rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
          appointmentTypes={appointmentTypes.map((t) => ({
            id: t.id,
            name: t.name,
          }))}
          filters={filters}
          onChange={setFilters}
        />
      </div>

      {/* Priority slot cards */}
      {totalItems === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
          <p className="text-gray-500">
            All patients are on track. No outstanding workflow items.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {PRIORITY_SLOTS.map((slot) => {
            const items = slotGroups.get(slot.key) ?? [];
            if (items.length === 0) return null;

            const isCollapsed = collapsedSlots.has(slot.key);

            return (
              <div
                key={slot.key}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                {/* Slot header — matches room header */}
                <button
                  onClick={() => toggleSlot(slot.key)}
                  className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-200 transition-colors w-full text-left hover:bg-gray-50/50"
                >
                  {/* Chevron */}
                  <svg
                    className={`h-5 w-5 text-gray-400 transition-transform flex-shrink-0 ${
                      !isCollapsed ? "rotate-90" : ""
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

                  {/* Slot name */}
                  <span className="text-lg font-semibold text-gray-800 truncate">
                    {slot.label}
                  </span>

                  {/* Count badge */}
                  <Badge variant={slot.badgeVariant as "red" | "amber" | "gray" | "faded"}>
                    {items.length}
                  </Badge>
                </button>

                {/* Rows */}
                {!isCollapsed && (
                  <div>
                    {items.map((appt) => {
                      const isManuallyExpanded = expandedIds.has(appt.appointment_id);
                      const isAutoExpanded =
                        isAttentionPriority(
                          appt.priority as ReadinessPriority
                        ) &&
                        !manuallyCollapsed.has(appt.appointment_id);
                      const isRowExpanded = isManuallyExpanded || isAutoExpanded;

                      return (
                        <PatientRow
                          key={appt.appointment_id}
                          appointment={appt}
                          slot={slot}
                          now={now}
                          isExpanded={isRowExpanded}
                          isAutoExpanded={isAutoExpanded && !isManuallyExpanded}
                          onToggle={() => toggleRow(appt.appointment_id)}
                          onNameClick={() =>
                            setActivePanel({
                              type: "detail",
                              appointment: appt,
                            })
                          }
                          onAction={() => handleActionButton(appt)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Panels */}
      {activePanel?.type === "add-patient" && locationId && orgId && (
        <AddPatientPanel
          locationId={locationId}
          orgId={orgId}
          onClose={() => setActivePanel(null)}
          onSaved={handleSaved}
        />
      )}
      {activePanel?.type === "detail" && (
        <PatientContactCard
          open
          patientId={activePanel.appointment.patient_id || null}
          appointment={activePanel.appointment}
          onClose={() => setActivePanel(null)}
          onOpenFormHandoff={(actionId, formName) =>
            setActivePanel({
              type: "form-handoff",
              appointment: activePanel.appointment,
              actionId,
              formName,
            })
          }
          onDeleted={handleSaved}
        />
      )}
      {activePanel?.type === "form-handoff" && locationId && (
        <FormHandoffPanel
          actionId={activePanel.actionId}
          formName={activePanel.formName}
          patientName={`${activePanel.appointment.patient_first_name} ${activePanel.appointment.patient_last_name}`}
          appointmentId={activePanel.appointment.appointment_id}
          onClose={() =>
            setActivePanel({
              type: "detail",
              appointment: activePanel.appointment,
            })
          }
          onTranscribed={handleSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient Row — matches session-row.tsx structure exactly
// ---------------------------------------------------------------------------

function PatientRow({
  appointment,
  slot,
  now,
  isExpanded,
  isAutoExpanded,
  onToggle,
  onNameClick,
  onAction,
}: {
  appointment: ReadinessAppointment;
  slot: (typeof PRIORITY_SLOTS)[number];
  now: Date;
  isExpanded: boolean;
  isAutoExpanded: boolean;
  onToggle: () => void;
  onNameClick: () => void;
  onAction: () => void;
}) {
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
              const statusBadge = ACTION_STATUS_BADGE[action.status] ?? {
                label: action.status,
                variant: "gray",
              };
              const isActionOverdue =
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
