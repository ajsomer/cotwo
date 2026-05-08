import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The test session uses a placeholder phone number — the OTP code is
  // surfaced via the console SMS provider (dev) and the user copies it from
  // the test session tab.
  const phone_number = "+61400000000";

  const service = createServiceClient();

  // Resolve org + location + user details
  const { data: sa } = await service
    .from("staff_assignments")
    .select("location_id, locations!inner(org_id, stripe_account_id)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!sa) return NextResponse.json({ error: "No org found." }, { status: 400 });

  type SaRow = { location_id: string; locations: { org_id: string; stripe_account_id: string | null } };
  const { location_id: locationId, locations } = sa as unknown as SaRow;
  const orgId = locations.org_id;
  const paymentsEnabled = !!locations.stripe_account_id;

  const { data: userRecord } = await service
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const fullName = userRecord?.full_name ?? user.user_metadata?.full_name ?? "Test User";
  const nameParts = fullName.trim().split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "";

  // Find the user's first room
  const { data: roomAssignment } = await service
    .from("clinician_room_assignments")
    .select("room_id")
    .eq("staff_assignment_id", (
      await service
        .from("staff_assignments")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .single()
    ).data?.id ?? "")
    .limit(1)
    .maybeSingle();

  // Fall back to first room in the location
  let roomId: string;
  if (roomAssignment?.room_id) {
    roomId = roomAssignment.room_id;
  } else {
    const { data: firstRoom } = await service
      .from("rooms")
      .select("id")
      .eq("location_id", locationId)
      .limit(1)
      .single();
    if (!firstRoom) return NextResponse.json({ error: "No rooms found." }, { status: 400 });
    roomId = firstRoom.id;
  }

  // Find default appointment type
  const { data: appointmentType } = await service
    .from("appointment_types")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", "Initial Consultation")
    .maybeSingle();

  const { data: fallbackType } = appointmentType
    ? { data: null }
    : await service
        .from("appointment_types")
        .select("id")
        .eq("org_id", orgId)
        .limit(1)
        .single();

  const appointmentTypeId = appointmentType?.id ?? fallbackType?.id;
  if (!appointmentTypeId) {
    return NextResponse.json({ error: "No appointment types found." }, { status: 400 });
  }

  // Find platform demo form (or seed it if missing — handles orgs that pre-date migration 019)
  const DEMO_SCHEMA = {
    pages: [
      {
        name: "page1",
        elements: [
          { type: "text", name: "reason_for_visit", title: "What brings you in today?", isRequired: true },
          { type: "comment", name: "duration", title: "How long has this been going on?", isRequired: true },
          { type: "signaturepad", name: "patient_signature", title: "Patient signature", isRequired: true },
        ],
      },
    ],
  };

  let demoForm: { id: string } | null = null;
  {
    const { data: existing } = await service
      .from("forms")
      .select("id, schema")
      .eq("org_id", orgId)
      .eq("is_platform_demo", true)
      .maybeSingle();

    if (existing) {
      demoForm = { id: existing.id };
      // Heal stale demo-form schemas (pre-SurveyJS shape)
      const hasPages = existing.schema && typeof existing.schema === "object" && "pages" in existing.schema;
      if (!hasPages) {
        await service.from("forms").update({ schema: DEMO_SCHEMA }).eq("id", existing.id);
      }
    } else {
      console.log("[onboarding/test-session] No demo form for org", orgId, "— seeding");
      const { data: seeded, error: seedErr } = await service
        .from("forms")
        .insert({
          org_id: orgId,
          name: "Coviu Demo Form",
          description: null,
          status: "published",
          is_platform_demo: true,
          schema: DEMO_SCHEMA,
        })
        .select("id")
        .single();

      if (seedErr || !seeded) {
        console.error("[onboarding/test-session] Failed to seed demo form:", seedErr);
        return NextResponse.json({ error: "Failed to set up demo form." }, { status: 500 });
      }
      demoForm = seeded;
    }
  }

  // 1. Create patient contact
  const { data: patient, error: patientErr } = await service
    .from("patients")
    .insert({ org_id: orgId, first_name: firstName, last_name: lastName })
    .select("id")
    .single();

  if (!patient) {
    console.error("[onboarding/test-session] patient insert failed:", patientErr);
    return NextResponse.json({ error: "Failed to create patient." }, { status: 500 });
  }

  const { error: phoneErr } = await service.from("patient_phone_numbers").insert({
    patient_id: patient.id,
    phone_number: phone_number.trim(),
    is_primary: true,
  });
  if (phoneErr) console.error("[onboarding/test-session] phone insert failed:", phoneErr);

  // 2. Create appointment (~5 minutes from now)
  const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: appointment, error: apptErr } = await service
    .from("appointments")
    .insert({
      org_id: orgId,
      location_id: locationId,
      room_id: roomId,
      appointment_type_id: appointmentTypeId,
      patient_id: patient.id,
      scheduled_at: scheduledAt,
      phone_number: phone_number.trim(),
    })
    .select("id")
    .single();

  if (!appointment) {
    console.error("[onboarding/test-session] appointment insert failed:", apptErr);
    return NextResponse.json({ error: "Failed to create appointment." }, { status: 500 });
  }

  // 3. Create session
  const entryToken = crypto.randomUUID();
  const { data: session, error: sessionErr } = await service
    .from("sessions")
    .insert({
      appointment_id: appointment.id,
      room_id: roomId,
      location_id: locationId,
      status: "queued",
      is_onboarding_demo: true,
      entry_token: entryToken,
    })
    .select("id")
    .single();

  if (!session) {
    console.error("[onboarding/test-session] session insert failed:", sessionErr);
    return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
  }

  const { error: spErr } = await service.from("session_participants").insert({
    session_id: session.id,
    patient_id: patient.id,
    role: "patient",
  });
  if (spErr) console.error("[onboarding/test-session] session_participants insert failed:", spErr);

  // 4. Create intake package journey
  const journeyToken = crypto.randomUUID();
  const { data: journey, error: journeyErr } = await service
    .from("intake_package_journeys")
    .insert({
      appointment_id: appointment.id,
      journey_token: journeyToken,
      status: "pending",
      // Always include card capture in the demo so the user sees what it
      // looks like, regardless of whether they connected Stripe at setup.
      includes_card_capture: true,
      includes_consent: false,
      form_ids: [demoForm.id],
      forms_completed: {},
    })
    .select("id, journey_token")
    .single();

  if (!journey) {
    console.error("[onboarding/test-session] journey insert failed:", journeyErr);
    return NextResponse.json({ error: "Failed to create intake journey." }, { status: 500 });
  }

  // 5. Create form assignment
  const { error: faErr } = await service.from("form_assignments").insert({
    form_id: demoForm.id,
    patient_id: patient.id,
    appointment_id: appointment.id,
    assigned_by: user.id,
  });
  if (faErr) console.error("[onboarding/test-session] form_assignments insert failed:", faErr);

  // 6. Build journey URL (SMS skipped — onboarding overlay opens it directly in a new tab)
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const journeyUrl = `${appUrl}/intake/${journey.journey_token}`;

  console.log("[onboarding/test-session] Created session:", session.id, "URL:", journeyUrl);

  // 7. Advance onboarding stage
  await service
    .from("users")
    .update({ onboarding_stage: "test_session_sent" })
    .eq("id", user.id);

  return NextResponse.json({
    session_id: session.id,
    journey_token: journey.journey_token,
    journey_url: journeyUrl,
  });
}
