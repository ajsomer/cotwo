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
    // Clean workflow data (order matters: actions → runs → blocks → links → pathways → templates)
    await supabase.from("appointment_actions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("appointment_workflow_runs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("workflow_action_blocks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("type_workflow_links").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("outcome_pathways").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("workflow_templates").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Upsert appointment types for this org (spec: 5 default types)
    await supabase.from("appointment_types").upsert([
      { id: "00000000-0000-0000-0000-000000003001", org_id: ORG_ID, name: "Initial Consultation", modality: "telehealth", duration_minutes: 60, default_fee_cents: 22000, source: "coviu" },
      { id: "00000000-0000-0000-0000-000000003002", org_id: ORG_ID, name: "Follow-up Consultation", modality: "telehealth", duration_minutes: 45, default_fee_cents: 18000, source: "coviu" },
      { id: "00000000-0000-0000-0000-000000003003", org_id: ORG_ID, name: "Review Appointment", modality: "in_person", duration_minutes: 30, default_fee_cents: 15000, source: "coviu" },
      { id: "00000000-0000-0000-0000-000000003004", org_id: ORG_ID, name: "Telehealth Consultation", modality: "telehealth", duration_minutes: 45, default_fee_cents: 18000, source: "coviu" },
      { id: "00000000-0000-0000-0000-000000003005", org_id: ORG_ID, name: "Brief Check-in", modality: "telehealth", duration_minutes: 15, default_fee_cents: 9000, source: "coviu" },
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

    // ========================================================================
    // Workflow seed data: templates, action blocks, links, outcome pathways
    // ========================================================================

    // Look up form IDs by name in this org (forms were created separately)
    const { data: orgForms } = await supabase
      .from("forms")
      .select("id, name")
      .eq("org_id", ORG_ID)
      .eq("status", "published");

    const formByName = new Map((orgForms ?? []).map((f) => [f.name, f.id]));
    const intakeFormId = formByName.get("New Patient Intake") ?? null;
    const k10FormId = formByName.get("Mental Health Assessment (K10)") ?? null;
    const satisfactionFormId = formByName.get("Patient Satisfaction Survey") ?? null;

    // --- Pre-appointment workflow templates ---

    const PRE_TEMPLATE_1 = "00000000-0000-0000-0000-000000008001"; // Standard new patient intake
    const PRE_TEMPLATE_2 = "00000000-0000-0000-0000-000000008002"; // Returning patient quick check
    const PRE_TEMPLATE_3 = "00000000-0000-0000-0000-000000008003"; // Telehealth-specific setup
    const PRE_TEMPLATE_4 = "00000000-0000-0000-0000-000000008004"; // Minimal reminder only

    await supabase.from("workflow_templates").upsert([
      { id: PRE_TEMPLATE_1, org_id: ORG_ID, name: "Standard New Patient Intake", direction: "pre_appointment", status: "published" },
      { id: PRE_TEMPLATE_2, org_id: ORG_ID, name: "Returning Patient Quick Check", direction: "pre_appointment", status: "published" },
      { id: PRE_TEMPLATE_3, org_id: ORG_ID, name: "Telehealth-specific Setup", direction: "pre_appointment", status: "published" },
      { id: PRE_TEMPLATE_4, org_id: ORG_ID, name: "Minimal Reminder Only", direction: "pre_appointment", status: "published" },
    ]);

    // Pre-workflow action blocks
    await supabase.from("workflow_action_blocks").upsert([
      // Template 1: Standard New Patient Intake (4 actions)
      { id: "00000000-0000-0000-0000-00000000a001", template_id: PRE_TEMPLATE_1, action_type: "deliver_form", offset_minutes: 20160, offset_direction: "before", form_id: intakeFormId, config: {}, precondition: null, sort_order: 0 },
      { id: "00000000-0000-0000-0000-00000000a002", template_id: PRE_TEMPLATE_1, action_type: "send_reminder", offset_minutes: 4320, offset_direction: "before", config: { message: "Hi {first_name}, just a reminder you have an appointment with {clinic_name} in 3 days. Please complete your intake form if you haven't already." }, precondition: { type: "form_not_completed", form_id: intakeFormId ?? "" }, sort_order: 1 },
      { id: "00000000-0000-0000-0000-00000000a003", template_id: PRE_TEMPLATE_1, action_type: "capture_card", offset_minutes: 2880, offset_direction: "before", config: {}, precondition: { type: "card_not_on_file" }, sort_order: 2 },
      { id: "00000000-0000-0000-0000-00000000a004", template_id: PRE_TEMPLATE_1, action_type: "send_reminder", offset_minutes: 1440, offset_direction: "before", config: { message: "Hi {first_name}, your appointment with {clinician_name} at {clinic_name} is tomorrow at {appointment_time}. See you then!" }, precondition: null, sort_order: 3 },

      // Template 2: Returning Patient Quick Check (2 actions)
      { id: "00000000-0000-0000-0000-00000000a005", template_id: PRE_TEMPLATE_2, action_type: "send_reminder", offset_minutes: 2880, offset_direction: "before", config: { message: "Hi {first_name}, just a reminder about your appointment with {clinic_name} in 2 days at {appointment_time}." }, precondition: null, sort_order: 0 },
      { id: "00000000-0000-0000-0000-00000000a006", template_id: PRE_TEMPLATE_2, action_type: "capture_card", offset_minutes: 1440, offset_direction: "before", config: {}, precondition: { type: "card_not_on_file" }, sort_order: 1 },

      // Template 3: Telehealth-specific Setup (2 actions)
      { id: "00000000-0000-0000-0000-00000000a007", template_id: PRE_TEMPLATE_3, action_type: "verify_contact", offset_minutes: 10080, offset_direction: "before", config: {}, precondition: { type: "contact_not_verified" }, sort_order: 0 },
      { id: "00000000-0000-0000-0000-00000000a008", template_id: PRE_TEMPLATE_3, action_type: "send_reminder", offset_minutes: 1440, offset_direction: "before", config: { message: "Hi {first_name}, your telehealth appointment with {clinician_name} is tomorrow at {appointment_time}. Make sure you're in a quiet spot with good internet." }, precondition: null, sort_order: 1 },

      // Template 4: Minimal Reminder Only (1 action)
      { id: "00000000-0000-0000-0000-00000000a009", template_id: PRE_TEMPLATE_4, action_type: "send_reminder", offset_minutes: 1440, offset_direction: "before", config: { message: "Hi {first_name}, quick reminder about your check-in with {clinic_name} tomorrow at {appointment_time}." }, precondition: null, sort_order: 0 },
    ]);

    // Link pre-workflows to appointment types
    await supabase.from("type_workflow_links").upsert([
      { id: "00000000-0000-0000-0000-000000009001", appointment_type_id: "00000000-0000-0000-0000-000000003001", workflow_template_id: PRE_TEMPLATE_1, direction: "pre_appointment" },
      { id: "00000000-0000-0000-0000-000000009002", appointment_type_id: "00000000-0000-0000-0000-000000003002", workflow_template_id: PRE_TEMPLATE_2, direction: "pre_appointment" },
      { id: "00000000-0000-0000-0000-000000009003", appointment_type_id: "00000000-0000-0000-0000-000000003003", workflow_template_id: PRE_TEMPLATE_2, direction: "pre_appointment" },
      { id: "00000000-0000-0000-0000-000000009004", appointment_type_id: "00000000-0000-0000-0000-000000003004", workflow_template_id: PRE_TEMPLATE_3, direction: "pre_appointment" },
      { id: "00000000-0000-0000-0000-000000009005", appointment_type_id: "00000000-0000-0000-0000-000000003005", workflow_template_id: PRE_TEMPLATE_4, direction: "pre_appointment" },
    ]);

    // --- Post-appointment workflow templates ---

    const POST_TEMPLATE_1 = "00000000-0000-0000-0000-000000008005"; // Discharge with home exercises
    const POST_TEMPLATE_2 = "00000000-0000-0000-0000-000000008006"; // Continue treatment
    const POST_TEMPLATE_3 = "00000000-0000-0000-0000-000000008007"; // Discharge complete

    await supabase.from("workflow_templates").upsert([
      { id: POST_TEMPLATE_1, org_id: ORG_ID, name: "Discharge with Home Exercises", direction: "post_appointment", status: "published" },
      { id: POST_TEMPLATE_2, org_id: ORG_ID, name: "Continue Treatment", direction: "post_appointment", status: "published" },
      { id: POST_TEMPLATE_3, org_id: ORG_ID, name: "Discharge Complete", direction: "post_appointment", status: "published" },
    ]);

    // Post-workflow action blocks (editor only in v1, execution deferred to v2)
    await supabase.from("workflow_action_blocks").upsert([
      // Template 5: Discharge with Home Exercises (4 actions)
      { id: "00000000-0000-0000-0000-00000000a010", template_id: POST_TEMPLATE_1, action_type: "send_sms", offset_minutes: 0, offset_direction: "after", config: { message: "Hi {first_name}, thanks for your appointment today with {clinician_name}. We'll send your exercise program shortly." }, precondition: null, sort_order: 0 },
      { id: "00000000-0000-0000-0000-00000000a011", template_id: POST_TEMPLATE_1, action_type: "send_file", offset_minutes: 1440, offset_direction: "after", config: { message: "Hi {first_name}, here's your home exercise program as discussed." }, precondition: null, sort_order: 1 },
      { id: "00000000-0000-0000-0000-00000000a012", template_id: POST_TEMPLATE_1, action_type: "deliver_form", offset_minutes: 20160, offset_direction: "after", form_id: satisfactionFormId, config: {}, precondition: null, sort_order: 2 },
      { id: "00000000-0000-0000-0000-00000000a013", template_id: POST_TEMPLATE_1, action_type: "send_rebooking_nudge", offset_minutes: 43200, offset_direction: "after", config: { message: "Hi {first_name}, it's been a month since your last appointment with {clinic_name}. Would you like to book a follow-up?" }, precondition: { type: "no_future_appointment" }, sort_order: 3 },

      // Template 6: Continue Treatment (2 actions)
      { id: "00000000-0000-0000-0000-00000000a014", template_id: POST_TEMPLATE_2, action_type: "send_sms", offset_minutes: 0, offset_direction: "after", config: { message: "Hi {first_name}, thanks for your appointment today. We'll be in touch about your next visit." }, precondition: null, sort_order: 0 },
      { id: "00000000-0000-0000-0000-00000000a015", template_id: POST_TEMPLATE_2, action_type: "send_rebooking_nudge", offset_minutes: 10080, offset_direction: "after", config: { message: "Hi {first_name}, time to book your next appointment with {clinic_name}." }, precondition: { type: "no_future_appointment" }, sort_order: 1 },

      // Template 7: Discharge Complete (2 actions)
      { id: "00000000-0000-0000-0000-00000000a016", template_id: POST_TEMPLATE_3, action_type: "send_sms", offset_minutes: 0, offset_direction: "after", config: { message: "Hi {first_name}, your treatment with {clinic_name} is now complete. If you need anything in the future, don't hesitate to get in touch." }, precondition: null, sort_order: 0 },
      { id: "00000000-0000-0000-0000-00000000a017", template_id: POST_TEMPLATE_3, action_type: "deliver_form", offset_minutes: 20160, offset_direction: "after", form_id: k10FormId, config: {}, precondition: null, sort_order: 1 },
    ]);

    // Outcome pathways linked to post-workflow templates
    await supabase.from("outcome_pathways").upsert([
      { id: "00000000-0000-0000-0000-000000007001", org_id: ORG_ID, name: "Discharge with Home Exercises", description: "Send exercise program, PROMs at 2 weeks, rebooking nudge at 30 days", workflow_template_id: POST_TEMPLATE_1 },
      { id: "00000000-0000-0000-0000-000000007002", org_id: ORG_ID, name: "Continue Treatment", description: "Send summary and rebooking nudge in 7 days if no appointment booked", workflow_template_id: POST_TEMPLATE_2 },
      { id: "00000000-0000-0000-0000-000000007003", org_id: ORG_ID, name: "Discharge Complete", description: "Send discharge summary and outcome measures at 2 weeks", workflow_template_id: POST_TEMPLATE_3 },
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
