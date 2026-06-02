"use client";

import { useMemo, useCallback, useState } from "react";
import type {
  ReadinessAppointment,
  StandaloneSubmissionRow as StandaloneSubmissionRowType,
} from "@/stores/clinic-store";
import { type ReadinessPriority } from "@/lib/readiness/derived-state";
import type { PatientSeed } from "@/components/clinic/patient/patient-contact-card/types";
import { Badge } from "@/components/ui/badge";
import { PatientRow } from "./patient-row";
import { StandaloneSubmissionRow } from "./standalone-submission-row";
import { PRIORITY_SLOTS } from "./types";

interface ReadinessTableProps {
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

export function ReadinessTable({
  appointments,
  standaloneRows,
  now,
  onPatientDetail,
  onPatientIntent,
  onAction,
  onActionIntent,
  onReviewStandalone,
  onReviewStandaloneIntent,
}: ReadinessTableProps) {
  const [collapsedSlots, setCollapsedSlots] = useState<Set<ReadinessPriority>>(
    new Set(["recently_completed"])
  );

  const slotGroups = useMemo(() => {
    const groups = new Map<ReadinessPriority, ReadinessAppointment[]>();
    for (const slot of PRIORITY_SLOTS) {
      groups.set(slot.key, []);
    }
    for (const appt of appointments) {
      const key = appt.priority as ReadinessPriority;
      groups.get(key)?.push(appt);
    }
    return groups;
  }, [appointments]);

  const totalItems = appointments.length;

  const toggleSlot = useCallback((slot: ReadinessPriority) => {
    setCollapsedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }, []);

  if (totalItems === 0 && standaloneRows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
        <p className="text-gray-500">
          All patients are on track. No outstanding workflow items.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {PRIORITY_SLOTS.map((slot) => {
        const items = slotGroups.get(slot.key) ?? [];
        // Standalone submissions piggy-back on the Form Completed slot —
        // the same staff action (review the contents of a submitted form).
        // They share the slot's count and visual treatment.
        const slotStandaloneRows =
          slot.key === "form_completed_needs_transcription"
            ? standaloneRows
            : [];
        if (items.length === 0 && slotStandaloneRows.length === 0) return null;

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

              <span className="text-lg font-semibold text-gray-800 truncate">
                {slot.label}
              </span>

              <Badge
                variant={
                  slot.badgeVariant as "red" | "amber" | "gray" | "faded"
                }
              >
                {items.length + slotStandaloneRows.length}
              </Badge>
            </button>

            {/* Rows */}
            {!isCollapsed && (
              <div>
                {slotStandaloneRows.map((row) => (
                  <StandaloneSubmissionRow
                    key={row.id}
                    row={row}
                    onPatientClick={() =>
                      onPatientDetail(null, row.patient_id, {
                        id: row.patient_id,
                        firstName: row.patient_first_name,
                        lastName: row.patient_last_name,
                        // Standalone rows carry no phone — omit so the contact
                        // section shimmers rather than showing a false "none".
                      })
                    }
                    onPatientIntent={() => onPatientIntent(null, row.patient_id)}
                    onReview={() => onReviewStandalone(row)}
                    onReviewIntent={() => onReviewStandaloneIntent(row)}
                  />
                ))}
                {items.map((appt) => (
                  <PatientRow
                    key={appt.appointment_id}
                    appointment={appt}
                    slot={slot}
                    now={now}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
