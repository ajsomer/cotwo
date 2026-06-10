"use client";

import { useEffect, useState, useMemo, useCallback, useTransition } from "react";
import { Zap } from "lucide-react";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import { usePmsConnection } from "@/hooks/usePmsConnection";
import { usePmsSync } from "@/hooks/usePmsSync";
import { useNow } from "@/hooks/useNow";
import type {
  ReadinessAppointment,
  StandaloneSubmissionRow as StandaloneSubmissionRowType,
} from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import { Button } from "@/components/ui/button";
import { SyncButton } from "@/components/clinic/shared/sync-button";
import { ReadinessModeToggle } from "@/components/clinic/readiness/readiness-mode-toggle";
import {
  ReadinessFilterBar,
  type ReadinessFilters,
} from "@/components/clinic/readiness/readiness-filter-bar";
import { resolveTask } from "@/lib/runsheet/actions";
import { seedTasksData, clearTasksData } from "@/lib/readiness/seed";
import dynamic from "next/dynamic";
import { ReadinessTable } from "./readiness-table";
import type { ActivePanel } from "./types";
import { FormHandoffPanel } from "@/components/clinic/forms/form-handoff-panel";
import { IntakePackageHandoffPanel } from "@/components/clinic/forms/intake-package-handoff-panel";
import { StandaloneSubmissionPanel } from "@/components/clinic/forms/standalone-submission-panel";
import { PatientContactCard } from "@/components/clinic/patient/patient-contact-card";
import type { PatientSeed } from "@/components/clinic/patient/patient-contact-card/types";
import {
  prefetchReviewData,
  formSubmissionUrl,
  intakeHandoffUrl,
  standaloneSubmissionUrl,
} from "@/components/clinic/forms/review-prefetch-cache";
import { prefetchPatientDetails } from "@/components/clinic/patient/patient-contact-card/patient-details-cache";

const AddPatientPanel = dynamic(
  () =>
    import("@/components/clinic/patient/add-patient-panel").then(
      (m) => m.AddPatientPanel
    ),
  { ssr: false }
);

// Post-appointment tasks are hidden for now to simplify the product. The
// store, fetchers, and post-appointment data all remain — flip this to true to
// bring the Pre/Post toggle and post-appointment view back.
const SHOW_POST_APPOINTMENT = false;

export function ReadinessShell() {
  const storeDirection = useClinicStore((s) => s.readinessDirection);
  // When post is hidden, lock the dashboard to pre-appointment regardless of
  // any stale store value.
  const direction = SHOW_POST_APPOINTMENT ? storeDirection : "pre_appointment";
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

  const now = useNow();

  const filtered = useMemo(() => {
    return appointments.filter((appt) => {
      if (filters.roomIds.size > 0) {
        if (!appt.room_id || !filters.roomIds.has(appt.room_id)) return false;
      }

      if (filters.typeIds.size > 0) {
        if (
          !appt.appointment_type_id ||
          !filters.typeIds.has(appt.appointment_type_id)
        )
          return false;
      }

      if (filters.statuses.size > 0) {
        if (!filters.statuses.has(appt.priority as ReadinessPriority))
          return false;
      }

      return true;
    });
  }, [appointments, filters]);

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

    // Testing affordance: for in-flight rows (in progress / late-at_risk /
    // overdue), the action button opens the patient's intake package in a new
    // tab so staff can jump straight in and fill out the data. Gated on the
    // appointment having a journey token; otherwise fall through to the normal
    // resolve/review behaviour.
    if (
      appt.intake_journey_token &&
      (priority === "in_progress" ||
        priority === "at_risk" ||
        priority === "overdue")
    ) {
      window.open(`/intake/${appt.intake_journey_token}`, "_blank", "noopener");
      return;
    }

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
          // Match the panel payload's authoritative source
          // (appointment_actions.completed_at); fall back to fired_at.
          submittedAt: intakeAction.completed_at ?? intakeAction.fired_at ?? null,
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
          submittedAt:
            completedSubmission?.completed_at ?? formAction.fired_at ?? null,
          returnTo: "none",
        });
      }
    }
    // at_risk "Nudge" would trigger SMS — stubbed for prototype
  }, []);

  // Warm the review fetch on intent (hover / pointer-down of the action
  // control), so the field data is often already present when the slide-over
  // animates in. Mirrors handleActionButton's reviewable-action resolution but
  // only prefetches; guards to genuinely reviewable rows with known IDs.
  const handleActionIntent = useCallback((appt: ReadinessAppointment) => {
    if (appt.priority !== "form_completed_needs_transcription") return;

    const intakeAction = appt.actions.find(
      (a) => a.action_type === "intake_package" && a.status === "completed"
    );
    if (intakeAction) {
      prefetchReviewData(intakeHandoffUrl(appt.appointment_id));
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
      prefetchReviewData(
        formSubmissionUrl({
          appointmentId: appt.appointment_id,
          formName: formAction.form_name ?? "Unknown form",
          submissionId: completedSubmission?.submission_id ?? null,
        })
      );
    }
  }, []);

  const handleReviewStandaloneIntent = useCallback(
    (row: StandaloneSubmissionRowType) => {
      prefetchReviewData(standaloneSubmissionUrl(row.id));
    },
    []
  );

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

  // Demo seed/clear — mirrors the run sheet header controls. Seeds (or clears)
  // the pre-appointment intake demo patients and refreshes the readiness store
  // locally rather than reloading the page.
  const [isSeeding, startSeeding] = useTransition();
  const handleSeed = useCallback(() => {
    startSeeding(async () => {
      const result = await seedTasksData();
      if (result.success) {
        if (locationId) await refreshReadiness(locationId);
      } else {
        console.error("Tasks seed failed:", result.error);
      }
    });
  }, [locationId, refreshReadiness]);

  const [isClearing, startClearing] = useTransition();
  const handleClear = useCallback(() => {
    startClearing(async () => {
      const result = await clearTasksData();
      if (result.success) {
        if (locationId) await refreshReadiness(locationId);
      } else {
        console.error("Tasks clear failed:", result.error);
      }
    });
  }, [locationId, refreshReadiness]);

  // PMS "Sync now" — shared from context (fetched once). Only shown when the
  // location is sync-active. Hidden for stubbed Gentu / no PMS.
  const pms = usePmsConnection();
  const handleSynced = useCallback(async () => {
    if (locationId) await refreshReadiness(locationId);
  }, [locationId, refreshReadiness]);
  const {
    isSyncing,
    syncMsg,
    syncNow: handleSyncNow,
  } = usePmsSync({ locationId, onSynced: handleSynced });

  const handlePatientDetail = useCallback(
    (
      appointment: ReadinessAppointment | null,
      patientId: string,
      patientSeed?: PatientSeed | null
    ) => {
      setActivePanel({ type: "detail", appointment, patientId, patientSeed });
    },
    []
  );

  // Warm the patient-card fetches on hover of the patient name, so DOB/card +
  // history are often already present when the card opens. Mirrors the active-
  // row hints the card itself passes (appointment_id when readiness).
  const handlePatientIntent = useCallback(
    (appointment: ReadinessAppointment | null, patientId: string) => {
      if (!patientId) return;
      prefetchPatientDetails(
        patientId,
        appointment?.appointment_id ?? null,
        null
      );
    },
    []
  );

  const handleReviewStandalone = useCallback(
    (row: StandaloneSubmissionRowType) => {
      setActivePanel({
        type: "standalone-submission",
        submissionId: row.id,
        seedFormName: row.form_name,
        seedPatientName: row.patient_name,
        seedCreatedAt: row.created_at,
      });
    },
    []
  );

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
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-800">Tasks</h1>
          <button
            onClick={handleClear}
            disabled={isClearing}
            className="p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
            title="Clear seeded tasks"
          >
            <Zap
              size={16}
              className={`flex-shrink-0 transition-colors ${isClearing ? "text-red-500 animate-pulse" : "text-gray-400"} hover:text-red-500`}
              strokeWidth={2}
            />
          </button>
          <button
            onClick={handleSeed}
            disabled={isSeeding}
            className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
          >
            {isSeeding ? "Seeding..." : "Seed data"}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {SHOW_POST_APPOINTMENT && (
            <>
              <ReadinessModeToggle
                direction={direction}
                counts={counts}
                hasPreOverdue={hasPreOverdue}
                hasPostOverdue={hasPostOverdue}
                onChange={setDirection}
              />
              <div className="w-px h-5 bg-gray-200" />
            </>
          )}
          {pms.syncActive && (
            <>
              <SyncButton
                isSyncing={isSyncing}
                onClick={handleSyncNow}
                title={`Pull appointments from ${pms.providerLabel ?? "PMS"}`}
              />
              <div className="w-px h-5 bg-gray-200" />
            </>
          )}
          <Button size="sm" onClick={() => setActivePanel({ type: "add-patient" })}>
            + Add patient
          </Button>
        </div>
      </div>
      {syncMsg && <p className="-mt-2 mb-4 text-[13px] text-gray-600">{syncMsg}</p>}

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
        onPatientIntent={handlePatientIntent}
        onAction={handleActionButton}
        onActionIntent={handleActionIntent}
        onReviewStandalone={handleReviewStandalone}
        onReviewStandaloneIntent={handleReviewStandaloneIntent}
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
          patientSeed={activePanel.patientSeed}
          onClose={() => setActivePanel(null)}
          onDeleted={handleSaved}
        />
      )}
      {activePanel?.type === "form-handoff" && locationId && (
        <FormHandoffPanel
          actionId={activePanel.actionId}
          formName={activePanel.formName}
          submissionId={activePanel.submissionId}
          submittedAt={activePanel.submittedAt}
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
          submittedAt={activePanel.submittedAt}
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
          seedFormName={activePanel.seedFormName}
          seedPatientName={activePanel.seedPatientName}
          seedCreatedAt={activePanel.seedCreatedAt}
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
