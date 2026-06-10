import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  appointmentTypes as appointmentTypesT,
  appointmentActions,
  appointmentWorkflowRuns,
  workflowTemplates,
  workflowActionBlocks,
  forms as formsT,
  sessions as sessionsT,
  outcomePathways,
  intakePackageJourneys,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  getPostActionLabel,
  getActionKind,
  getMessageTemplate,
} from "@/lib/workflows/types";
import type { WorkflowAction, IntakeItem } from "@/stores/clinic-store";

// The selected action shape shared by both fetchers. Includes the workflow-run
// join columns the patient pane needs to group actions into per-run blocks.
type ActionRow = {
  id: string;
  appointment_id: string;
  action_block_id: string;
  status: string;
  scheduled_for: string;
  fired_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  updated_at: string | null;
  session_id: string | null;
  config: unknown;
  form_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  workflow_run_id: string | null;
  workflow_direction: "pre_appointment" | "post_appointment" | null;
  run_started_at: string | null;
  workflow_template_name: string | null;
};

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
 * Map a pre-appointment action type (+ optional form name) to a human label.
 * Single source of truth shared by the readiness fetcher and the patient-wide
 * workflow-actions fetch below.
 */
export function getActionLabel(actionType: string, formName?: string): string {
  switch (actionType) {
    case "deliver_form":
      return formName ? `Send form: ${formName}` : "Send form";
    case "send_reminder":
      return "Send reminder SMS";
    case "send_sms":
      return "Send SMS";
    case "capture_card":
      return "Capture card on file";
    case "verify_contact":
      return "Verify contact details";
    case "send_file":
      return "Send file";
    case "send_rebooking_nudge":
      return "Send rebooking nudge";
    case "intake_package":
      return "Intake package";
    case "intake_reminder":
      return "Intake reminder";
    case "add_to_runsheet":
      return "Add to run sheet";
    case "task":
      return "Task";
    default:
      return actionType;
  }
}

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

  const actions: ActionRow[] = await db
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

  return enrichActions(actions);
}

// Recent-appointment window for the patient-wide pane fetch. Kept local so it
// can be tuned without touching the appointments-timeline limits.
const WORKFLOW_FUTURE_LIMIT = 10;
const WORKFLOW_PAST_LIMIT = 10;

/**
 * Shared enrichment: resolve block metadata, form names, and post-appointment
 * pathway names for a set of action rows, then map to the WorkflowAction shape.
 * Used by both the single-appointment and patient-wide fetchers so labelling
 * and run-grouping fields stay identical.
 */
async function enrichActions(actions: ActionRow[]): Promise<WorkflowAction[]> {
  if (actions.length === 0) return [];

  // Per-appointment scheduled_at (block header date) + appointment type name
  // (what the Workflows tab labels workflows by — the header prefers it over
  // the template name). One join from appointments to their type.
  const apptIds = [...new Set(actions.map((a) => a.appointment_id))];
  const apptScheduledMap = new Map<string, string | null>();
  const apptTypeNameMap = new Map<string, string | null>();
  if (apptIds.length > 0) {
    const appts = await db
      .select({
        id: appointmentsT.id,
        scheduled_at: appointmentsT.scheduledAt,
        type_name: appointmentTypesT.name,
      })
      .from(appointmentsT)
      .leftJoin(
        appointmentTypesT,
        eq(appointmentTypesT.id, appointmentsT.appointmentTypeId),
      )
      .where(inArray(appointmentsT.id, apptIds));
    for (const a of appts) {
      apptScheduledMap.set(a.id, a.scheduled_at);
      apptTypeNameMap.set(a.id, a.type_name ?? null);
    }
  }

  const blockIds = [...new Set(actions.map((a) => a.action_block_id))];
  const blocks = blockIds.length === 0 ? [] : await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
      config: workflowActionBlocks.config,
      form_id: workflowActionBlocks.formId,
      offset_minutes: workflowActionBlocks.offsetMinutes,
      offset_direction: workflowActionBlocks.offsetDirection,
    })
    .from(workflowActionBlocks)
    .where(inArray(workflowActionBlocks.id, blockIds));
  const blockMap = new Map(blocks.map((b) => [b.id, b]));

  // Intake-package journeys, keyed by appointment, so an intake_package action
  // can be expanded into its constituent to-dos (forms / card / consent). Only
  // fetched when an intake_package action is actually present.
  type IntakeJourney = {
    form_ids: string[];
    forms_completed: Record<string, string>;
    includes_card_capture: boolean;
    card_captured_at: string | null;
    includes_consent: boolean;
    consent_completed_at: string | null;
  };
  const intakeJourneyMap = new Map<string, IntakeJourney>();
  const intakeApptIds = [
    ...new Set(
      actions
        .filter(
          (a) => blockMap.get(a.action_block_id)?.action_type === "intake_package",
        )
        .map((a) => a.appointment_id),
    ),
  ];
  if (intakeApptIds.length > 0) {
    const journeys = await db
      .select({
        appointment_id: intakePackageJourneys.appointmentId,
        form_ids: intakePackageJourneys.formIds,
        forms_completed: intakePackageJourneys.formsCompleted,
        includes_card_capture: intakePackageJourneys.includesCardCapture,
        card_captured_at: intakePackageJourneys.cardCapturedAt,
        includes_consent: intakePackageJourneys.includesConsent,
        consent_completed_at: intakePackageJourneys.consentCompletedAt,
      })
      .from(intakePackageJourneys)
      .where(inArray(intakePackageJourneys.appointmentId, intakeApptIds));
    for (const j of journeys) {
      intakeJourneyMap.set(j.appointment_id, {
        form_ids: Array.isArray(j.form_ids) ? (j.form_ids as string[]) : [],
        forms_completed:
          (j.forms_completed as Record<string, string> | null) ?? {},
        includes_card_capture: j.includes_card_capture,
        card_captured_at: j.card_captured_at,
        includes_consent: j.includes_consent,
        consent_completed_at: j.consent_completed_at,
      });
    }
  }

  // Form names for any form referenced by a block or a post-appointment action.
  const blockFormIds = blocks
    .map((b) => b.form_id)
    .filter((id): id is string => !!id);
  const actionFormIds = actions
    .map((a) => a.form_id as string | null)
    .filter((id): id is string => !!id);
  // Intake journeys reference forms via their configured form_ids, which may not
  // appear on any block/action — include them so the expanded to-dos get names.
  const journeyFormIds = [...intakeJourneyMap.values()].flatMap(
    (j) => j.form_ids,
  );
  const allFormIds = [
    ...new Set([...blockFormIds, ...actionFormIds, ...journeyFormIds]),
  ];
  const formMap = new Map<string, string>();
  if (allFormIds.length > 0) {
    const forms = await db
      .select({ id: formsT.id, name: formsT.name })
      .from(formsT)
      .where(inArray(formsT.id, allFormIds));
    for (const f of forms) formMap.set(f.id, f.name);
  }

  // Pathway names for post-appointment actions, resolved via their sessions.
  const sessionIds = [
    ...new Set(
      actions.map((a) => a.session_id).filter((id): id is string => !!id),
    ),
  ];
  const sessionMap = new Map<
    string,
    { session_ended_at: string | null; outcome_pathway_id: string | null }
  >();
  if (sessionIds.length > 0) {
    const sessions = await db
      .select({
        id: sessionsT.id,
        session_ended_at: sessionsT.sessionEndedAt,
        outcome_pathway_id: sessionsT.outcomePathwayId,
      })
      .from(sessionsT)
      .where(inArray(sessionsT.id, sessionIds));
    for (const s of sessions)
      sessionMap.set(s.id, {
        session_ended_at: s.session_ended_at,
        outcome_pathway_id: s.outcome_pathway_id,
      });
  }
  const pathwayIds = [
    ...new Set(
      [...sessionMap.values()]
        .map((s) => s.outcome_pathway_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const pathwayNameMap = new Map<string, string>();
  if (pathwayIds.length > 0) {
    const pathways = await db
      .select({ id: outcomePathways.id, name: outcomePathways.name })
      .from(outcomePathways)
      .where(inArray(outcomePathways.id, pathwayIds));
    for (const p of pathways) pathwayNameMap.set(p.id, p.name);
  }

  const result: WorkflowAction[] = [];
  for (const action of actions) {
    const block = blockMap.get(action.action_block_id);
    const isPostAppointment = !!action.session_id;
    const actionConfig = isPostAppointment
      ? ((action.config as Record<string, unknown>) ?? null)
      : null;
    const actionFormId = isPostAppointment
      ? (action.form_id as string | null)
      : (block?.form_id ?? null);
    const formName = actionFormId ? (formMap.get(actionFormId) ?? null) : null;

    let actionPathwayName: string | null = null;
    if (isPostAppointment && action.session_id) {
      const sess = sessionMap.get(action.session_id);
      if (sess?.outcome_pathway_id) {
        actionPathwayName = pathwayNameMap.get(sess.outcome_pathway_id) ?? null;
      }
    }

    const actionType = block?.action_type ?? "unknown";
    const actionLabel = isPostAppointment
      ? getPostActionLabel(actionType, actionConfig, formName ?? undefined)
      : getActionLabel(actionType, formName ?? undefined);

    // Configured SMS template (placeholders left unresolved), if this action
    // carries one — the customisable workflow messages are the initial intake
    // SMS (on the intake_package block) and intake reminders. Prefer the
    // action's own config, fall back to the block's. Resolved regardless of
    // action_kind so the intake_package (an "action") still surfaces its
    // initial SMS text.
    const kind = getActionKind(actionType);
    const templateConfig =
      actionConfig ??
      ((block?.config as Record<string, unknown> | undefined) ?? null);
    const messageTemplate = getMessageTemplate(templateConfig);

    // Expand an intake package into its constituent to-dos from the journey.
    let intakeItems: IntakeItem[] | undefined;
    if (actionType === "intake_package") {
      const journey = intakeJourneyMap.get(action.appointment_id);
      if (journey) {
        intakeItems = [];
        for (const fid of journey.form_ids) {
          intakeItems.push({
            key: `form:${fid}`,
            label: formMap.get(fid) ?? "Form",
            kind: "form",
            completed: Boolean(journey.forms_completed[fid]),
          });
        }
        if (journey.includes_card_capture) {
          intakeItems.push({
            key: "card",
            label: "Card on file",
            kind: "card",
            completed: Boolean(journey.card_captured_at),
          });
        }
        if (journey.includes_consent) {
          intakeItems.push({
            key: "consent",
            label: "Consent",
            kind: "consent",
            completed: Boolean(journey.consent_completed_at),
          });
        }
      }
    }

    result.push({
      action_id: action.id,
      action_type: actionType,
      action_label: actionLabel,
      status: action.status,
      scheduled_for: action.scheduled_for,
      fired_at: action.fired_at,
      completed_at: action.completed_at ?? null,
      error_message: action.error_message,
      form_name: formName,
      offset_minutes: block?.offset_minutes ?? 0,
      offset_direction: block?.offset_direction ?? "before",
      updated_at: action.updated_at ?? null,
      session_id: action.session_id ?? null,
      config: actionConfig,
      resolved_at: action.resolved_at ?? null,
      resolved_by: action.resolved_by ?? null,
      resolution_note: action.resolution_note ?? null,
      pathway_name: actionPathwayName,
      // Run grouping for the patient pane's Workflows section.
      workflow_run_id: action.workflow_run_id,
      workflow_template_name: action.workflow_template_name,
      workflow_direction: action.workflow_direction,
      run_appointment_id: action.appointment_id,
      run_started_at: action.run_started_at,
      run_appointment_scheduled_at:
        apptScheduledMap.get(action.appointment_id) ?? null,
      appointment_type_name: apptTypeNameMap.get(action.appointment_id) ?? null,
      action_kind: kind,
      message_template: messageTemplate,
      intake_items: intakeItems,
    });
  }

  return result;
}
