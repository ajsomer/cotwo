import type { HandlerContext } from "./handlers";

/**
 * HandlerContext assembly, shared by both engine execution paths (the batch
 * cron scan and the manual fire-now path). Pure — all data arrives resolved.
 */

/** The claimed appointment_actions row, as both paths select it. */
export interface ClaimedActionData {
  id: string;
  appointment_id: string;
  session_id: string | null;
  config: unknown;
  form_id: string | null;
}

/** The action's workflow_action_blocks row. */
export interface ActionBlockData {
  action_type: string;
  config: unknown;
  form_id: string | null;
  parent_action_block_id: string | null;
}

/** The action's appointments row. */
export interface AppointmentData {
  patient_id: string | null;
  scheduled_at: string | null;
  clinician_id: string | null;
  org_id: string;
  phone_number: string | null;
}

/** Per-action lookups both paths resolve before building the context. */
export interface ContextLookups {
  patientFirstName: string;
  /** The patient's primary phone number, or null if none on file. */
  primaryPhone: string | null;
  clinicName: string;
  clinicianName: string | null;
  /** IANA timezone of the appointment's location. */
  timezone: string;
  sessionEndedAt: string | null;
}

/**
 * Resolve the phone number for an action. The patient's primary phone wins;
 * manually-entered run-sheet appointments carry the phone on the appointment
 * row instead, so fall back to it. This fallback applies to BOTH execution
 * paths — the batch path historically lacking it meant a scheduled SMS to a
 * manual-entry patient fired with an empty phone number.
 */
export function resolveActionPhone(
  primaryPhone: string | null,
  appt: Pick<AppointmentData, "phone_number">
): string {
  return primaryPhone ?? appt.phone_number ?? "";
}

export function buildHandlerContext(params: {
  action: ClaimedActionData;
  block: ActionBlockData;
  appt: AppointmentData;
  patientId: string;
  lookups: ContextLookups;
  suppressNotification?: boolean;
}): HandlerContext {
  const { action, block, appt, patientId, lookups } = params;

  // Config snapshot discipline: post-appointment actions (session-linked) read
  // config from the action's snapshot; pre-appointment actions read the block.
  const actionConfig = action.session_id
    ? ((action.config as Record<string, unknown>) ??
      (block.config as Record<string, unknown>) ??
      {})
    : ((block.config as Record<string, unknown>) ?? {});

  return {
    actionId: action.id,
    appointmentId: action.appointment_id,
    patientId,
    patientFirstName: lookups.patientFirstName,
    phoneNumber: resolveActionPhone(lookups.primaryPhone, appt),
    scheduledAt: appt.scheduled_at ?? null,
    clinicName: lookups.clinicName,
    clinicianName: lookups.clinicianName,
    timezone: lookups.timezone,
    formId: action.form_id ?? block.form_id,
    config: actionConfig,
    parentActionBlockId: block.parent_action_block_id ?? null,
    sessionId: action.session_id ?? null,
    sessionEndedAt: lookups.sessionEndedAt ?? null,
    suppressNotification: params.suppressNotification ?? false,
  };
}
