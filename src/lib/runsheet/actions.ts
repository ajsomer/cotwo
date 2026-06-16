"use server";

import { db } from "@/lib/db";
import {
  sessions as sessionsT,
  appointments as appointmentsT,
  sessionParticipants,
  payments as paymentsT,
  appointmentActions,
  patients as patientsT,
  patientPhoneNumbers,
  locations as locationsT,
  organisations as organisationsT,
} from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSmsProvider } from "@/lib/sms";
import { getPaymentProvider, getTyroProviderForOrg, type PaymentProviderType } from "@/lib/payments";
import { resolvePatientRefId } from "@/lib/payments/ref-id";
import { getBaseUrl } from "@/lib/utils/url";
import { maybeCompleteWorkflowRuns } from "@/lib/workflows/run-completion";
import {
  broadcastSessionChange,
  broadcastSessionStatus,
  broadcastReadinessChange,
} from "@/lib/realtime/broadcast";

/** Send a nudge SMS to an upcoming patient who hasn't responded. */
export async function nudgePatient(sessionId: string) {
  const [session] = await db
    .select({
      id: sessionsT.id,
      entry_token: sessionsT.entryToken,
      appointment_id: sessionsT.appointmentId,
    })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId));

  if (!session) return { success: false, error: "Session not found" };

  let phone: string | null = null;
  if (session.appointment_id) {
    const [appt] = await db
      .select({ phone_number: appointmentsT.phoneNumber })
      .from(appointmentsT)
      .where(eq(appointmentsT.id, session.appointment_id));
    phone = appt?.phone_number ?? null;
  }

  // Send nudge SMS via provider
  if (phone && session.entry_token) {
    const entryLink = `${getBaseUrl()}/entry/${session.entry_token}`;
    const sms = getSmsProvider();
    await sms.sendNotification(
      phone,
      `Reminder: Your appointment is coming up. Join here: ${entryLink}`
    );
  }

  // Update notification_sent_at to track the nudge
  await db
    .update(sessionsT)
    .set({ notificationSentAt: new Date().toISOString() })
    .where(eq(sessionsT.id, sessionId));

  return { success: true };
}

/** Admit a waiting patient — start the video session. */
export async function admitPatient(sessionId: string) {
  // Transition: waiting -> in_session
  let updated: { location_id: string } | undefined;
  try {
    [updated] = await db
      .update(sessionsT)
      .set({
        status: "in_session",
        sessionStartedAt: new Date().toISOString(),
        videoCallId: `session-${sessionId}`, // Deterministic LiveKit room name
      })
      .where(and(eq(sessionsT.id, sessionId), eq(sessionsT.status, "waiting")))
      .returning({ location_id: sessionsT.locationId });
  } catch (error) {
    console.error("[ADMIT] Failed:", error);
    return { success: false, error: (error as Error).message };
  }

  await broadcastSessionStatus(sessionId, "in_session");
  if (updated?.location_id) {
    await broadcastSessionChange(updated.location_id, "status_changed", {
      session_id: sessionId,
    });
  }

  return { success: true };
}

/** Mark a session as complete (clinician ends the session). */
export async function markSessionComplete(sessionId: string) {
  let updated: { location_id: string } | undefined;
  try {
    [updated] = await db
      .update(sessionsT)
      .set({
        status: "complete",
        sessionEndedAt: new Date().toISOString(),
      })
      .where(and(eq(sessionsT.id, sessionId), eq(sessionsT.status, "in_session")))
      .returning({ location_id: sessionsT.locationId });
  } catch (error) {
    console.error("[COMPLETE] Failed:", error);
    return { success: false, error: (error as Error).message };
  }

  await broadcastSessionStatus(sessionId, "complete");
  if (updated?.location_id) {
    await broadcastSessionChange(updated.location_id, "status_changed", {
      session_id: sessionId,
    });
  }

  return { success: true };
}

/** Mark a session as done (after processing). */
export async function markSessionDone(sessionId: string) {
  let updated: { location_id: string } | undefined;
  try {
    [updated] = await db
      .update(sessionsT)
      .set({ status: "done" })
      .where(eq(sessionsT.id, sessionId))
      .returning({ location_id: sessionsT.locationId });
  } catch (error) {
    console.error("[DONE] Failed:", error);
    return { success: false, error: (error as Error).message };
  }

  await broadcastSessionStatus(sessionId, "done");
  if (updated?.location_id) {
    await broadcastSessionChange(updated.location_id, "status_changed", {
      session_id: sessionId,
    });
  }

  return { success: true };
}

/**
 * Charge payment for a session, routed through the org's configured payment
 * provider (organisations.payment_provider).
 *
 * Stripe (stubbed) and console return 'completed' immediately. Tyro returns a
 * hosted paymentRequestUrl the patient completes — Tyro is patient-present, so
 * the payment row is recorded as 'processing' and the URL returned to the UI;
 * the Tyro webhook (api/webhooks/tyro) flips it to 'completed' on settlement.
 */
export async function chargePayment(sessionId: string, amountCents: number) {
  // Session + its org context (provider + Tyro location identifier) in one hop.
  const [session] = await db
    .select({
      id: sessionsT.id,
      appointment_id: sessionsT.appointmentId,
      location_id: sessionsT.locationId,
      org_id: organisationsT.id,
      payment_provider: organisationsT.paymentProvider,
      tyro_provider_number: organisationsT.tyroProviderNumber,
    })
    .from(sessionsT)
    .innerJoin(locationsT, eq(sessionsT.locationId, locationsT.id))
    .innerJoin(organisationsT, eq(locationsT.orgId, organisationsT.id))
    .where(eq(sessionsT.id, sessionId));

  if (!session) return { success: false, error: "Session not found" };

  // Resolve the session's patient (first participant) + identity for the charge.
  const [participant] = await db
    .select({ patient_id: sessionParticipants.patientId })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, sessionId))
    .limit(1);
  const patientId = participant?.patient_id ?? null;

  // Tyro uses the org's connected credentials; others are env/stub.
  const provider =
    session.payment_provider === "tyro"
      ? await getTyroProviderForOrg(session.org_id)
      : getPaymentProvider(session.payment_provider as PaymentProviderType);

  // Tyro needs patient identity + a stable refId; resolve only what's needed.
  let result;
  try {
    if (session.payment_provider === "tyro") {
      if (!patientId) {
        return { success: false, error: "No patient on session" };
      }
      if (!session.tyro_provider_number) {
        return {
          success: false,
          error: "Org has no Tyro location identifier configured",
        };
      }

      const [patient] = await db
        .select({
          first_name: patientsT.firstName,
          last_name: patientsT.lastName,
          dob: patientsT.dateOfBirth,
        })
        .from(patientsT)
        .where(eq(patientsT.id, patientId));

      const [phone] = await db
        .select({ phone_number: patientPhoneNumbers.phoneNumber })
        .from(patientPhoneNumbers)
        .where(eq(patientPhoneNumbers.patientId, patientId))
        .orderBy(sql`is_primary desc`)
        .limit(1);

      const refId = await resolvePatientRefId(patientId);

      result = await provider.createCharge({
        sessionId,
        patientRefId: refId,
        amountCents,
        locationProviderNumber: session.tyro_provider_number,
        patient: {
          firstName: patient?.first_name ?? "Patient",
          lastName: patient?.last_name ?? "",
          mobile: phone?.phone_number ?? "",
          dob: patient?.dob ?? "1990-01-01",
        },
        description: "Consultation",
      });
    } else {
      // Stripe (stub) / console — no patient identity needed.
      result = await provider.createCharge({
        sessionId,
        patientRefId: "",
        amountCents,
        locationProviderNumber: "",
        patient: { firstName: "", lastName: "", mobile: "", dob: "" },
        description: "Consultation",
      });
    }
  } catch (error) {
    console.error("[PAYMENT] Provider charge failed:", error);
    return { success: false, error: (error as Error).message };
  }

  if (result.status === "failed") {
    return { success: false, error: result.error };
  }

  // Persist the payment row with provider-neutral fields.
  const paymentRequestUrl =
    result.status === "requires_action" ? result.paymentRequestUrl : null;
  try {
    await db.insert(paymentsT).values({
      sessionId,
      appointmentId: session.appointment_id,
      patientId,
      amountCents,
      status: paymentRequestUrl ? "processing" : "completed",
      provider: session.payment_provider,
      providerTxnId: result.providerTxnId || null,
      paymentRequestUrl,
    });
  } catch (error) {
    console.error("[PAYMENT] Failed to create payment record:", error);
    return { success: false, error: (error as Error).message };
  }

  // Broadcast so the run sheet store refetches and picks up payment_status.
  if (session.location_id) {
    await broadcastSessionChange(session.location_id, "session_updated", {
      session_id: sessionId,
    });
  }

  // For Tyro, hand the hosted URL back to the UI to present/SMS to the patient.
  if (paymentRequestUrl) {
    return { success: true, paymentRequestUrl };
  }
  return { success: true };
}

/**
 * Confirm an outcome pathway for a session. Complete tier only.
 * Thin wrapper around the confirm_outcome_pathway RPC, which atomically:
 *   - Sets sessions.session_ended_at, outcome_pathway_id, status = 'done'
 *   - Creates appointment_workflow_runs row
 *   - Creates appointment_actions rows with config snapshots
 */
export async function selectOutcomePathway(
  sessionId: string,
  pathwayId: string,
  actions: Array<{
    action_block_id: string;
    action_type: string;
    offset_minutes: number;
    config: Record<string, unknown>;
    form_id: string | null;
  }>
): Promise<{ success: boolean; error?: string; workflow_run_id?: string }> {
  let result: { workflow_run_id: string; action_count: number } | null = null;
  try {
    const res = await db.execute(
      sql`select * from public.confirm_outcome_pathway(${sessionId}, ${pathwayId}, ${JSON.stringify(actions)}::jsonb)`
    );
    const row = (res.rows?.[0] ?? null) as
      | { confirm_outcome_pathway: { workflow_run_id: string; action_count: number } }
      | { workflow_run_id: string; action_count: number }
      | null;
    if (row) {
      result =
        "confirm_outcome_pathway" in row
          ? row.confirm_outcome_pathway
          : (row as { workflow_run_id: string; action_count: number });
    }
  } catch (error) {
    console.error("[OUTCOME] Failed to confirm pathway:", (error as Error).message);
    return { success: false, error: (error as Error).message };
  }

  await broadcastSessionStatus(sessionId, "done");
  const [session] = await db
    .select({ location_id: sessionsT.locationId })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId));
  if (session?.location_id) {
    await broadcastSessionChange(session.location_id, "status_changed", {
      session_id: sessionId,
    });
  }

  return { success: true, workflow_run_id: result?.workflow_run_id };
}

/**
 * Skip outcome pathway — mark session as done with no post-appointment actions.
 * Used when receptionist clicks "No outcome pathway required" at Process.
 */
export async function skipOutcomePathway(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(sessionsT)
      .set({
        status: "done",
        sessionEndedAt: new Date().toISOString(),
      })
      .where(eq(sessionsT.id, sessionId));
  } catch (error) {
    console.error("[OUTCOME] Failed to skip pathway:", (error as Error).message);
    return { success: false, error: (error as Error).message };
  }

  return { success: true };
}

/**
 * Resolve a task action on the readiness dashboard.
 * Sets the action to completed with optional resolution note.
 */
export async function resolveTask(
  actionId: string,
  userId: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();

  try {
    await db
      .update(appointmentActions)
      .set({
        status: "completed",
        completedAt: now,
        resolvedAt: now,
        resolvedBy: userId,
        resolutionNote: note ?? null,
      })
      .where(eq(appointmentActions.id, actionId));
  } catch (error) {
    console.error("[TASK] Failed to resolve task:", (error as Error).message);
    return { success: false, error: (error as Error).message };
  }

  // Check workflow run completion
  const [action] = await db
    .select({
      workflow_run_id: appointmentActions.workflowRunId,
      appointment_id: appointmentActions.appointmentId,
    })
    .from(appointmentActions)
    .where(eq(appointmentActions.id, actionId));

  await maybeCompleteWorkflowRuns([action?.workflow_run_id]);

  // Notify the readiness dashboard at this appointment's location.
  if (action?.appointment_id) {
    const [appt] = await db
      .select({ location_id: appointmentsT.locationId })
      .from(appointmentsT)
      .where(eq(appointmentsT.id, action.appointment_id));
    if (appt?.location_id) {
      await broadcastReadinessChange(appt.location_id, "action_resolved", {
        appointment_id: action.appointment_id,
      });
    }
  }

  return { success: true };
}

/**
 * Cancel a scheduled or fired action before completion.
 * Used when a patient reschedules or the pathway is no longer relevant.
 */
export async function cancelAction(
  actionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(appointmentActions)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(appointmentActions.id, actionId),
          inArray(appointmentActions.status, ["scheduled", "firing"])
        )
      );
  } catch (error) {
    console.error("[ACTION] Failed to cancel action:", (error as Error).message);
    return { success: false, error: (error as Error).message };
  }

  // Check workflow run completion
  const [action] = await db
    .select({ workflow_run_id: appointmentActions.workflowRunId })
    .from(appointmentActions)
    .where(eq(appointmentActions.id, actionId));

  await maybeCompleteWorkflowRuns([action?.workflow_run_id]);

  return { success: true };
}
