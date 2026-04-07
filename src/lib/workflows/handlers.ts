import { createServiceClient } from "@/lib/supabase/service";
import { getSmsProvider } from "@/lib/sms";
import { getBaseUrl } from "@/lib/utils/url";
import type { ActionHandlerResult, ActionType } from "./types";

interface HandlerContext {
  actionId: string;
  appointmentId: string;
  patientId: string;
  patientFirstName: string;
  phoneNumber: string;
  scheduledAt: string;
  clinicName: string;
  clinicianName: string | null;
  formId: string | null;
  config: Record<string, unknown>;
}

/**
 * Execute a workflow action handler by type.
 * Returns a discriminated union: success (status + optional resultData) or failure (status + error).
 */
export async function executeHandler(
  actionType: ActionType,
  ctx: HandlerContext
): Promise<ActionHandlerResult> {
  switch (actionType) {
    case "deliver_form":
      return handleDeliverForm(ctx);
    case "send_reminder":
    case "send_sms":
      return handleSendSms(ctx);
    case "capture_card":
      return handleCaptureCard(ctx);
    case "verify_contact":
      return handleVerifyContact(ctx);
    default:
      // Action types that don't execute in v1 (send_file, send_rebooking_nudge, etc.)
      console.log(
        `[WORKFLOW] Action type '${actionType}' not yet implemented. Skipping action ${ctx.actionId}.`
      );
      return { status: "sent", resultData: { note: "stub — not implemented in v1" } };
  }
}

/** Send a form to the patient via SMS. Creates a form_assignment and sends the link. */
async function handleDeliverForm(ctx: HandlerContext): Promise<ActionHandlerResult> {
  if (!ctx.formId) {
    return { status: "failed", error: "No form_id configured on this action" };
  }

  const supabase = createServiceClient();

  // Get form details
  const { data: form } = await supabase
    .from("forms")
    .select("id, name, schema, status")
    .eq("id", ctx.formId)
    .single();

  if (!form) {
    return { status: "failed", error: `Form ${ctx.formId} not found` };
  }

  // Create form_assignment
  const { data: assignment, error: assignError } = await supabase
    .from("form_assignments")
    .insert({
      form_id: form.id,
      patient_id: ctx.patientId,
      appointment_id: ctx.appointmentId,
      schema_snapshot: form.schema,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id, token")
    .single();

  if (assignError || !assignment) {
    return { status: "failed", error: assignError?.message ?? "Failed to create form assignment" };
  }

  // Send SMS
  const url = `${getBaseUrl()}/form/${assignment.token}`;
  const message = `Hi ${ctx.patientFirstName}, please complete your ${form.name} form before your appointment: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] deliver_form: sent form '${form.name}' to ${ctx.phoneNumber} (assignment ${assignment.id})`
  );

  return {
    status: "sent",
    resultData: { form_assignment_id: assignment.id, form_name: form.name },
  };
}

/** Send a custom SMS message. Interpolates template variables. */
async function handleSendSms(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const template = (ctx.config.message as string) ?? "";
  if (!template) {
    return { status: "failed", error: "No message template configured" };
  }

  const scheduledTime = new Date(ctx.scheduledAt).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const message = template
    .replace(/\{first_name\}/g, ctx.patientFirstName)
    .replace(/\{appointment_time\}/g, scheduledTime)
    .replace(/\{clinic_name\}/g, ctx.clinicName)
    .replace(/\{clinician_name\}/g, ctx.clinicianName ?? "your clinician");

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] send_sms: sent to ${ctx.phoneNumber} for action ${ctx.actionId}`
  );

  return { status: "sent" };
}

/** Send the card capture flow link to the patient. */
async function handleCaptureCard(ctx: HandlerContext): Promise<ActionHandlerResult> {
  // In the prototype, the card capture happens in the patient entry flow.
  // The workflow action sends a link to the entry flow where card capture is a step.
  const supabase = createServiceClient();

  // Find the session for this appointment to get the entry token
  const { data: session } = await supabase
    .from("sessions")
    .select("entry_token")
    .eq("appointment_id", ctx.appointmentId)
    .limit(1)
    .single();

  const url = session
    ? `${getBaseUrl()}/entry/${session.entry_token}`
    : `${getBaseUrl()}`;

  const message = `Hi ${ctx.patientFirstName}, please add your payment card ahead of your appointment: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] capture_card: sent to ${ctx.phoneNumber} for action ${ctx.actionId}`
  );

  return { status: "sent" };
}

/** Send the contact verification flow link to the patient. */
async function handleVerifyContact(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const supabase = createServiceClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("entry_token")
    .eq("appointment_id", ctx.appointmentId)
    .limit(1)
    .single();

  const url = session
    ? `${getBaseUrl()}/entry/${session.entry_token}`
    : `${getBaseUrl()}`;

  const message = `Hi ${ctx.patientFirstName}, please verify your contact details ahead of your appointment: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] verify_contact: sent to ${ctx.phoneNumber} for action ${ctx.actionId}`
  );

  return { status: "sent" };
}
