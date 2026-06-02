import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import {
  staffAssignments,
  locations as locationsT,
  users as usersT,
  clinicianRoomAssignments,
  rooms as roomsT,
  appointmentTypes,
  forms as formsT,
  patients as patientsT,
  patientPhoneNumbers,
  appointments as appointmentsT,
  sessions as sessionsT,
  sessionParticipants,
  intakePackageJourneys,
  formAssignments,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The test session uses a placeholder phone number — the OTP code is
  // surfaced via the console SMS provider (dev) and the user copies it from
  // the test session tab.
  const phone_number = "+61400000000";

  // Resolve org + location + user details
  const [sa] = await db
    .select({
      staff_assignment_id: staffAssignments.id,
      location_id: staffAssignments.locationId,
      org_id: locationsT.orgId,
    })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!sa) return NextResponse.json({ error: "No org found." }, { status: 400 });

  const locationId = sa.location_id;
  const orgId = sa.org_id;

  const [userRecord] = await db
    .select({ full_name: usersT.fullName })
    .from(usersT)
    .where(eq(usersT.id, userId))
    .limit(1);

  const fullName = userRecord?.full_name ?? "Test User";
  const nameParts = fullName.trim().split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "";

  // Find the user's first room
  const [roomAssignment] = await db
    .select({ room_id: clinicianRoomAssignments.roomId })
    .from(clinicianRoomAssignments)
    .where(eq(clinicianRoomAssignments.staffAssignmentId, sa.staff_assignment_id))
    .limit(1);

  // Fall back to first room in the location
  let roomId: string;
  if (roomAssignment?.room_id) {
    roomId = roomAssignment.room_id;
  } else {
    const [firstRoom] = await db
      .select({ id: roomsT.id })
      .from(roomsT)
      .where(eq(roomsT.locationId, locationId))
      .limit(1);
    if (!firstRoom) return NextResponse.json({ error: "No rooms found." }, { status: 400 });
    roomId = firstRoom.id;
  }

  // Find default appointment type
  const [appointmentType] = await db
    .select({ id: appointmentTypes.id })
    .from(appointmentTypes)
    .where(
      and(
        eq(appointmentTypes.orgId, orgId),
        eq(appointmentTypes.name, "Initial Consultation"),
      ),
    )
    .limit(1);

  const fallbackType = appointmentType
    ? null
    : (
        await db
          .select({ id: appointmentTypes.id })
          .from(appointmentTypes)
          .where(eq(appointmentTypes.orgId, orgId))
          .limit(1)
      )[0] ?? null;

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
    const [existing] = await db
      .select({ id: formsT.id, schema: formsT.schema })
      .from(formsT)
      .where(and(eq(formsT.orgId, orgId), eq(formsT.isPlatformDemo, true)))
      .limit(1);

    if (existing) {
      demoForm = { id: existing.id };
      // Heal stale demo-form schemas (pre-SurveyJS shape)
      const schema = existing.schema as Record<string, unknown> | null;
      const hasPages = schema && typeof schema === "object" && "pages" in schema;
      if (!hasPages) {
        await db.update(formsT).set({ schema: DEMO_SCHEMA }).where(eq(formsT.id, existing.id));
      }
    } else {
      try {
        const [seeded] = await db
          .insert(formsT)
          .values({
            orgId,
            name: "Coviu Demo Form",
            description: null,
            status: "published",
            isPlatformDemo: true,
            schema: DEMO_SCHEMA,
          })
          .returning({ id: formsT.id });
        demoForm = seeded;
      } catch (seedErr) {
        console.error("[onboarding/test-session] Failed to seed demo form:", seedErr);
        return NextResponse.json({ error: "Failed to set up demo form." }, { status: 500 });
      }
    }
  }

  // 1. Create patient contact
  let patient: { id: string };
  try {
    [patient] = await db
      .insert(patientsT)
      .values({ orgId, firstName, lastName })
      .returning({ id: patientsT.id });
  } catch (patientErr) {
    console.error("[onboarding/test-session] patient insert failed:", patientErr);
    return NextResponse.json({ error: "Failed to create patient." }, { status: 500 });
  }

  try {
    await db.insert(patientPhoneNumbers).values({
      patientId: patient.id,
      phoneNumber: phone_number.trim(),
      isPrimary: true,
    });
  } catch (phoneErr) {
    console.error("[onboarding/test-session] phone insert failed:", phoneErr);
  }

  // 2. Create appointment (~5 minutes from now)
  const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  let appointment: { id: string };
  try {
    [appointment] = await db
      .insert(appointmentsT)
      .values({
        orgId,
        locationId,
        roomId,
        appointmentTypeId,
        patientId: patient.id,
        scheduledAt,
        phoneNumber: phone_number.trim(),
      })
      .returning({ id: appointmentsT.id });
  } catch (apptErr) {
    console.error("[onboarding/test-session] appointment insert failed:", apptErr);
    return NextResponse.json({ error: "Failed to create appointment." }, { status: 500 });
  }

  // 3. Create session
  const entryToken = crypto.randomUUID();
  let session: { id: string };
  try {
    [session] = await db
      .insert(sessionsT)
      .values({
        appointmentId: appointment.id,
        roomId,
        locationId,
        status: "queued",
        isOnboardingDemo: true,
        entryToken,
      })
      .returning({ id: sessionsT.id });
  } catch (sessionErr) {
    console.error("[onboarding/test-session] session insert failed:", sessionErr);
    return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
  }

  try {
    await db.insert(sessionParticipants).values({
      sessionId: session.id,
      patientId: patient.id,
      role: "patient",
    });
  } catch (spErr) {
    console.error("[onboarding/test-session] session_participants insert failed:", spErr);
  }

  // 4. Create intake package journey
  const journeyToken = crypto.randomUUID();
  let journey: { id: string; journey_token: string };
  try {
    [journey] = await db
      .insert(intakePackageJourneys)
      .values({
        appointmentId: appointment.id,
        journeyToken,
        status: "pending",
        // Always include card capture in the demo so the user sees what it
        // looks like, regardless of whether they connected Stripe at setup.
        includesCardCapture: true,
        includesConsent: false,
        formIds: [demoForm.id],
        formsCompleted: {},
      })
      .returning({ id: intakePackageJourneys.id, journey_token: intakePackageJourneys.journeyToken });
  } catch (journeyErr) {
    console.error("[onboarding/test-session] journey insert failed:", journeyErr);
    return NextResponse.json({ error: "Failed to create intake journey." }, { status: 500 });
  }

  // 5. Create form assignment
  try {
    await db.insert(formAssignments).values({
      formId: demoForm.id,
      patientId: patient.id,
      appointmentId: appointment.id,
    });
  } catch (faErr) {
    console.error("[onboarding/test-session] form_assignments insert failed:", faErr);
  }

  // 6. Build journey URL (SMS skipped — onboarding overlay opens it directly in a new tab)
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const journeyUrl = `${appUrl}/intake/${journey.journey_token}`;

  // 7. Advance onboarding stage
  await db
    .update(usersT)
    .set({ onboardingStage: "test_session_sent" })
    .where(eq(usersT.id, userId));

  return NextResponse.json({
    session_id: session.id,
    journey_token: journey.journey_token,
    journey_url: journeyUrl,
  });
}
