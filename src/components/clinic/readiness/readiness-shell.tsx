"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import { Button } from "@/components/ui/button";
import { ReadinessModeToggle } from "@/components/clinic/readiness/readiness-mode-toggle";
import {
  ReadinessFilterBar,
  type ReadinessFilters,
} from "@/components/clinic/readiness/readiness-filter-bar";
import { resolveTask } from "@/lib/runsheet/actions";
import dynamic from "next/dynamic";
import { ReadinessTable } from "./readiness-table";
import type { ActivePanel } from "./types";
import { FormHandoffPanel } from "@/components/clinic/forms/form-handoff-panel";
import { IntakePackageHandoffPanel } from "@/components/clinic/forms/intake-package-handoff-panel";
import { StandaloneSubmissionPanel } from "@/components/clinic/forms/standalone-submission-panel";
import { PatientContactCard } from "@/components/clinic/patient/patient-contact-card";

const AddPatientPanel = dynamic(
  () =>
    import("@/components/clinic/patient/add-patient-panel").then(
      (m) => m.AddPatientPanel
    ),
  { ssr: false }
);

export function ReadinessShell() {
  const direction = useClinicStore((s) => s.readinessDirection);
  const appointmentsPre = useClinicStore((s) => s.readinessAppointmentsPre);
  const appointmentsPost = useClinicStore((s) => s.readinessAppointmentsPost);
  const appointments =
    direction === "pre_appointment" ? appointmentsPre : appointmentsPost;
  const loadedPre = useClinicStore((s) => s.readinessLoadedPre);
  const loadedPost = useClinicStore((s) => s.readinessLoadedPost);
  const loaded = direction === "pre_appointment" ? loadedPre : loadedPost;
  const counts = useClinicStore((s) => s.readinessCounts);
  const setDirection = useClinicStore((s) => s.setReadinessDirection);
  const rooms = useClinicStore((s) => s.rooms);
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes);
  const locationId = useClinicStore((s) => s.locationId);
  const orgId = useClinicStore((s) => s.orgId);
  const refreshReadiness = useClinicStore((s) => s.refreshReadiness);

  // Standalone-form submissions — fold into the Form Completed slot. Only
  // shown on the pre-appointment view; standalone submissions are
  // conceptually pre-appointment items by design.
  const standaloneSubmissions = useClinicStore((s) => s.standaloneSubmissions);
  const showStandaloneRows = direction === "pre_appointment";
  const standaloneRows = showStandaloneRows ? standaloneSubmissions : [];

  // Fetch-if-empty
  useEffect(() => {
    if (!locationId) return;
    const store = useClinicStore.getState();
    if (!store.readinessLoadedPre || !store.readinessLoadedPost) {
      void store.refreshReadiness(locationId);
    }
    if (!store.roomsLoaded) void store.refreshRooms(locationId);
    if (orgId && !store.workflowsLoaded) {
      void store.refreshWorkflows(orgId);
    }
    if (orgId) {
      // Standalone submissions live on the org room; the clinic-data
      // provider also refreshes on socket connect, this covers the
      // first-render-after-cold-load case.
      if (!store.standaloneSubmissionsLoaded) {
        void store.refreshStandaloneSubmissions(orgId);
      }
    }
  }, [locationId, orgId]);

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [filters, setFilters] = useState<ReadinessFilters>({
    roomIds: new Set(),
    typeIds: new Set(),
    statuses: new Set(),
  });

  const now = useMemo(() => new Date(), []);

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

  const [taskResolving, setTaskResolving] = useState<{
    actionId: string;
    taskTitle: string;
  } | null>(null);
  const [taskNote, setTaskNote] = useState("");

  const handleActionButton = useCallback((appt: ReadinessAppointment) => {
    const priority = appt.priority as ReadinessPriority;

    // Post-appointment: check for task actions needing resolution
    const isPost = appt.actions.some((a) => a.session_id);
    if (isPost && priority === "overdue") {
      const taskAction = appt.actions.find(
        (a) => a.action_type === "task" && a.status === "fired"
      );
      if (taskAction) {
        const title =
          ((taskAction.config as Record<string, unknown>)
            ?.task_title as string) ?? "Task";
        setTaskResolving({ actionId: taskAction.action_id, taskTitle: title });
        setTaskNote("");
        return;
      }
    }

    if (priority === "overdue") {
      setActivePanel({
        type: "detail",
        appointment: appt,
        patientId: appt.patient_id ?? "",
      });
    } else if (priority === "form_completed_needs_transcription") {
      // Intake-package handoff takes precedence over the legacy deliver_form
      // path. Source of truth is the action's status.
      const intakeAction = appt.actions.find(
        (a) => a.action_type === "intake_package" && a.status === "completed"
      );
      if (intakeAction) {
        setActivePanel({
          type: "intake-handoff",
          appointment: appt,
          actionId: intakeAction.action_id,
          returnTo: "none",
        });
        return;
      }
      const formAction = appt.actions.find(
        (a) => a.action_type === "deliver_form" && a.status === "completed"
      );
      if (formAction) {
        const completedSubmission = appt.completed_form_submissions.find(
          (s) =>
            s.source === "assignment" &&
            (s.form_name === formAction.form_name ||
              s.form_name === (formAction.form_name ?? "Unknown form"))
        );
        setActivePanel({
          type: "form-handoff",
          appointment: appt,
          actionId: formAction.action_id,
          formName: formAction.form_name ?? "Unknown form",
          submissionId: completedSubmission?.submission_id ?? null,
          returnTo: "none",
        });
      }
    }
    // at_risk "Nudge" would trigger SMS — stubbed for prototype
  }, []);

  const handleTaskResolve = useCallback(async () => {
    if (!taskResolving) return;
    // Get user ID from Supabase auth — for prototype, use a placeholder
    const userId = "00000000-0000-0000-0000-000000000000"; // TODO: get from auth context
    await resolveTask(taskResolving.actionId, userId, taskNote || undefined);
    setTaskResolving(null);
    setTaskNote("");
    if (locationId) refreshReadiness(locationId);
  }, [taskResolving, taskNote, locationId, refreshReadiness]);

  const handleSaved = useCallback(() => {
    setActivePanel(null);
    if (locationId) refreshReadiness(locationId);
  }, [locationId, refreshReadiness]);

  const handlePatientDetail = useCallback(
    (appointment: ReadinessAppointment | null, patientId: string) => {
      setActivePanel({ type: "detail", appointment, patientId });
    },
    []
  );

  const handleReviewStandalone = useCallback((submissionId: string) => {
    setActivePanel({ type: "standalone-submission", submissionId });
  }, []);

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
          <h1 className="text-lg font-semibold text-gray-800">Tasks</h1>
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

      <ReadinessTable
        appointments={filtered}
        standaloneRows={standaloneRows}
        now={now}
        onPatientDetail={handlePatientDetail}
        onAction={handleActionButton}
        onReviewStandalone={handleReviewStandalone}
      />

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
          patientId={activePanel.patientId || null}
          appointment={activePanel.appointment}
          onClose={() => setActivePanel(null)}
          onDeleted={handleSaved}
        />
      )}
      {activePanel?.type === "form-handoff" && locationId && (
        <FormHandoffPanel
          actionId={activePanel.actionId}
          formName={activePanel.formName}
          submissionId={activePanel.submissionId}
          patientName={`${activePanel.appointment.patient_first_name} ${activePanel.appointment.patient_last_name}`}
          appointmentId={activePanel.appointment.appointment_id}
          onClose={() => {
            const { returnTo, appointment } = activePanel;
            setActivePanel(
              returnTo === "detail"
                ? {
                    type: "detail",
                    appointment,
                    patientId: appointment.patient_id ?? "",
                  }
                : null
            );
          }}
          onTranscribed={handleSaved}
        />
      )}
      {activePanel?.type === "intake-handoff" && locationId && (
        <IntakePackageHandoffPanel
          appointmentId={activePanel.appointment.appointment_id}
          actionId={activePanel.actionId}
          patientName={`${activePanel.appointment.patient_first_name} ${activePanel.appointment.patient_last_name}`}
          onClose={() => {
            const { returnTo, appointment } = activePanel;
            setActivePanel(
              returnTo === "detail"
                ? {
                    type: "detail",
                    appointment,
                    patientId: appointment.patient_id ?? "",
                  }
                : null
            );
          }}
          onTranscribed={handleSaved}
        />
      )}

      {activePanel?.type === "standalone-submission" && orgId && (
        <StandaloneSubmissionPanel
          submissionId={activePanel.submissionId}
          onClose={() => setActivePanel(null)}
          onActioned={() => {
            // Submission was marked reviewed or archived. Close the panel
            // and refresh the standalone list — the clinic-data-provider's
            // socket listener will also fire `submission_changed`, but
            // doing it locally avoids a network round-trip flicker.
            setActivePanel(null);
            void getClinicStore().refreshStandaloneSubmissions(orgId);
          }}
        />
      )}

      {/* Task resolution dialog */}
      {taskResolving && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-50"
            onClick={() => setTaskResolving(null)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-[400px] p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Resolve: {taskResolving.taskTitle}
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                What did you do? (optional)
              </p>
              <textarea
                value={taskNote}
                onChange={(e) => setTaskNote(e.target.value)}
                rows={3}
                placeholder="Add a note..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none mb-3"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setTaskResolving(null)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleTaskResolve}>
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
