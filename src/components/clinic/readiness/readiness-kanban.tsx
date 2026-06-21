"use client";

import { useMemo } from "react";
import type {
  ReadinessAppointment,
  StandaloneSubmissionRow as StandaloneSubmissionRowType,
} from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import {
  getPriorityBadgeConfig,
  getActionButtonConfig,
} from "@/lib/readiness/derived-state";
import type { PatientSeed } from "@/components/clinic/patient/patient-contact-card/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "./utils";
import {
  PRIORITY_SLOTS,
  ACTION_BUTTON_VARIANT_MAP,
  type PrioritySlot,
} from "./types";

type BadgeVariant = "red" | "amber" | "teal" | "gray" | "faded";

interface ReadinessKanbanProps {
  appointments: ReadinessAppointment[];
  standaloneRows: StandaloneSubmissionRowType[];
  onPatientDetail: (
    appointment: ReadinessAppointment | null,
    patientId: string,
    patientSeed?: PatientSeed | null
  ) => void;
  onPatientIntent: (
    appointment: ReadinessAppointment | null,
    patientId: string
  ) => void;
  onAction: (appointment: ReadinessAppointment) => void;
  onActionIntent: (appointment: ReadinessAppointment) => void;
  onReviewStandalone: (row: StandaloneSubmissionRowType) => void;
  onReviewStandaloneIntent: (row: StandaloneSubmissionRowType) => void;
}

/**
 * Kanban view: one column per priority slot, each holding a vertical stack of
 * task cards. Breaks out of the page's left column to use the full width —
 * the shell drops its max-width wrapper when this view is active.
 */
export function ReadinessKanban({
  appointments,
  standaloneRows,
  onPatientDetail,
  onPatientIntent,
  onAction,
  onActionIntent,
  onReviewStandalone,
  onReviewStandaloneIntent,
}: ReadinessKanbanProps) {
  const slotGroups = useMemo(() => {
    const groups = new Map<ReadinessPriority, ReadinessAppointment[]>();
    for (const slot of PRIORITY_SLOTS) groups.set(slot.key, []);
    for (const appt of appointments) {
      groups.get(appt.priority as ReadinessPriority)?.push(appt);
    }
    return groups;
  }, [appointments]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {PRIORITY_SLOTS.map((slot) => {
        const items = slotGroups.get(slot.key) ?? [];
        const slotStandaloneRows =
          slot.key === "form_completed_needs_transcription"
            ? standaloneRows
            : [];
        const count = items.length + slotStandaloneRows.length;

        return (
          <div
            key={slot.key}
            className="flex-1 min-w-[240px] flex flex-col"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-1 pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {slot.label}
              </span>
              <Badge variant={slot.badgeVariant as BadgeVariant}>{count}</Badge>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2">
              {slotStandaloneRows.map((row) => (
                <StandaloneKanbanCard
                  key={row.id}
                  row={row}
                  slot={slot}
                  onPatientClick={() =>
                    onPatientDetail(null, row.patient_id, {
                      id: row.patient_id,
                      firstName: row.patient_first_name,
                      lastName: row.patient_last_name,
                    })
                  }
                  onPatientIntent={() => onPatientIntent(null, row.patient_id)}
                  onReview={() => onReviewStandalone(row)}
                  onReviewIntent={() => onReviewStandaloneIntent(row)}
                />
              ))}
              {items.map((appt) => (
                <AppointmentKanbanCard
                  key={appt.appointment_id}
                  appointment={appt}
                  slot={slot}
                  onNameClick={() =>
                    onPatientDetail(appt, appt.patient_id ?? "")
                  }
                  onNameIntent={() =>
                    onPatientIntent(appt, appt.patient_id ?? "")
                  }
                  onAction={() => onAction(appt)}
                  onActionIntent={() => onActionIntent(appt)}
                />
              ))}

              {count === 0 && (
                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
                  None
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CardShell({
  slot,
  children,
}: {
  slot: PrioritySlot;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white border-l-[3px] ${slot.borderColor} px-3 py-2.5 shadow-sm`}
    >
      {children}
    </div>
  );
}

function AppointmentKanbanCard({
  appointment,
  slot,
  onNameClick,
  onNameIntent,
  onAction,
  onActionIntent,
}: {
  appointment: ReadinessAppointment;
  slot: PrioritySlot;
  onNameClick: () => void;
  onNameIntent: () => void;
  onAction: () => void;
  onActionIntent: () => void;
}) {
  const priority = appointment.priority as ReadinessPriority;
  const actionBtn = getActionButtonConfig(priority);
  const badge = getPriorityBadgeConfig(priority);

  return (
    <CardShell slot={slot}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNameClick();
            }}
            onMouseEnter={onNameIntent}
            onPointerDown={onNameIntent}
            className="block text-[13px] font-semibold text-gray-800 truncate hover:underline hover:text-teal-600 transition-colors"
          >
            {appointment.patient_first_name} {appointment.patient_last_name}
          </button>
          {appointment.appointment_type_name && (
            <span className="block text-xs text-gray-500 truncate mt-0.5">
              {appointment.appointment_type_name}
            </span>
          )}
        </div>
        {appointment.scheduled_at && (
          <span className="flex-shrink-0 text-[11px] font-medium text-gray-400 whitespace-nowrap">
            {formatDateTime(appointment.scheduled_at)}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant={badge.variant as BadgeVariant} className="flex-shrink-0">
          {badge.label}
        </Badge>
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
    </CardShell>
  );
}

function StandaloneKanbanCard({
  row,
  slot,
  onPatientClick,
  onPatientIntent,
  onReview,
  onReviewIntent,
}: {
  row: StandaloneSubmissionRowType;
  slot: PrioritySlot;
  onPatientClick: () => void;
  onPatientIntent: () => void;
  onReview: () => void;
  onReviewIntent: () => void;
}) {
  return (
    <CardShell slot={slot}>
      <div className="min-w-0">
        <button
          onClick={onPatientClick}
          onMouseEnter={onPatientIntent}
          onPointerDown={onPatientIntent}
          className="block text-[13px] font-semibold text-gray-800 truncate hover:underline hover:text-teal-600 transition-colors"
        >
          {row.patient_name}
        </button>
        <span className="block text-xs text-gray-500 truncate mt-0.5">
          {row.form_name}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant="amber" className="flex-shrink-0">
          Form completed
        </Badge>
        <Button
          variant="accent"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onReview();
          }}
          onMouseEnter={onReviewIntent}
          onPointerDown={onReviewIntent}
        >
          Review
        </Button>
      </div>
    </CardShell>
  );
}
