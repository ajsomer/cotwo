import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  appointmentActions,
  appointmentWorkflowRuns,
  workflowTemplates,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { enrichActionRows, type EnrichableActionRow } from "./enrich-actions";
import type { WorkflowAction } from "@/stores/clinic-store";

// The selected action shape: the shared enrichment row plus the workflow-run
// join columns the patient pane needs to group actions into per-run blocks.
const actionSelect = {
  id: appointmentActions.id,
  appointment_id: appointmentActions.appointmentId,
  action_block_id: appointmentActions.actionBlockId,
  status: appointmentActions.status,
  scheduled_for: appointmentActions.scheduledFor,
  fired_at: appointmentActions.firedAt,
  completed_at: appointmentActions.completedAt,
  error_message: appointmentActions.errorMessage,
  updated_at: appointmentActions.updatedAt,
  session_id: appointmentActions.sessionId,
  config: appointmentActions.config,
  form_id: appointmentActions.formId,
  resolved_at: appointmentActions.resolvedAt,
  resolved_by: appointmentActions.resolvedBy,
  resolution_note: appointmentActions.resolutionNote,
  // Run grouping: left-joined, so all three are nullable for orphan actions.
  workflow_run_id: appointmentActions.workflowRunId,
  workflow_direction: appointmentWorkflowRuns.direction,
  run_started_at: appointmentWorkflowRuns.startedAt,
  workflow_template_name: workflowTemplates.name,
} as const;

/**
 * Assemble the workflow-action timeline across ALL of a patient's recent
 * appointments, for the patient pane's grouped Workflows section. Bounded to a
 * recent appointment window (same FUTURE_LIMIT/PAST_LIMIT spirit as the
 * appointments timeline) so it stays light enough for the summary fast path —
 * we don't load a patient's entire history of sent messages.
 *
 * Access control: the caller has already authorised access to `patientId`. We
 * scope every appointment lookup to that patient, so no cross-patient leak.
 */
export async function fetchPatientWorkflowActions(
  patientId: string,
): Promise<WorkflowAction[]> {
  // Bound to a recent window: most-recent past + upcoming appointments. Mirrors
  // how the appointments timeline budgets candidates.
  const nowIso = new Date().toISOString();
  const [upcoming, past] = await Promise.all([
    db
      .select({ id: appointmentsT.id })
      .from(appointmentsT)
      .where(
        and(
          eq(appointmentsT.patientId, patientId),
          gte(appointmentsT.scheduledAt, nowIso),
        ),
      )
      .orderBy(asc(appointmentsT.scheduledAt))
      .limit(WORKFLOW_FUTURE_LIMIT),
    db
      .select({ id: appointmentsT.id })
      .from(appointmentsT)
      .where(
        and(
          eq(appointmentsT.patientId, patientId),
          lt(appointmentsT.scheduledAt, nowIso),
        ),
      )
      .orderBy(desc(appointmentsT.scheduledAt))
      .limit(WORKFLOW_PAST_LIMIT),
  ]);

  const apptIds = [...new Set([...upcoming, ...past].map((a) => a.id))];
  if (apptIds.length === 0) return [];

  const actions: EnrichableActionRow[] = await db
    .select(actionSelect)
    .from(appointmentActions)
    .leftJoin(
      appointmentWorkflowRuns,
      eq(appointmentWorkflowRuns.id, appointmentActions.workflowRunId),
    )
    .leftJoin(
      workflowTemplates,
      eq(workflowTemplates.id, appointmentWorkflowRuns.workflowTemplateId),
    )
    .where(inArray(appointmentActions.appointmentId, apptIds));

  return enrichActionRows(actions, { withRunContext: true });
}

// Recent-appointment window for the patient-wide pane fetch. Kept local so it
// can be tuned without touching the appointments-timeline limits.
const WORKFLOW_FUTURE_LIMIT = 10;
const WORKFLOW_PAST_LIMIT = 10;
