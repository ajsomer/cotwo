/**
 * SMS template rendering — the single merge-field implementation for every
 * workflow handler, plus the canonical variable vocabularies the builder UI
 * derives its placeholder chips from. Keeping vocabulary and renderer in one
 * module is what stops the editor advertising placeholders the engine ships
 * literally to patients.
 */

import type { HandlerContext } from "./handlers";

/** Replace every `{key}` in the template with its value. Unknown placeholders
 *  are left as-is (visible in the output rather than silently dropped). */
export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/**
 * The canonical merge-field values for SMS-style templates, derived from the
 * handler context. Times render in the location's timezone, never the
 * server's. `patient_name` is a legacy alias of `first_name`.
 */
export function smsTemplateVars(
  ctx: Pick<
    HandlerContext,
    | "patientFirstName"
    | "scheduledAt"
    | "sessionEndedAt"
    | "clinicName"
    | "clinicianName"
    | "timezone"
  >
): Record<string, string> {
  const scheduledTime = ctx.scheduledAt
    ? new Date(ctx.scheduledAt).toLocaleTimeString("en-AU", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: ctx.timezone,
      })
    : "your appointment";

  // Session date for post-appointment merge field {session_date}
  const sessionDate = ctx.sessionEndedAt
    ? new Date(ctx.sessionEndedAt).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: ctx.timezone,
      })
    : "your recent appointment";

  return {
    first_name: ctx.patientFirstName,
    patient_name: ctx.patientFirstName,
    appointment_time: scheduledTime,
    session_date: sessionDate,
    clinic_name: ctx.clinicName,
    clinician_name: ctx.clinicianName ?? "your clinician",
  };
}

/** Merge-field values for intake package / reminder message bodies.
 *  `first_name` is accepted as an alias so an SMS-vocabulary placeholder typed
 *  into an intake template still renders instead of shipping literally. */
export function intakeTemplateVars(
  ctx: Pick<HandlerContext, "patientFirstName" | "clinicName">,
  link: string
): Record<string, string> {
  return {
    patient_first_name: ctx.patientFirstName,
    first_name: ctx.patientFirstName,
    link,
    clinic_name: ctx.clinicName,
  };
}

export interface TemplateVariable {
  key: string;
  label: string;
}

/** Variables available in send_sms / send_reminder message templates. */
export const SMS_TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { key: "{first_name}", label: "First name" },
  { key: "{appointment_time}", label: "Appointment time" },
  { key: "{session_date}", label: "Session date" },
  { key: "{clinic_name}", label: "Clinic name" },
  { key: "{clinician_name}", label: "Clinician name" },
] as const;

/** Variables available in intake package / intake reminder message bodies. */
export const INTAKE_TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { key: "{patient_first_name}", label: "Patient first name" },
  { key: "{link}", label: "Intake link" },
  { key: "{clinic_name}", label: "Clinic name" },
] as const;

/** Variables available in send_file message templates. */
export const FILE_TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { key: "{first_name}", label: "First name" },
  { key: "{clinic_name}", label: "Clinic name" },
  { key: "{clinician_name}", label: "Clinician name" },
  { key: "{file_link}", label: "File link" },
] as const;
