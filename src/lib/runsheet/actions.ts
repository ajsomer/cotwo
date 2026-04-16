"use server";

import { createClient } from "@/lib/supabase/server";
import { getSmsProvider } from "@/lib/sms";

/** Call a late patient — logs to console for prototype. */
export async function callPatient(sessionId: string) {
  const supabase = await createClient();

  // Get patient phone number
  const { data: session } = await supabase
    .from("sessions")
    .select(
      `
      id,
      appointments!left (
        phone_number,
        patients!left (
          first_name,
          last_name
        )
      ),
      session_participants!left (
        patients!inner (
          first_name,
          last_name,
          patient_phone_numbers!left (
            phone_number,
            is_primary
          )
        )
      )
    `
    )
    .eq("id", sessionId)
    .single();

  if (!session) return { success: false, error: "Session not found" };

  const appointment = session.appointments as unknown as Record<string, unknown> | null;
  const phone = appointment?.phone_number as string | null;

  console.log(
    `[CALL] Would call patient for session ${sessionId} at ${phone ?? "unknown number"}`
  );

  return { success: true, phone };
}

/** Send a nudge SMS to an upcoming patient who hasn't responded. */
export async function nudgePatient(sessionId: string) {
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, entry_token, appointments!left (phone_number)")
    .eq("id", sessionId)
    .single();

  if (!session) return { success: false, error: "Session not found" };

  const appointment = session.appointments as unknown as Record<string, unknown> | null;
  const phone = appointment?.phone_number as string | null;

  // Send nudge SMS via provider
  if (phone && session.entry_token) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const entryLink = `${appUrl}/entry/${session.entry_token}`;
    const sms = getSmsProvider();
    await sms.sendNotification(
      phone,
      `Reminder: Your appointment is coming up. Join here: ${entryLink}`
    );
  }

  // Update notification_sent_at to track the nudge
  await supabase
    .from("sessions")
    .update({ notification_sent_at: new Date().toISOString() })
    .eq("id", sessionId);

  return { success: true };
}

/** Admit a waiting patient — start the video session. */
export async function admitPatient(sessionId: string) {
  const supabase = await createClient();

  // Transition: waiting -> in_session
  const { error } = await supabase
    .from("sessions")
    .update({
      status: "in_session",
      session_started_at: new Date().toISOString(),
      video_call_id: `room-${sessionId}-${Date.now()}`, // Stub LiveKit room ID
    })
    .eq("id", sessionId)
    .eq("status", "waiting");

  if (error) {
    console.error("[ADMIT] Failed:", error);
    return { success: false, error: error.message };
  }

  console.log(`[ADMIT] Session ${sessionId} admitted, video session started`);
  return { success: true };
}

/** Mark a session as complete (clinician ends the session). */
export async function markSessionComplete(sessionId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("sessions")
    .update({
      status: "complete",
      session_ended_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "in_session");

  if (error) {
    console.error("[COMPLETE] Failed:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/** Mark a session as done (after processing). */
export async function markSessionDone(sessionId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("sessions")
    .update({ status: "done" })
    .eq("id", sessionId);

  if (error) {
    console.error("[DONE] Failed:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/** Charge payment for a session. Stub for prototype. */
export async function chargePayment(
  sessionId: string,
  amountCents: number
) {
  const supabase = await createClient();

  // Get session details for payment
  const { data: session } = await supabase
    .from("sessions")
    .select(
      `
      id,
      appointment_id,
      session_participants!left (
        patient_id,
        patients!inner (
          payment_methods!left (
            stripe_payment_method_id,
            card_last_four,
            card_brand,
            is_default
          )
        )
      )
    `
    )
    .eq("id", sessionId)
    .single();

  if (!session) return { success: false, error: "Session not found" };

  console.log(
    `[PAYMENT] Would charge $${(amountCents / 100).toFixed(2)} for session ${sessionId}`
  );

  // Create payment record
  const participants = session.session_participants as unknown as Array<Record<string, unknown>> | null;
  const patientId = participants?.[0]?.patient_id as string | null;

  const { error } = await supabase.from("payments").insert({
    session_id: sessionId,
    appointment_id: session.appointment_id,
    patient_id: patientId,
    amount_cents: amountCents,
    status: "completed", // Stub: in production this would be 'processing' until Stripe confirms
    stripe_payment_intent_id: `pi_test_${Date.now()}`,
    stripe_account_id: "acct_test_bondi",
  });

  if (error) {
    console.error("[PAYMENT] Failed to create payment record:", error);
    return { success: false, error: error.message };
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
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("confirm_outcome_pathway", {
    p_session_id: sessionId,
    p_pathway_id: pathwayId,
    p_actions: actions,
  });

  if (error) {
    console.error("[OUTCOME] Failed to confirm pathway:", error.message);
    return { success: false, error: error.message };
  }

  const result = data as { workflow_run_id: string; action_count: number } | null;
  console.log(
    `[OUTCOME] Session ${sessionId} confirmed pathway ${pathwayId}: ${result?.action_count ?? 0} actions scheduled`
  );

  return { success: true, workflow_run_id: result?.workflow_run_id };
}

/**
 * Skip outcome pathway — mark session as done with no post-appointment actions.
 * Used when receptionist clicks "No outcome pathway required" at Process.
 */
export async function skipOutcomePathway(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("sessions")
    .update({
      status: "done",
      session_ended_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    console.error("[OUTCOME] Failed to skip pathway:", error.message);
    return { success: false, error: error.message };
  }

  console.log(`[OUTCOME] Session ${sessionId} marked done with no pathway`);
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
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("appointment_actions")
    .update({
      status: "completed",
      completed_at: now,
      resolved_at: now,
      resolved_by: userId,
      resolution_note: note ?? null,
    })
    .eq("id", actionId);

  if (error) {
    console.error("[TASK] Failed to resolve task:", error.message);
    return { success: false, error: error.message };
  }

  // Check workflow run completion
  const { data: action } = await supabase
    .from("appointment_actions")
    .select("workflow_run_id")
    .eq("id", actionId)
    .single();

  if (action?.workflow_run_id) {
    const terminalStatuses = ["completed", "failed", "cancelled", "skipped", "dropped"];
    const { data: remaining } = await supabase
      .from("appointment_actions")
      .select("id")
      .eq("workflow_run_id", action.workflow_run_id)
      .not("status", "in", `(${terminalStatuses.join(",")})`);

    if (remaining && remaining.length === 0) {
      await supabase
        .from("appointment_workflow_runs")
        .update({ status: "complete", completed_at: now })
        .eq("id", action.workflow_run_id);
    }
  }

  console.log(`[TASK] Resolved action ${actionId}`);
  return { success: true };
}

/**
 * Cancel a scheduled or fired action before completion.
 * Used when a patient reschedules or the pathway is no longer relevant.
 */
export async function cancelAction(
  actionId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("appointment_actions")
    .update({ status: "cancelled" })
    .eq("id", actionId)
    .in("status", ["scheduled", "fired"]);

  if (error) {
    console.error("[ACTION] Failed to cancel action:", error.message);
    return { success: false, error: error.message };
  }

  // Check workflow run completion
  const { data: action } = await supabase
    .from("appointment_actions")
    .select("workflow_run_id")
    .eq("id", actionId)
    .single();

  if (action?.workflow_run_id) {
    const terminalStatuses = ["completed", "failed", "cancelled", "skipped", "dropped"];
    const { data: remaining } = await supabase
      .from("appointment_actions")
      .select("id")
      .eq("workflow_run_id", action.workflow_run_id)
      .not("status", "in", `(${terminalStatuses.join(",")})`);

    if (remaining && remaining.length === 0) {
      await supabase
        .from("appointment_workflow_runs")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("id", action.workflow_run_id);
    }
  }

  console.log(`[ACTION] Cancelled action ${actionId}`);
  return { success: true };
}
