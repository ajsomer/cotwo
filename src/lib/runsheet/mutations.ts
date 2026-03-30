"use server";

import { createClient } from "@/lib/supabase/server";

interface SessionInput {
  phone_number: string;
  scheduled_at: string;
  room_id: string;
}

/** Create sessions from the add session panel. */
export async function createSessions(
  locationId: string,
  orgId: string,
  sessions: SessionInput[]
) {
  const supabase = await createClient();

  const results = [];
  for (const input of sessions) {
    // Create appointment
    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .insert({
        org_id: orgId,
        room_id: input.room_id,
        location_id: locationId,
        scheduled_at: input.scheduled_at,
        phone_number: input.phone_number,
      })
      .select("id")
      .single();

    if (apptError) {
      console.error("[CREATE] Failed to create appointment:", apptError);
      continue;
    }

    // Create session
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        appointment_id: appointment.id,
        room_id: input.room_id,
        location_id: locationId,
        status: "queued",
        notification_sent: true,
        notification_sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sessionError) {
      console.error("[CREATE] Failed to create session:", sessionError);
      continue;
    }

    console.log(
      `[SMS] Would send join notification to ${input.phone_number} for session ${session.id}`
    );

    results.push(session);
  }

  return { success: true, count: results.length };
}

/** Update an existing session's time or phone number. */
export async function updateSession(
  sessionId: string,
  updates: { scheduled_at?: string; phone_number?: string }
) {
  const supabase = await createClient();

  // Get the session's appointment ID
  const { data: session } = await supabase
    .from("sessions")
    .select("appointment_id")
    .eq("id", sessionId)
    .single();

  if (!session?.appointment_id) {
    return { success: false, error: "Session has no appointment" };
  }

  const { error } = await supabase
    .from("appointments")
    .update(updates)
    .eq("id", session.appointment_id);

  if (error) {
    return { success: false, error: error.message };
  }

  if (updates.scheduled_at) {
    console.log(
      `[SMS] Would send updated time notification for session ${sessionId}`
    );
  }

  return { success: true };
}

/** Delete a session. Sends cancellation SMS if notification was sent. */
export async function deleteSession(sessionId: string) {
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, notification_sent, appointments!left (phone_number)")
    .eq("id", sessionId)
    .single();

  if (!session) return { success: false, error: "Session not found" };

  if (session.notification_sent) {
    const appointment = session.appointments as unknown as Record<string, unknown> | null;
    console.log(
      `[SMS] Would send cancellation SMS to ${appointment?.phone_number ?? "unknown"}`
    );
  }

  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", sessionId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Mark a session as no-show. */
export async function markNoShow(sessionId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("sessions")
    .update({ status: "done" })
    .eq("id", sessionId);

  if (error) return { success: false, error: error.message };

  // Also update appointment status
  const { data: session } = await supabase
    .from("sessions")
    .select("appointment_id")
    .eq("id", sessionId)
    .single();

  if (session?.appointment_id) {
    await supabase
      .from("appointments")
      .update({ status: "no_show" })
      .eq("id", session.appointment_id);
  }

  console.log(`[NO-SHOW] Session ${sessionId} marked as no-show`);
  return { success: true };
}
