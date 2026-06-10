import { db } from "@/lib/db";
import {
  forms as formsT,
  formAssignments,
  sessions as sessionsT,
  intakePackageJourneys,
  appointmentActions,
  appointments as appointmentsT,
  sessionParticipants,
  files as filesT,
  fileDeliveries,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSmsProvider } from "@/lib/sms";
import { getBaseUrl } from "@/lib/utils/url";
import { renderTemplate, smsTemplateVars, intakeTemplateVars } from "./template";
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
  /** IANA timezone of the appointment's location — merge-field times must
   *  render in clinic-local time, never the server's TZ. */
  timezone: string;
  formId: string | null;
  config: Record<string, unknown>;
  /** The action block's parent_action_block_id (for intake_reminder). */
  parentActionBlockId: string | null;
  /** Session ID for post-appointment actions. NULL for pre-appointment. */
  sessionId: string | null;
  /** Session ended timestamp for post-appointment merge field resolution. */
  sessionEndedAt: string | null;
  /**
   * When true, handlers that would send an outbound patient SMS skip it (the
   * session/state mutation still happens). Set on the early-fire path where the
   * patient is already in-app finishing intake — they don't need a "join here"
   * SMS, and the request shouldn't block on the provider round-trip.
   */
  suppressNotification?: boolean;
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
      return handleTask();
    default:
      // Action types that don't execute in v1 (send_rebooking_nudge, etc.)
      return { status: "sent", resultData: { note: "stub — not implemented in v1" } };
  }
}

/** Send a form to the patient via SMS. Creates a form_assignment and sends the link. */
async function handleDeliverForm(ctx: HandlerContext): Promise<ActionHandlerResult> {
  if (!ctx.formId) {
    return { status: "failed", error: "No form_id configured on this action" };
  }

  // Get form details
  const [form] = await db
    .select({ id: formsT.id, name: formsT.name, schema: formsT.schema, status: formsT.status })
    .from(formsT)
    .where(eq(formsT.id, ctx.formId));

  if (!form) {
    return { status: "failed", error: `Form ${ctx.formId} not found` };
  }

  // Create form_assignment
  let assignment: { id: string; token: string } | undefined;
  try {
    [assignment] = await db
      .insert(formAssignments)
      .values({
        formId: form.id,
        patientId: ctx.patientId,
        appointmentId: ctx.appointmentId,
        schemaSnapshot: form.schema,
        status: "sent",
        sentAt: new Date().toISOString(),
      })
      .returning({ id: formAssignments.id, token: formAssignments.token });
  } catch (assignError) {
    return { status: "failed", error: (assignError as Error)?.message ?? "Failed to create form assignment" };
  }

  if (!assignment) {
    return { status: "failed", error: "Failed to create form assignment" };
  }

  // Send SMS
  const url = `${getBaseUrl()}/form/${assignment.token}`;
  const message = `Hi ${ctx.patientFirstName}, please complete your ${form.name} form before your appointment: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

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

  const message = renderTemplate(template, smsTemplateVars(ctx));

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  return { status: "sent" };
}

/** Send the card capture flow link to the patient. */
async function handleCaptureCard(ctx: HandlerContext): Promise<ActionHandlerResult> {
  // In the prototype, the card capture happens in the patient entry flow.
  // The workflow action sends a link to the entry flow where card capture is a step.

  // Find the session for this appointment to get the entry token
  const [session] = await db
    .select({ entry_token: sessionsT.entryToken })
    .from(sessionsT)
    .where(eq(sessionsT.appointmentId, ctx.appointmentId))
    .limit(1);

  const url = session
    ? `${getBaseUrl()}/entry/${session.entry_token}`
    : `${getBaseUrl()}`;

  const message = `Hi ${ctx.patientFirstName}, please add your payment card ahead of your appointment: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  return { status: "sent" };
}

// ============================================================================
// Intake Package Handlers (v2 pre-appointment model)
// ============================================================================


/**
 * Create an intake package journey and send the patient the journey link.
 *
 * The journey is seeded with `patient_id` drawn from the appointment, set at
 * add-patient time. Identity in the journey is confirm-mode only: the patient
 * proves ownership of the phone number the clinic asserted against.
 */
async function handleIntakePackage(ctx: HandlerContext): Promise<ActionHandlerResult> {
  if (!ctx.patientId) {
    return {
      status: "failed",
      error: "Intake package requires a patient on the appointment",
    };
  }

  const config = ctx.config as {
    includes_card_capture?: boolean;
    includes_consent?: boolean;
    form_ids?: string[];
    message_body?: string;
  };

  const journeyToken = crypto.randomUUID();

  let journey: { id: string } | undefined;
  try {
    [journey] = await db
      .insert(intakePackageJourneys)
      .values({
        appointmentId: ctx.appointmentId,
        patientId: ctx.patientId,
        journeyToken,
        includesCardCapture: config.includes_card_capture ?? false,
        includesConsent: config.includes_consent ?? false,
        formIds: config.form_ids ?? [],
      })
      .returning({ id: intakePackageJourneys.id });
  } catch (journeyError) {
    return { status: "failed", error: `Failed to create intake journey: ${(journeyError as Error)?.message}` };
  }

  if (!journey) {
    return { status: "failed", error: "Failed to create intake journey" };
  }

  const url = `${getBaseUrl()}/intake/${journeyToken}`;
  // Use the configured initial SMS if set (interpolating merge fields, same as
  // handleIntakeReminder); otherwise fall back to the standard body.
  const template = (config.message_body as string) ?? "";
  const message = template
    ? renderTemplate(template, intakeTemplateVars(ctx, url))
    : `Hi ${ctx.patientFirstName}, please complete your intake before your appointment at ${ctx.clinicName}: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

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
  // Check parent intake_package action status
  if (ctx.parentActionBlockId) {
    const [parentAction] = await db
      .select({ status: appointmentActions.status })
      .from(appointmentActions)
      .where(
        and(
          eq(appointmentActions.appointmentId, ctx.appointmentId),
          eq(appointmentActions.actionBlockId, ctx.parentActionBlockId)
        )
      )
      .limit(1);

    if (parentAction?.status === "completed") {
      return { status: "sent", resultData: { note: "skipped — package already completed" } };
    }
  }

  // Fetch the journey to get the token
  const [journey] = await db
    .select({ journey_token: intakePackageJourneys.journeyToken, status: intakePackageJourneys.status })
    .from(intakePackageJourneys)
    .where(eq(intakePackageJourneys.appointmentId, ctx.appointmentId))
    .limit(1);

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
    ? renderTemplate(template, intakeTemplateVars(ctx, url))
    : `Hi ${ctx.patientFirstName}, just a reminder to complete your intake. Tap here to continue: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  return { status: "sent" };
}

/** Create a session on the run sheet and send the patient their join link. */
async function handleAddToRunsheet(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const [appointment] = await db
    .select({
      id: appointmentsT.id,
      room_id: appointmentsT.roomId,
      location_id: appointmentsT.locationId,
      patient_id: appointmentsT.patientId,
      phone_number: appointmentsT.phoneNumber,
    })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, ctx.appointmentId));

  if (!appointment) {
    return { status: "failed", error: "Appointment not found" };
  }

  if (!appointment.room_id) {
    return { status: "failed", error: "No room assigned to appointment" };
  }

  const entryToken = crypto.randomUUID();

  let session: { id: string } | undefined;
  try {
    [session] = await db
      .insert(sessionsT)
      .values({
        appointmentId: appointment.id,
        roomId: appointment.room_id,
        locationId: appointment.location_id,
        status: "queued",
        entryToken,
      })
      .returning({ id: sessionsT.id });
  } catch (sessionError) {
    return { status: "failed", error: `Failed to create session: ${(sessionError as Error)?.message}` };
  }

  if (!session) {
    return { status: "failed", error: "Failed to create session" };
  }

  if (appointment.patient_id) {
    await db.insert(sessionParticipants).values({
      sessionId: session.id,
      patientId: appointment.patient_id,
      role: "patient",
    });
  }

  // Skip the "join here" SMS when the patient is already in-app (early-fire
  // from the intake flow). Sending it there is pointless and, with a real SMS
  // provider, makes the patient wait on the provider round-trip before they're
  // routed onward. The scheduled/cron path still sends it (patient absent).
  if (!ctx.suppressNotification) {
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
  }

  return {
    status: "sent",
    resultData: { session_id: session.id, entry_token: entryToken },
  };
}

/** Send the contact verification flow link to the patient. */
async function handleVerifyContact(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const [session] = await db
    .select({ entry_token: sessionsT.entryToken })
    .from(sessionsT)
    .where(eq(sessionsT.appointmentId, ctx.appointmentId))
    .limit(1);

  const url = session
    ? `${getBaseUrl()}/entry/${session.entry_token}`
    : `${getBaseUrl()}`;

  const message = `Hi ${ctx.patientFirstName}, please verify your contact details ahead of your appointment: ${url}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

  return { status: "sent" };
}

/** Send a file to the patient via SMS. Creates a file_delivery and sends the link. */
async function handleSendFile(ctx: HandlerContext): Promise<ActionHandlerResult> {
  const fileId = ctx.config.file_id as string | undefined;
  if (!fileId) {
    return { status: "failed", error: "No file_id configured on this action" };
  }

  // Get file details
  const [file] = await db
    .select({ id: filesT.id, name: filesT.name, storage_path: filesT.storagePath })
    .from(filesT)
    .where(eq(filesT.id, fileId));

  if (!file) {
    return { status: "failed", error: `File ${fileId} not found` };
  }

  // Create file_delivery with unique token
  const token = crypto.randomUUID();
  let delivery: { id: string } | undefined;
  try {
    [delivery] = await db
      .insert(fileDeliveries)
      .values({
        fileId: file.id,
        patientId: ctx.patientId,
        sessionId: ctx.sessionId,
        token,
        sentAt: new Date().toISOString(),
      })
      .returning({ id: fileDeliveries.id });
  } catch (deliveryError) {
    return {
      status: "failed",
      error: (deliveryError as Error)?.message ?? "Failed to create file delivery",
    };
  }

  if (!delivery) {
    return { status: "failed", error: "Failed to create file delivery" };
  }

  // Build the patient-facing URL
  const viewUrl = `${getBaseUrl()}/files/view/${token}`;

  // Interpolate the SMS message template
  const template = (ctx.config.message as string) ?? "";
  const message = template
    ? renderTemplate(template, {
        first_name: ctx.patientFirstName,
        clinic_name: ctx.clinicName,
        clinician_name: ctx.clinicianName ?? "your clinician",
        file_link: viewUrl,
      })
    : `Hi ${ctx.patientFirstName}, your clinician has shared a document with you. View it here: ${viewUrl}`;

  const sms = getSmsProvider();
  const result = await sms.sendNotification(ctx.phoneNumber, message);

  if (!result.success) {
    return { status: "failed", error: result.error ?? "SMS delivery failed" };
  }

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
async function handleTask(): Promise<ActionHandlerResult> {
  return { status: "fired" };
}
