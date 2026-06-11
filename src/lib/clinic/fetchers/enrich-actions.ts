import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  appointmentTypes as appointmentTypesT,
  workflowActionBlocks,
  forms as formsT,
  sessions as sessionsT,
  outcomePathways,
  intakePackageJourneys,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  ACTION_TYPE_META,
  getPostActionLabel,
  getActionKind,
  getMessageTemplate,
} from "@/lib/workflows/types";
import type { WorkflowAction, IntakeItem } from "@/stores/clinic-store";

/**
 * Shared action-row enrichment for the readiness fetcher and the patient-pane
 * workflow-actions fetcher. Both previously built a field-for-field identical
 * enriched action shape from their own copies of this logic (block metadata,
 * form names, intake-package expansion, post-appointment pathway names) — and
 * the copies had already drifted (readiness lacked `intake_items` /
 * `message_template`). This module is the single source for that shape.
 */

/**
 * The minimal appointment_actions row enrichActionRows() consumes. The
 * patient-pane fetcher additionally left-joins workflow-run columns; those are
 * optional and only emitted when `withRunContext` is set.
 */
export type EnrichableActionRow = {
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
  // Run grouping (patient-pane fetcher only): left-joined, so all nullable.
  workflow_run_id?: string | null;
  workflow_direction?: "pre_appointment" | "post_appointment" | null;
  run_started_at?: string | null;
  workflow_template_name?: string | null;
};

/**
 * Enriched output: the store's WorkflowAction shape plus two fields the
 * readiness fetcher needs for grouping/rollups — the owning appointment id and
 * the action's session end time (post-appointment only). Both are additive;
 * the value is assignable wherever a WorkflowAction is expected.
 */
export type EnrichedWorkflowAction = WorkflowAction & {
  appointment_id: string;
  session_ended_at: string | null;
};

/**
 * Map a pre-appointment action type (+ optional form name) to a human label.
 *
 * Delegates to ACTION_TYPE_META (the workflow editor's label source) so the
 * strings can't drift, with sentence-case overrides below for the dashboard
 * copy that intentionally differs from the editor's title-case labels.
 */
const ACTION_LABEL_OVERRIDES: Record<string, string> = {
  // Dashboard copy is sentence case; the editor meta uses title case
  // ("Intake Package", "Intake Reminder", "Add to Run Sheet").
  intake_package: "Intake package",
  intake_reminder: "Intake reminder",
  add_to_runsheet: "Add to run sheet",
};

export function getActionLabel(actionType: string, formName?: string): string {
  if (actionType === "deliver_form" && formName) {
    return `Send form: ${formName}`;
  }
  const override = ACTION_LABEL_OVERRIDES[actionType];
  if (override) return override;
  const meta = ACTION_TYPE_META.find((m) => m.type === actionType);
  return meta?.label ?? actionType;
}

/**
 * Shared enrichment: resolve block metadata, form names, intake-package
 * to-dos, and post-appointment pathway names for a set of action rows, then
 * map to the WorkflowAction shape. Used by both the readiness fetcher and the
 * patient-wide fetcher so labelling and field shape stay identical.
 *
 * `withRunContext` additionally resolves each appointment's scheduled_at and
 * appointment-type name (one extra query) and emits the workflow-run grouping
 * fields the patient pane needs. The readiness fetcher skips it — it already
 * holds the appointment rows and groups by appointment itself.
 */
export async function enrichActionRows(
  actions: EnrichableActionRow[],
  opts: { withRunContext?: boolean } = {},
): Promise<EnrichedWorkflowAction[]> {
  if (actions.length === 0) return [];
  const withRunContext = opts.withRunContext ?? false;

  // Per-appointment scheduled_at (block header date) + appointment type name
  // (what the Workflows tab labels workflows by — the header prefers it over
  // the template name). One join from appointments to their type.
  const apptScheduledMap = new Map<string, string | null>();
  const apptTypeNameMap = new Map<string, string | null>();
  if (withRunContext) {
    const apptIds = [...new Set(actions.map((a) => a.appointment_id))];
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
    .map((a) => a.form_id)
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

  const result: EnrichedWorkflowAction[] = [];
  for (const action of actions) {
    const block = blockMap.get(action.action_block_id);
    const isPostAppointment = !!action.session_id;
    const actionConfig = isPostAppointment
      ? ((action.config as Record<string, unknown>) ?? null)
      : null;
    const actionFormId = isPostAppointment
      ? action.form_id
      : (block?.form_id ?? null);
    const formName = actionFormId ? (formMap.get(actionFormId) ?? null) : null;

    const session = action.session_id
      ? sessionMap.get(action.session_id)
      : undefined;
    let actionPathwayName: string | null = null;
    if (isPostAppointment && session?.outcome_pathway_id) {
      actionPathwayName =
        pathwayNameMap.get(session.outcome_pathway_id) ?? null;
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

    const enriched: EnrichedWorkflowAction = {
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
      action_kind: kind,
      message_template: messageTemplate,
      intake_items: intakeItems,
      appointment_id: action.appointment_id,
      session_ended_at: session?.session_ended_at ?? null,
    };

    if (withRunContext) {
      // Run grouping for the patient pane's Workflows section.
      enriched.workflow_run_id = action.workflow_run_id ?? null;
      enriched.workflow_template_name = action.workflow_template_name ?? null;
      enriched.workflow_direction = action.workflow_direction ?? null;
      enriched.run_appointment_id = action.appointment_id;
      enriched.run_started_at = action.run_started_at ?? null;
      enriched.run_appointment_scheduled_at =
        apptScheduledMap.get(action.appointment_id) ?? null;
      enriched.appointment_type_name =
        apptTypeNameMap.get(action.appointment_id) ?? null;
    }

    result.push(enriched);
  }

  return result;
}
