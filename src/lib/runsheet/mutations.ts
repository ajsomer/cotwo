"use server";

import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  sessions as sessionsT,
  patientPhoneNumbers,
  patients as patientsT,
  sessionParticipants,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
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

/** Create sessions from the add session panel. */
export async function createSessions(
  locationId: string,
  orgId: string,
  clinicName: string,
  sessions: SessionInput[]
) {
  const sms = getSmsProvider();

  // Canonical E.164 so each number matches the same patient however it was
  // entered elsewhere (patient OTP entry, readiness, PMS). Fall back to the
  // raw input if it can't be normalised rather than dropping the session.
  const inputs = sessions.map((input) => ({
    ...input,
    phoneNumber: normalisePhone(input.phone_number) ?? input.phone_number,
  }));

  // Resolve existing patients by phone in one batched query (was one per row).
  const phoneNumbers = [...new Set(inputs.map((i) => i.phoneNumber))];
  const phoneMatches = phoneNumbers.length
    ? await db
        .select({
          phone_number: patientPhoneNumbers.phoneNumber,
          patient_id: patientPhoneNumbers.patientId,
          org_id: patientsT.orgId,
        })
        .from(patientPhoneNumbers)
        .innerJoin(patientsT, eq(patientsT.id, patientPhoneNumbers.patientId))
        .where(inArray(patientPhoneNumbers.phoneNumber, phoneNumbers))
    : [];
  const patientByPhone = new Map<string, string>();
  for (const row of phoneMatches) {
    if (row.org_id === orgId && !patientByPhone.has(row.phone_number)) {
      patientByPhone.set(row.phone_number, row.patient_id);
    }
  }

  const results = [];
  for (const input of inputs) {
    const { phoneNumber } = input;
    const smsAction = getSmsAction(input.scheduled_at);
    const matchedPatientId = patientByPhone.get(phoneNumber) ?? null;

    // All writes for one row commit or roll back together — a session-insert
    // failure must not orphan the appointment. SMS sends after commit only.
    let session: { id: string; entry_token: string | null } | undefined;
    try {
      session = await db.transaction(async (tx) => {
        const [appointment] = await tx
          .insert(appointmentsT)
          .values({
            orgId,
            roomId: input.room_id,
            locationId,
            scheduledAt: input.scheduled_at,
            phoneNumber,
            patientId: matchedPatientId,
            appointmentTypeId: null,
          })
          .returning({ id: appointmentsT.id });

        const [created] = await tx
          .insert(sessionsT)
          .values({
            appointmentId: appointment.id,
            roomId: input.room_id,
            locationId,
            status: "queued",
            notificationSent: smsAction === "prep",
            notificationSentAt: smsAction === "prep" ? new Date().toISOString() : null,
            inviteSent: smsAction === "invite_immediate",
            inviteSentAt: smsAction === "invite_immediate" ? new Date().toISOString() : null,
          })
          .returning({ id: sessionsT.id, entry_token: sessionsT.entryToken });

        if (matchedPatientId) {
          await tx.insert(sessionParticipants).values({
            sessionId: created.id,
            patientId: matchedPatientId,
            role: "patient",
          });
        }

        return created;
      });
    } catch (error) {
      console.error("[CREATE] Failed to create appointment/session:", error);
      continue;
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

    // Prep SMS always sends immediately. The documented 6pm queue rule
    // (tomorrow-before-6pm ⇒ hold until 6pm) needs a delayed-send mechanism
    // the prototype doesn't have.
    if (smsAction === "prep") {
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
  // Get the session's appointment ID
  const [session] = await db
    .select({ appointment_id: sessionsT.appointmentId })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId));

  if (!session?.appointment_id) {
    return { success: false, error: "Session has no appointment" };
  }

  // Normalise an updated phone number to the canonical E.164 form, mapping
  // the snake_case input to the Drizzle column names.
  const setValues: { scheduledAt?: string; phoneNumber?: string } = {};
  if (updates.scheduled_at !== undefined) setValues.scheduledAt = updates.scheduled_at;
  if (updates.phone_number !== undefined) {
    setValues.phoneNumber =
      normalisePhone(updates.phone_number) ?? updates.phone_number;
  }

  try {
    await db
      .update(appointmentsT)
      .set(setValues)
      .where(eq(appointmentsT.id, session.appointment_id));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  return { success: true };
}

/** Delete a session. Sends cancellation SMS if notification was sent. */
export async function deleteSession(sessionId: string) {
  const [session] = await db
    .select({
      id: sessionsT.id,
      notification_sent: sessionsT.notificationSent,
      appointment_id: sessionsT.appointmentId,
    })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId));

  if (!session) return { success: false, error: "Session not found" };

  if (session.notification_sent) {
    let phone: string | undefined;
    if (session.appointment_id) {
      const [appt] = await db
        .select({ phone_number: appointmentsT.phoneNumber })
        .from(appointmentsT)
        .where(eq(appointmentsT.id, session.appointment_id));
      phone = appt?.phone_number ?? undefined;
    }
    if (phone) {
      const sms = getSmsProvider();
      await sms.sendNotification(
        phone,
        "Your appointment has been cancelled. Please contact the clinic if you have questions."
      );
    }
  }

  try {
    await db.delete(sessionsT).where(eq(sessionsT.id, sessionId));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
  return { success: true };
}

/** Mark a session as no-show. */
export async function markNoShow(sessionId: string) {
  let session: { appointment_id: string | null } | undefined;
  try {
    [session] = await db
      .update(sessionsT)
      .set({ status: "done" })
      .where(eq(sessionsT.id, sessionId))
      .returning({ appointment_id: sessionsT.appointmentId });
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  // Also update appointment status
  if (session?.appointment_id) {
    await db
      .update(appointmentsT)
      .set({ status: "no_show" })
      .where(eq(appointmentsT.id, session.appointment_id));
  }

  return { success: true };
}
