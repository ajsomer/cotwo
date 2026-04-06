"use server";

import { createClient as createServerClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Seeds the database with demo data for the run sheet.
 * Uses the service role client to bypass RLS.
 *
 * Resolves the authenticated user's org and location dynamically.
 * Does NOT create or modify rooms, org, location, users, or staff assignments.
 * Only populates session-related data (patients, appointments, sessions, etc.)
 * for whatever rooms already exist at the user's location.
 */
/**
 * Removes all session-related data from the database.
 * Preserves rooms, org, location, users, staff assignments, and appointment types.
 */
export async function nukeSessions() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { success: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" };
  }

  const supabase = createServerClient(supabaseUrl, serviceRoleKey);

  try {
    await supabase.from("session_participants").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("appointments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("payment_methods").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("patient_phone_numbers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("patients").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("phone_verifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return { success: true };
  } catch (err) {
    console.error("[NUKE] Failed:", err);
    return { success: false, error: String(err) };
  }
}

export async function seedDemoData() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { success: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" };
  }

  // Get the authenticated user's org and location
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const supabase = createServerClient(supabaseUrl, serviceRoleKey);

  // Resolve the user's staff assignment to find their org and location
  const { data: assignment, error: assignmentError } = await supabase
    .from("staff_assignments")
    .select(`
      location_id,
      locations!inner (
        id,
        org_id,
        timezone,
        organisations!inner (
          id,
          timezone
        )
      )
    `)
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (assignmentError || !assignment) {
    return { success: false, error: "No staff assignment found. Complete clinic setup first." };
  }

  const loc = assignment.locations as unknown as Record<string, unknown>;
  const org = loc.organisations as unknown as Record<string, unknown>;
  const LOCATION_ID = loc.id as string;
  const ORG_ID = org.id as string;
  const TIMEZONE = (loc.timezone as string) ?? "Australia/Sydney";

  try {
    // Clean existing session data (preserves rooms, org, location, staff)
    await supabase.from("session_participants").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("appointments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("payment_methods").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("patient_phone_numbers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("patients").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("outcome_pathways").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Upsert appointment types for this org
    await supabase.from("appointment_types").upsert([
      { id: "00000000-0000-0000-0000-000000003001", org_id: ORG_ID, name: "Initial Consultation", modality: "telehealth", duration_minutes: 45, default_fee_cents: 15000 },
      { id: "00000000-0000-0000-0000-000000003002", org_id: ORG_ID, name: "Follow-up", modality: "telehealth", duration_minutes: 20, default_fee_cents: 8500 },
      { id: "00000000-0000-0000-0000-000000003003", org_id: ORG_ID, name: "Physio Assessment", modality: "in_person", duration_minutes: 60, default_fee_cents: 12000 },
      { id: "00000000-0000-0000-0000-000000003004", org_id: ORG_ID, name: "Mental Health Review", modality: "telehealth", duration_minutes: 50, default_fee_cents: 22000 },
    ]);

    const patientData = [
      { id: "00000000-0000-0000-0000-000000004001", org_id: ORG_ID, first_name: "Emily", last_name: "Chen", date_of_birth: "1992-03-15" },
      { id: "00000000-0000-0000-0000-000000004002", org_id: ORG_ID, first_name: "Marcus", last_name: "Williams", date_of_birth: "1985-07-22" },
      { id: "00000000-0000-0000-0000-000000004003", org_id: ORG_ID, first_name: "Sophie", last_name: "Taylor", date_of_birth: "1998-11-08" },
      { id: "00000000-0000-0000-0000-000000004004", org_id: ORG_ID, first_name: "David", last_name: "Park", date_of_birth: "1976-01-30" },
      { id: "00000000-0000-0000-0000-000000004005", org_id: ORG_ID, first_name: "Olivia", last_name: "Brown", date_of_birth: "2001-06-14" },
      { id: "00000000-0000-0000-0000-000000004006", org_id: ORG_ID, first_name: "James", last_name: "Morrison", date_of_birth: "1990-09-25" },
      { id: "00000000-0000-0000-0000-000000004007", org_id: ORG_ID, first_name: "Anika", last_name: "Patel", date_of_birth: "1988-04-12" },
      { id: "00000000-0000-0000-0000-000000004008", org_id: ORG_ID, first_name: "Ryan", last_name: "Hughes", date_of_birth: "1995-12-03" },
    ];
    await supabase.from("patients").upsert(patientData);

    await supabase.from("patient_phone_numbers").upsert(
      patientData.map((p, i) => ({
        id: `00000000-0000-0000-0000-00000000b0${(i + 1).toString().padStart(2, "0")}`,
        patient_id: p.id,
        phone_number: `+6141234500${i + 1}`,
        is_primary: true,
      }))
    );

    await supabase.from("payment_methods").upsert([
      { id: "00000000-0000-0000-0000-00000000c001", patient_id: "00000000-0000-0000-0000-000000004001", stripe_payment_method_id: "pm_test_001", card_last_four: "4242", card_brand: "Visa", card_expiry: "12/27", is_default: true },
      { id: "00000000-0000-0000-0000-00000000c002", patient_id: "00000000-0000-0000-0000-000000004002", stripe_payment_method_id: "pm_test_002", card_last_four: "5555", card_brand: "Mastercard", card_expiry: "08/26", is_default: true },
      { id: "00000000-0000-0000-0000-00000000c003", patient_id: "00000000-0000-0000-0000-000000004004", stripe_payment_method_id: "pm_test_004", card_last_four: "1234", card_brand: "Visa", card_expiry: "03/28", is_default: true },
    ]);

    await supabase.from("outcome_pathways").upsert([
      { id: "00000000-0000-0000-0000-000000007001", org_id: ORG_ID, name: "Standard Follow-up", description: "Send follow-up resources and rebooking link in 7 days" },
      { id: "00000000-0000-0000-0000-000000007002", org_id: ORG_ID, name: "PROMs Collection", description: "Send outcome measures at 2 weeks and 6 weeks post-appointment" },
      { id: "00000000-0000-0000-0000-000000007003", org_id: ORG_ID, name: "Discharge", description: "No follow-up required. Send discharge summary." },
    ]);

    // ========================================================================
    // Read existing rooms at the user's location and generate time-aware sessions
    // ========================================================================
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_type, sort_order")
      .eq("location_id", LOCATION_ID)
      .order("sort_order", { ascending: true });

    if (!rooms || rooms.length === 0) {
      return { success: true, warning: "No rooms found — sessions not seeded. Create rooms in Settings first." };
    }

    // Find clinicians assigned to this location for realistic session data
    const { data: clinicians } = await supabase
      .from("staff_assignments")
      .select("user_id")
      .eq("location_id", LOCATION_ID)
      .in("role", ["clinician", "clinic_owner"]);

    const clinicianIds = (clinicians ?? []).map((c) => c.user_id as string);
    if (clinicianIds.length === 0) {
      clinicianIds.push(user.id); // fallback to the current user
    }

    // Determine current time in the clinic's timezone
    const now = new Date();
    const localTimeStr = now.toLocaleString("en-AU", { timeZone: TIMEZONE, hour12: false });
    const timeParts = localTimeStr.split(", ")[1]?.split(":") ?? [];
    const localHour = parseInt(timeParts[0] ?? "12", 10);
    const localMinute = parseInt(timeParts[1] ?? "0", 10);

    // Clinic day: 8am to 5pm. Slot duration = 30 min.
    const CLINIC_START = 8; // 8:00 AM
    const CLINIC_END = 17;  // 5:00 PM
    const SLOT_MINUTES = 30;
    const totalSlots = (CLINIC_END - CLINIC_START) * 60 / SLOT_MINUTES; // 18 slots

    // How many minutes into the clinic day are we?
    const minutesIntoClinincDay = Math.max(0, (localHour - CLINIC_START) * 60 + localMinute);
    const currentSlotIdx = Math.min(Math.floor(minutesIntoClinincDay / SLOT_MINUTES), totalSlots - 1);

    // Before clinic hours: show a full day of upcoming. After: show a full day of done.
    const beforeClinic = localHour < CLINIC_START;
    const afterClinic = localHour >= CLINIC_END;

    // Helper: get the absolute time for a given slot index
    function slotTime(slotIdx: number): Date {
      const d = new Date(now);
      // Set to today's date in local tz by offsetting
      const offsetMs = minutesIntoClinincDay * 60_000;
      const clinicStartMs = d.getTime() - offsetMs; // time at clinic open
      return new Date(clinicStartMs + slotIdx * SLOT_MINUTES * 60_000);
    }

    const appointmentTypeIds = [
      "00000000-0000-0000-0000-000000003001",
      "00000000-0000-0000-0000-000000003002",
      "00000000-0000-0000-0000-000000003003",
      "00000000-0000-0000-0000-000000003004",
    ];

    // Assign each room ~4-6 slots spread across the day
    // Each room gets: past slots (done), one outstanding action, current/near slot, future slots (upcoming)
    let sessionCounter = 0;
    const pad = (n: number) => n.toString().padStart(3, "0");

    for (let roomIdx = 0; roomIdx < rooms.length; roomIdx++) {
      const room = rooms[roomIdx];
      const clinicianId = clinicianIds[roomIdx % clinicianIds.length];

      // Spread slots for this room: every N slots, offset by room index
      const roomSlots: number[] = [];
      const spacing = Math.max(2, Math.floor(totalSlots / 5)); // ~5 appointments per room
      for (let s = roomIdx % spacing; s < totalSlots; s += spacing) {
        roomSlots.push(s);
      }

      // Track whether this room has used its one outstanding action
      let hasOutstandingAction = false;

      for (const slotIdx of roomSlots) {
        sessionCounter++;
        const patientId = patientData[(sessionCounter - 1) % patientData.length].id;
        const typeId = appointmentTypeIds[sessionCounter % appointmentTypeIds.length];
        const phone = `+6141234500${((sessionCounter - 1) % patientData.length) + 1}`;
        const scheduledAt = slotTime(slotIdx);
        const suffix = pad(sessionCounter);
        const apptId = `00000000-0000-0000-0000-000000005${suffix}`;
        const sessionId = `00000000-0000-0000-0000-000000006${suffix}`;
        const participantId = `00000000-0000-0000-0000-00000000e${suffix}`;

        let status: string;
        let notificationSent = true;
        let patientArrived = false;
        let patientArrivedAt: string | null = null;
        let sessionStartedAt: string | null = null;
        let sessionEndedAt: string | null = null;

        if (beforeClinic) {
          // Before 8am: everything is upcoming/queued
          status = "queued";
          notificationSent = slotIdx < 4; // first few have been notified
          patientArrived = false;
        } else if (afterClinic) {
          // After 5pm: everything is done
          status = "done";
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 5 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
          sessionEndedAt = new Date(scheduledAt.getTime() + 25 * 60_000).toISOString();
        } else if (slotIdx < currentSlotIdx - 1) {
          // Well in the past: done
          status = "done";
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 5 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
          sessionEndedAt = new Date(scheduledAt.getTime() + 25 * 60_000).toISOString();
        } else if (slotIdx === currentSlotIdx - 1 && !hasOutstandingAction) {
          // Just finished — needs processing (one per room)
          status = "complete";
          hasOutstandingAction = true;
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 5 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
          sessionEndedAt = new Date(scheduledAt.getTime() + 25 * 60_000).toISOString();
        } else if (slotIdx === currentSlotIdx) {
          // Current slot: in session
          status = "in_session";
          patientArrived = true;
          patientArrivedAt = new Date(scheduledAt.getTime() - 3 * 60_000).toISOString();
          sessionStartedAt = scheduledAt.toISOString();
        } else if (slotIdx === currentSlotIdx + 1) {
          // Next slot: upcoming, notified
          status = "queued";
          notificationSent = true;
          patientArrived = false;
        } else {
          // Further future: queued, not yet notified
          status = "queued";
          notificationSent = false;
          patientArrived = false;
        }

        // Insert appointment
        await supabase.from("appointments").upsert({
          id: apptId,
          org_id: ORG_ID,
          patient_id: patientId,
          clinician_id: clinicianId,
          appointment_type_id: typeId,
          room_id: room.id,
          location_id: LOCATION_ID,
          scheduled_at: scheduledAt.toISOString(),
          phone_number: phone,
        });

        // Insert session
        await supabase.from("sessions").upsert({
          id: sessionId,
          appointment_id: apptId,
          room_id: room.id,
          location_id: LOCATION_ID,
          status,
          notification_sent: notificationSent,
          notification_sent_at: notificationSent ? new Date(scheduledAt.getTime() - 120 * 60_000).toISOString() : null,
          patient_arrived: patientArrived,
          patient_arrived_at: patientArrivedAt,
          session_started_at: sessionStartedAt,
          session_ended_at: sessionEndedAt,
          created_at: now.toISOString(),
        });

        // Insert participant
        await supabase.from("session_participants").upsert({
          id: participantId,
          session_id: sessionId,
          patient_id: patientId,
        });
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[SEED] Failed:", err);
    return { success: false, error: String(err) };
  }
}
