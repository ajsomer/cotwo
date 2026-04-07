import type { Database } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// DB row type aliases
// ---------------------------------------------------------------------------

export type DbWorkflowTemplate =
  Database["public"]["Tables"]["workflow_templates"]["Row"];
export type DbWorkflowActionBlock =
  Database["public"]["Tables"]["workflow_action_blocks"]["Row"];
export type DbAppointmentAction =
  Database["public"]["Tables"]["appointment_actions"]["Row"];
export type DbAppointmentWorkflowRun =
  Database["public"]["Tables"]["appointment_workflow_runs"]["Row"];
export type DbTypeWorkflowLink =
  Database["public"]["Tables"]["type_workflow_links"]["Row"];
export type DbOutcomePathway =
  Database["public"]["Tables"]["outcome_pathways"]["Row"];

export type ActionType = Database["public"]["Enums"]["action_type"];
export type ActionStatus = Database["public"]["Enums"]["action_status"];
export type WorkflowDirection = Database["public"]["Enums"]["workflow_direction"];
export type WorkflowTemplateStatus =
  Database["public"]["Enums"]["workflow_template_status"];

// ---------------------------------------------------------------------------
// Precondition config (JSONB shape — validated in application code, not DB)
// ---------------------------------------------------------------------------

export type PreconditionConfig =
  | null
  | { type: "form_not_completed"; form_id: string }
  | { type: "card_not_on_file" }
  | { type: "contact_not_verified" }
  | { type: "no_future_appointment" };

export const PRECONDITION_OPTIONS: {
  value: PreconditionConfig;
  label: string;
  direction: "both" | "pre" | "post";
  needsFormPicker?: boolean;
}[] = [
  { value: null, label: "Always fires", direction: "both" },
  {
    value: { type: "form_not_completed", form_id: "" },
    label: "Form not completed",
    direction: "both",
    needsFormPicker: true,
  },
  {
    value: { type: "card_not_on_file" },
    label: "Card not on file",
    direction: "both",
  },
  {
    value: { type: "contact_not_verified" },
    label: "Contact not verified",
    direction: "both",
  },
  {
    value: { type: "no_future_appointment" },
    label: "No future appointment booked",
    direction: "post",
  },
];

// ---------------------------------------------------------------------------
// Action handler result (discriminated union consumed by the engine)
// ---------------------------------------------------------------------------

export type ActionHandlerSuccess = {
  status: "sent" | "opened" | "captured" | "verified";
  resultData?: Record<string, unknown>;
};

export type ActionHandlerFailure = {
  status: "failed";
  error: string;
};

export type ActionHandlerResult = ActionHandlerSuccess | ActionHandlerFailure;

// ---------------------------------------------------------------------------
// Action type metadata
// ---------------------------------------------------------------------------

/**
 * Action types exposed in the v1 workflow editor.
 *
 * The following action_type enum values are intentionally NOT exposed in v1:
 * - send_nudge: replaced by precondition-driven send_reminder (nudges are
 *   just reminders with a "form not completed" precondition)
 * - send_session_link: handled by Core tier one-shot SMS, not the workflow
 *   engine. Session links are sent via the run sheet, not workflows.
 * - send_resource: subsumed by send_file in v1. send_resource was a
 *   placeholder; send_file provides the same capability.
 * - send_proms: use deliver_form with a PROMs-type form instead. PROMs
 *   are just forms; a separate action type adds no value.
 */
export interface ActionTypeMeta {
  type: ActionType;
  label: string;
  /** Short description shown in the add-action popover */
  description: string;
  /** Available in pre-appointment workflows */
  availableInPre: boolean;
  /** Available in post-appointment workflows */
  availableInPost: boolean;
  /** Whether this action type needs a form_id */
  needsForm: boolean;
  /** Whether this action type has a message textarea */
  hasMessage: boolean;
  /** Whether this action type has a file picker (stub in v1) */
  hasFile: boolean;
}

export const ACTION_TYPE_META: ActionTypeMeta[] = [
  {
    type: "deliver_form",
    label: "Send form",
    description: "Send a form to the patient via SMS",
    availableInPre: true,
    availableInPost: true,
    needsForm: true,
    hasMessage: false,
    hasFile: false,
  },
  {
    type: "send_reminder",
    label: "Send reminder SMS",
    description: "Send a custom SMS reminder to the patient",
    availableInPre: true,
    availableInPost: false,
    needsForm: false,
    hasMessage: true,
    hasFile: false,
  },
  {
    type: "capture_card",
    label: "Capture card on file",
    description: "Send the card capture flow to the patient",
    availableInPre: true,
    availableInPost: false,
    needsForm: false,
    hasMessage: false,
    hasFile: false,
  },
  {
    type: "verify_contact",
    label: "Verify contact details",
    description: "Send the contact verification flow to the patient",
    availableInPre: true,
    availableInPost: false,
    needsForm: false,
    hasMessage: false,
    hasFile: false,
  },
  {
    type: "send_sms",
    label: "Send SMS",
    description: "Send a custom SMS to the patient",
    availableInPre: false,
    availableInPost: true,
    needsForm: false,
    hasMessage: true,
    hasFile: false,
  },
  {
    type: "send_file",
    label: "Send file",
    description: "Send a PDF or document to the patient via SMS",
    availableInPre: false,
    availableInPost: true,
    needsForm: false,
    hasMessage: true,
    hasFile: true,
  },
  {
    type: "send_rebooking_nudge",
    label: "Send rebooking nudge",
    description: "Prompt the patient to rebook with an optional link",
    availableInPre: false,
    availableInPost: true,
    needsForm: false,
    hasMessage: true,
    hasFile: false,
  },
];

export function getActionTypeMeta(type: ActionType): ActionTypeMeta | undefined {
  return ACTION_TYPE_META.find((m) => m.type === type);
}

export function getActionTypesForDirection(
  direction: WorkflowDirection
): ActionTypeMeta[] {
  if (direction === "pre_appointment") {
    return ACTION_TYPE_META.filter((m) => m.availableInPre);
  }
  return ACTION_TYPE_META.filter((m) => m.availableInPost);
}

// ---------------------------------------------------------------------------
// Fire time display helpers
// ---------------------------------------------------------------------------

export interface FireTimeDisplay {
  value: number;
  unit: "minutes" | "hours" | "days";
  label: string;
}

/** Convert stored offset_minutes to a human-readable display. */
export function formatFireTime(
  offsetMinutes: number,
  offsetDirection: string
): FireTimeDisplay {
  const directionLabel = offsetDirection === "before" ? "before" : "after";

  if (offsetMinutes === 0) {
    return { value: 0, unit: "minutes", label: "Immediately" };
  }

  if (offsetMinutes % (60 * 24) === 0) {
    const days = offsetMinutes / (60 * 24);
    return {
      value: days,
      unit: "days",
      label: `${days} ${days === 1 ? "day" : "days"} ${directionLabel}`,
    };
  }

  if (offsetMinutes % 60 === 0) {
    const hours = offsetMinutes / 60;
    return {
      value: hours,
      unit: "hours",
      label: `${hours} ${hours === 1 ? "hour" : "hours"} ${directionLabel}`,
    };
  }

  return {
    value: offsetMinutes,
    unit: "minutes",
    label: `${offsetMinutes} ${offsetMinutes === 1 ? "minute" : "minutes"} ${directionLabel}`,
  };
}

/** Convert display units back to offset_minutes for storage. */
export function toOffsetMinutes(
  value: number,
  unit: "minutes" | "hours" | "days"
): number {
  switch (unit) {
    case "days":
      return value * 60 * 24;
    case "hours":
      return value * 60;
    case "minutes":
      return value;
  }
}

// ---------------------------------------------------------------------------
// Action card display helpers
// ---------------------------------------------------------------------------

/** Generate display name for an action block (e.g. "Send form: New Patient Intake") */
export function getActionDisplayName(
  block: DbWorkflowActionBlock,
  formName?: string
): string {
  const meta = getActionTypeMeta(block.action_type);
  const label = meta?.label ?? block.action_type;

  if (block.action_type === "deliver_form" && formName) {
    return `${label}: ${formName}`;
  }

  return label;
}

/** Generate precondition subtitle for display */
export function getPreconditionLabel(
  precondition: PreconditionConfig,
  formName?: string
): string {
  if (!precondition) return "Always fires";

  switch (precondition.type) {
    case "form_not_completed":
      return formName
        ? `Only if ${formName} not completed`
        : "Only if form not completed";
    case "card_not_on_file":
      return "Only if card not on file";
    case "contact_not_verified":
      return "Only if contact not verified";
    case "no_future_appointment":
      return "Only if no future appointment booked";
  }
}

// ---------------------------------------------------------------------------
// SMS message template variables
// ---------------------------------------------------------------------------

export const MESSAGE_VARIABLES = [
  { key: "{first_name}", label: "First name" },
  { key: "{appointment_time}", label: "Appointment time" },
  { key: "{clinic_name}", label: "Clinic name" },
  { key: "{clinician_name}", label: "Clinician name" },
] as const;
