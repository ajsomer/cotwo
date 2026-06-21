"use client";

import { useMemo } from "react";
import type {
  ReadinessAppointment,
  StandaloneSubmissionRow as StandaloneSubmissionRowType,
} from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import type { PatientSeed } from "@/components/clinic/patient/patient-contact-card/types";
import { PatientRow } from "./patient-row";
import { StandaloneSubmissionRow } from "./standalone-submission-row";
import { PRIORITY_SLOTS } from "./types";

interface ReadinessTaskListProps {
  appointments: ReadinessAppointment[];
  standaloneRows: StandaloneSubmissionRowType[];
  now: Date;
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

// Priority display order, derived from the canonical slot list so the flat
// list sorts the same way the grouped view stacks its sections.
const PRIORITY_ORDER = new Map<ReadinessPriority, number>(
  PRIORITY_SLOTS.map((slot, i) => [slot.key, i])
);

// Slot lookup so each flat row keeps its priority-coloured left border / tint.
const SLOT_BY_KEY = new Map(PRIORITY_SLOTS.map((slot) => [slot.key, slot]));
const FORM_COMPLETED_SLOT = SLOT_BY_KEY.get(
  "form_completed_needs_transcription"
)!;

/**
 * Flat "Task list" view: every outstanding item in one continuous table,
 * ungrouped, under a column-header row. Sorted by priority then scheduled
 * time. Reuses the same row components (and grid columns) as the grouped view.
 */
export function ReadinessTaskList({
  appointments,
  standaloneRows,
  now,
  onPatientDetail,
  onPatientIntent,
  onAction,
  onActionIntent,
  onReviewStandalone,
  onReviewStandaloneIntent,
}: ReadinessTaskListProps) {
  const sortedAppointments = useMemo(() => {
    return [...appointments].sort((a, b) => {
      const pa = PRIORITY_ORDER.get(a.priority as ReadinessPriority) ?? 99;
      const pb = PRIORITY_ORDER.get(b.priority as ReadinessPriority) ?? 99;
      if (pa !== pb) return pa - pb;
      const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return ta - tb;
    });
  }, [appointments]);

  if (appointments.length === 0 && standaloneRows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-500">
          All patients are on track. No outstanding workflow items.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Column header — grid template matches the row layout exactly */}
      <div className="grid grid-cols-[100px_160px_120px_1fr_auto] items-center border-b border-gray-200 bg-gray-50/50 h-9 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <span className="flex items-center justify-center">Time</span>
        <span className="pl-5 pr-2">Patient</span>
        <span className="px-2">Task</span>
        <span className="px-2">Status</span>
        <span className="pr-5" />
      </div>

      {/* Standalone submissions first (Form Completed equivalent), then the
          priority-sorted appointment rows. */}
      {standaloneRows.map((row) => (
        <StandaloneSubmissionRow
          key={row.id}
          row={row}
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
      {sortedAppointments.map((appt) => {
        const slot =
          SLOT_BY_KEY.get(appt.priority as ReadinessPriority) ??
          FORM_COMPLETED_SLOT;
        return (
          <PatientRow
            key={appt.appointment_id}
            appointment={appt}
            slot={slot}
            now={now}
            onNameClick={() => onPatientDetail(appt, appt.patient_id ?? "")}
            onNameIntent={() => onPatientIntent(appt, appt.patient_id ?? "")}
            onAction={() => onAction(appt)}
            onActionIntent={() => onActionIntent(appt)}
          />
        );
      })}
    </div>
  );
}
