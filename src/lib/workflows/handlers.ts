import { createServiceClient } from "@/lib/supabase/service";
import { getSmsProvider } from "@/lib/sms";
import { getBaseUrl } from "@/lib/utils/url";
import type { ActionHandlerResult, ActionType } from "./types";

export interface HandlerContext {
  actionId: string;
  appointmentId: string;
  patientId: string;
  patientFirstName: string;
  phoneNumber: string;
  scheduledAt: string | null;
  clinicName: string;
  clinicianName: string | null;
  formId: string | null;
  config: Record<string, unknown>;
  /** The action block's parent_action_block_id (for intake_reminder). */
  parentActionBlockId: string | null;
  /** Session ID for post-appointment actions. NULL for pre-appointment. */
  sessionId: string | null;
  /** Session ended timestamp for post-appointment merge field resolution. */
  sessionEndedAt: string | null;
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
    case "intake_package":
      return handleIntakePackage(ctx);
    case "intake_reminder":
      return handleIntakeReminder(ctx);
    case "add_to_runsheet":
      return handleAddToRunsheet(ctx);
    case "deliver_form":
      return handleDeliverForm(ctx);
    case "send_reminder":
    case "send_sms":
      return handleSendSms(ctx);
    case "capture_card":
      return handleCaptureCard(ctx);
    case "verify_contact":
      return handleVerifyContact(ctx);
    case "send_file":
      return handleSendFile(ctx);
    case "task":
      return handleTask(ctx);
    default:
      // Action types that don't execute in v1 (send_rebooking_nudge, etc.)
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

  const scheduledTime = ctx.scheduledAt
    ? new Date(ctx.scheduledAt).toLocaleTimeString("en-AU", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "your appointment";

  // Session date for post-appointment merge field {session_date}
  const sessionDate = ctx.sessionEndedAt
    ? new Date(ctx.sessionEndedAt).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "your recent appointment";

  const message = template
    .replace(/\{first_name\}/g, ctx.patientFirstName)
    .replace(/\{patient_name\}/g, ctx.patientFirstName)
    .replace(/\{appointment_time\}/g, scheduledTime)
    .replace(/\{session_date\}/g, sessionDate)
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

// ============================================================================
// Intake Package Handlers (v2 pre-appointment model)
// ============================================================================

/** Create an intake package journey and send the patient the journey link. */
async function handleIntakePackage(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const supabase = createServiceClient();

  const config = ctx.config as {
    includes_card_capture?: boolean;
    includes_consent?: boolean;
    form_ids?: string[];
  };

  const journeyToken = crypto.randomUUID();

  const { data: journey, error: journeyError } = await supabase
    .from("intake_package_journeys")
    .insert({
      appointment_id: ctx.appointmentId,
      patient_id: null, // populated after phone OTP verification
      journey_token: journeyToken,
      includes_card_capture: config.includes_card_capture ?? false,
      includes_consent: config.includes_consent ?? false,
      form_ids: config.form_ids ?? [],
    })
    .select("id")
    .single();

  if (journeyError || !journey) {
    return { status: "failed", error: `Failed to create intake journey: ${journeyError?.message}` };
  }

  const url = `${getBaseUrl()}/intake/${journeyToken}`;
  const message = `Hi ${ctx.patientFirstName}, please complete your intake before your appointment at ${ctx.clinicName}: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] intake_package: Journey ${journey.id} created. SMS to ${ctx.phoneNumber}: ${url}`
  );

  return {
    status: "sent",
    resultData: { journey_id: journey.id, journey_token: journeyToken },
  };
}

/**
 * Re-send the intake package journey link if the patient hasn't completed it.
 * Has its own handler because it needs to resolve the parent's journey token
 * and check completion status.
 */
async function handleIntakeReminder(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const supabase = createServiceClient();

  // Check parent intake_package action status
  if (ctx.parentActionBlockId) {
    const { data: parentAction } = await supabase
      .from("appointment_actions")
      .select("status")
      .eq("appointment_id", ctx.appointmentId)
      .eq("action_block_id", ctx.parentActionBlockId)
      .limit(1)
      .single();

    if (parentAction?.status === "completed") {
      console.log(
        `[WORKFLOW] intake_reminder: Parent intake package already completed for appointment ${ctx.appointmentId}. Skipping.`
      );
      return { status: "sent", resultData: { note: "skipped — package already completed" } };
    }
  }

  // Fetch the journey to get the token
  const { data: journey } = await supabase
    .from("intake_package_journeys")
    .select("journey_token, status")
    .eq("appointment_id", ctx.appointmentId)
    .limit(1)
    .single();

  if (!journey) {
    return {
      status: "failed",
      error: "No intake package journey found for appointment — intake package may not have fired yet",
    };
  }

  if (journey.status === "completed") {
    return { status: "sent", resultData: { note: "skipped — journey already completed" } };
  }

  const url = `${getBaseUrl()}/intake/${journey.journey_token}`;
  const template = (ctx.config.message_body as string) ?? "";
  const message = template
    ? template
        .replace(/\{patient_first_name\}/g, ctx.patientFirstName)
        .replace(/\{link\}/g, url)
        .replace(/\{clinic_name\}/g, ctx.clinicName)
    : `Hi ${ctx.patientFirstName}, just a reminder to complete your intake. Tap here to continue: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] intake_reminder: Sent reminder to ${ctx.phoneNumber} for appointment ${ctx.appointmentId}`
  );

  return { status: "sent" };
}

/** Create a session on the run sheet and send the patient their join link. */
async function handleAddToRunsheet(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const supabase = createServiceClient();

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, room_id, location_id, patient_id, phone_number")
    .eq("id", ctx.appointmentId)
    .single();

  if (!appointment) {
    return { status: "failed", error: "Appointment not found" };
  }

  if (!appointment.room_id) {
    return { status: "failed", error: "No room assigned to appointment" };
  }

  const entryToken = crypto.randomUUID();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      appointment_id: appointment.id,
      room_id: appointment.room_id,
      location_id: appointment.location_id,
      status: "queued",
      entry_token: entryToken,
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    return { status: "failed", error: `Failed to create session: ${sessionError?.message}` };
  }

  if (appointment.patient_id) {
    await supabase.from("session_participants").insert({
      session_id: session.id,
      patient_id: appointment.patient_id,
      role: "patient",
    });
  }

  const sessionLink = `${getBaseUrl()}/entry/${entryToken}`;

  const sms = getSmsProvider();
  const phoneNumber = appointment.phone_number ?? ctx.phoneNumber;
  const result = await sms.sendNotification(
    phoneNumber,
    `Hi ${ctx.patientFirstName}, your appointment is ready. Join here: ${sessionLink}`
  );

  if (!result.success) {
    // Session was created but SMS failed — log but don't fail the action
    console.error(
      `[WORKFLOW] add_to_runsheet: Session ${session.id} created but SMS failed: ${result.error}`
    );
  }

  console.log(
    `[WORKFLOW] add_to_runsheet: Session ${session.id} created. SMS to ${phoneNumber}: ${sessionLink}`
  );

  return {
    status: "sent",
    resultData: { session_id: session.id, entry_token: entryToken },
  };
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

/** Send a file to the patient via SMS. Creates a file_delivery and sends the link. */
async function handleSendFile(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const fileId = ctx.config.file_id as string | undefined;
  if (!fileId) {
    return { status: "failed", error: "No file_id configured on this action" };
  }

  const supabase = createServiceClient();

  // Get file details
  const { data: file } = await supabase
    .from("files")
    .select("id, name, storage_path")
    .eq("id", fileId)
    .single();

  if (!file) {
    return { status: "failed", error: `File ${fileId} not found` };
  }

  // Create file_delivery with unique token
  const token = crypto.randomUUID();
  const { data: delivery, error: deliveryError } = await supabase
    .from("file_deliveries")
    .insert({
      file_id: file.id,
      patient_id: ctx.patientId,
      session_id: ctx.sessionId,
      token,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (deliveryError || !delivery) {
    return {
      status: "failed",
      error: deliveryError?.message ?? "Failed to create file delivery",
    };
  }

  // Build the patient-facing URL
  const viewUrl = `${getBaseUrl()}/files/view/${token}`;

  // Interpolate the SMS message template
  const template = (ctx.config.message as string) ?? "";
  const message = template
    ? template
        .replace(/\{first_name\}/g, ctx.patientFirstName)
        .replace(/\{clinic_name\}/g, ctx.clinicName)
        .replace(/\{clinician_name\}/g, ctx.clinicianName ?? "your clinician")
        .replace(/\{file_link\}/g, viewUrl)
    : `Hi ${ctx.patientFirstName}, your clinician has shared a document with you. View it here: ${viewUrl}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  console.log(
    `[WORKFLOW] send_file: sent file '${file.name}' to ${ctx.phoneNumber} (delivery ${delivery.id})`
  );

  return {
    status: "sent",
    resultData: { file_delivery_id: delivery.id, file_name: file.name },
  };
}

/**
 * Handle a staff-facing task action. No external side effect — the scanner
 * transitions the status from scheduled to fired, which surfaces the task on
 * the post-appointment readiness dashboard. The receptionist resolves it
 * manually via the Resolve button.
 */
async function handleTask(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const taskTitle = (ctx.config.task_title as string) ?? "Task";
  console.log(
    `[WORKFLOW] task: fired "${taskTitle}" for action ${ctx.actionId}`
  );
  return { status: "fired" };
}
