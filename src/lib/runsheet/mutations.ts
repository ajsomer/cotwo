"use server";

import { createClient } from "@/lib/supabase/server";
import { getSmsProvider } from "@/lib/sms";
import { normalisePhone } from "@/lib/phone/normalise";

interface SessionInput {
  phone_number: string;
  scheduled_at: string;
  room_id: string;
}

/**
 * Determine which SMS to send based on the gap between now and scheduled_at.
 *
 * - 1+ hours away: send prep SMS now, invite SMS at T-10 min (automated job)
 * - < 1 hour: skip prep, invite at T-10 min
 * - < 10 minutes: send invite immediately
 */
function getSmsAction(scheduledAt: string): "prep" | "invite_immediate" | "none" {
  const now = Date.now();
  const scheduled = new Date(scheduledAt).getTime();
  const gapMs = scheduled - now;
  const gapMinutes = gapMs / (1000 * 60);

  if (gapMinutes < 10) return "invite_immediate";
  if (gapMinutes < 60) return "none"; // invite fires at T-10 via cron
  return "prep";
}

/**
 * For prep SMS: apply timing rules to avoid antisocial hours.
 * Returns true if the SMS should be sent now, false if it should be queued.
 * (Queuing for 6pm is a future enhancement — for now, always send.)
 */
function shouldSendPrepNow(scheduledAt: string): boolean {
  const scheduled = new Date(scheduledAt);
  const now = new Date();
  const isToday = scheduled.toDateString() === now.toDateString();

  if (isToday) return true; // Today, 1+ hours away: send immediately

  // Tomorrow: check if before/after 6pm
  const hour = now.getHours();
  if (hour < 18) {
    // Before 6pm — ideally queue for 6pm. For prototype, send now.
    return true;
  }

  // After 6pm — send immediately
  return true;
}

/** Create sessions from the add session panel. */
export async function createSessions(
  locationId: string,
  orgId: string,
  clinicName: string,
  sessions: SessionInput[]
) {
  const supabase = await createClient();
  const sms = getSmsProvider();

  const results = [];
  for (const input of sessions) {
    // Canonical E.164 so this number matches the same patient however it was
    // entered elsewhere (patient OTP entry, readiness, PMS). Fall back to the
    // raw input if it can't be normalised rather than dropping the session.
    const phoneNumber = normalisePhone(input.phone_number) ?? input.phone_number;

    // Create appointment
    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .insert({
        org_id: orgId,
        room_id: input.room_id,
        location_id: locationId,
        scheduled_at: input.scheduled_at,
        phone_number: phoneNumber,
        appointment_type_id: null,
      })
      .select("id")
      .single();

    if (apptError) {
      console.error("[CREATE] Failed to create appointment:", apptError);
      continue;
    }

    // Create session
    const smsAction = getSmsAction(input.scheduled_at);
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        appointment_id: appointment.id,
        room_id: input.room_id,
        location_id: locationId,
        status: "queued",
        notification_sent: smsAction === "prep",
        notification_sent_at: smsAction === "prep" ? new Date().toISOString() : null,
        invite_sent: smsAction === "invite_immediate",
        invite_sent_at: smsAction === "invite_immediate" ? new Date().toISOString() : null,
      })
      .select("id, entry_token")
      .single();

    if (sessionError) {
      console.error("[CREATE] Failed to create session:", sessionError);
      continue;
    }

    // Resolve existing patient by phone number and link to session
    const { data: phoneMatch } = await supabase
      .from("patient_phone_numbers")
      .select("patient_id, patients!inner (id, org_id)")
      .eq("phone_number", phoneNumber)
      .limit(10);

    const matchedPatient = (phoneMatch ?? []).find((row: Record<string, unknown>) => {
      const p = row.patients as Record<string, unknown> | null;
      return p?.org_id === orgId;
    });

    if (matchedPatient) {
      await supabase.from("session_participants").insert({
        session_id: session.id,
        patient_id: matchedPatient.patient_id,
        role: "patient",
      });

      // Also set patient_id on the appointment
      await supabase
        .from("appointments")
        .update({ patient_id: matchedPatient.patient_id })
        .eq("id", appointment.id);
    }

    // Send SMS based on timing
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const entryLink = `${appUrl}/entry/${session.entry_token}`;
    const scheduledTime = new Date(input.scheduled_at).toLocaleTimeString(
      "en-AU",
      { hour: "numeric", minute: "2-digit", hour12: true }
    );
    const isToday =
      new Date(input.scheduled_at).toDateString() === new Date().toDateString();
    const timeLabel = isToday ? `today at ${scheduledTime}` : `tomorrow at ${scheduledTime}`;

    if (smsAction === "prep" && shouldSendPrepNow(input.scheduled_at)) {
      await sms.sendNotification(
        phoneNumber,
        `Hi — you have an upcoming appointment with ${clinicName} ${timeLabel}. Get ready ahead of time so your clinician can focus on you: ${entryLink}`
      );
    } else if (smsAction === "invite_immediate") {
      await sms.sendNotification(
        phoneNumber,
        `Your appointment with ${clinicName} starts in 10 minutes. Join here: ${entryLink}`
      );
    }

    results.push({ id: session.id, entryLink });
  }

  return { success: true, count: results.length, links: results.map((r) => r.entryLink) };
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

  // Normalise an updated phone number to the canonical E.164 form.
  const normalisedUpdates =
    updates.phone_number !== undefined
      ? {
          ...updates,
          phone_number:
            normalisePhone(updates.phone_number) ?? updates.phone_number,
        }
      : updates;

  const { error } = await supabase
    .from("appointments")
    .update(normalisedUpdates)
    .eq("id", session.appointment_id);

  if (error) {
    return { success: false, error: error.message };
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
    const phone = appointment?.phone_number as string | undefined;
    if (phone) {
      const sms = getSmsProvider();
      await sms.sendNotification(
        phone,
        "Your appointment has been cancelled. Please contact the clinic if you have questions."
      );
    }
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

  return { success: true };
}
