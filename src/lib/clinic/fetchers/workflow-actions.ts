import type { SupabaseClient } from "@supabase/supabase-js";
import { getPostActionLabel } from "@/lib/workflows/types";
import type { WorkflowAction } from "@/stores/clinic-store";

/**
 * Map a pre-appointment action type (+ optional form name) to a human label.
 * Single source of truth shared by the readiness fetcher and the patient
 * contact card's active-context fetch.
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
 * Assemble the workflow-action timeline for a single appointment, scoped to a
 * specific patient. This is "active-appointment context" — light enough to
 * ride the fast path alongside the patient summary, not the heavy history.
 *
 * Access control: `appointmentId` is caller-supplied (a query param on the
 * patient route), so we filter by BOTH appointment_id AND the already-
 * authorised patient_id. A caller authorised for patient A cannot pass
 * patient B's appointment_id and read B's workflow — the patient_id mismatch
 * yields no appointment row and an empty array. Same discipline as
 * fetchAppointmentById in the patient route's _shared module.
 */
export async function fetchAppointmentWorkflowActions(
  supabase: SupabaseClient,
  appointmentId: string,
  patientId: string,
): Promise<WorkflowAction[]> {
  // Prove the appointment belongs to the authorised patient before reading
  // any actions off it.
  const { data: appt } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!appt) return [];

  const { data: actions } = await supabase
    .from("appointment_actions")
    .select(
      "id, appointment_id, action_block_id, status, scheduled_for, fired_at, completed_at, error_message, updated_at, session_id, config, form_id, resolved_at, resolved_by, resolution_note",
    )
    .eq("appointment_id", appointmentId);

  if (!actions || actions.length === 0) return [];

  const blockIds = [...new Set(actions.map((a) => a.action_block_id))];
  const { data: blocks } = await supabase
    .from("workflow_action_blocks")
    .select("id, action_type, config, form_id, offset_minutes, offset_direction")
    .in("id", blockIds);
  const blockMap = new Map((blocks ?? []).map((b) => [b.id, b]));

  // Form names for any form referenced by a block or a post-appointment action.
  const blockFormIds = (blocks ?? [])
    .map((b) => b.form_id)
    .filter((id): id is string => !!id);
  const actionFormIds = actions
    .map((a) => a.form_id as string | null)
    .filter((id): id is string => !!id);
  const allFormIds = [...new Set([...blockFormIds, ...actionFormIds])];
  const formMap = new Map<string, string>();
  if (allFormIds.length > 0) {
    const { data: forms } = await supabase
      .from("forms")
      .select("id, name")
      .in("id", allFormIds);
    for (const f of forms ?? []) formMap.set(f.id, f.name);
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
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, session_ended_at, outcome_pathway_id")
      .in("id", sessionIds);
    for (const s of sessions ?? [])
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
    const { data: pathways } = await supabase
      .from("outcome_pathways")
      .select("id, name")
      .in("id", pathwayIds);
    for (const p of pathways ?? []) pathwayNameMap.set(p.id, p.name);
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

    const actionLabel = isPostAppointment
      ? getPostActionLabel(
          block?.action_type ?? "unknown",
          actionConfig,
          formName ?? undefined,
        )
      : getActionLabel(block?.action_type ?? "unknown", formName ?? undefined);

    result.push({
      action_id: action.id,
      action_type: block?.action_type ?? "unknown",
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
    });
  }

  return result;
}
