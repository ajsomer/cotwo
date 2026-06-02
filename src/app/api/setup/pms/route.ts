import { db } from "@/lib/db";
import {
  pmsConnections,
  appointmentTypes,
  forms as formsT,
  rooms as roomsT,
  users as usersT,
  staffAssignments,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveDefaultStaffOrg, getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { seedDefaultWorkflows } from "@/lib/workflows/seed-defaults";
import { NextResponse, type NextRequest } from "next/server";

const GENTU_APPOINTMENT_TYPES = [
  { name: "Initial Consultation", modality: "telehealth", duration_minutes: 60, default_fee_cents: 18000 },
  { name: "Follow-up Consultation", modality: "telehealth", duration_minutes: 30, default_fee_cents: 12000 },
  { name: "Telehealth Consultation", modality: "telehealth", duration_minutes: 45, default_fee_cents: 15000 },
  { name: "Review Appointment", modality: "in_person", duration_minutes: 30, default_fee_cents: 12000 },
  { name: "Brief Check-in", modality: "in_person", duration_minutes: 15, default_fee_cents: 6000 },
  { name: "Assessment", modality: "telehealth", duration_minutes: 60, default_fee_cents: 20000 },
  { name: "Group Session", modality: "in_person", duration_minutes: 90, default_fee_cents: 8000 },
  { name: "Home Visit", modality: "in_person", duration_minutes: 60, default_fee_cents: 22000 },
  { name: "Intake Assessment", modality: "telehealth", duration_minutes: 60, default_fee_cents: 20000 },
  { name: "Discharge Planning", modality: "in_person", duration_minutes: 30, default_fee_cents: 12000 },
  { name: "Case Conference", modality: "telehealth", duration_minutes: 45, default_fee_cents: 0 },
  { name: "Supervision", modality: "telehealth", duration_minutes: 60, default_fee_cents: 0 },
];

const GENTU_FORMS = [
  { name: "New Patient Intake", description: "Comprehensive new patient intake form" },
  { name: "Mental Health Assessment (K10)", description: "Kessler Psychological Distress Scale" },
  { name: "Patient Satisfaction Survey", description: "Post-appointment satisfaction survey" },
];

const GENTU_ROOMS = [
  "Sarah Chen",
  "Marcus Webb",
  "Kate Murray",
];

const GENTU_CLINICIANS = [
  { full_name: "Sarah Chen", email: "sarah.chen@gentu-demo.coviu.com" },
  { full_name: "Marcus Webb", email: "marcus.webb@gentu-demo.coviu.com" },
  { full_name: "Kate Murray", email: "kate.murray@gentu-demo.coviu.com" },
  { full_name: "Amy Tran", email: "amy.tran@gentu-demo.coviu.com" },
];

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { provider, skipped } = body as { provider: string | null; skipped: boolean };

  // Setup flow: no scope is supplied, so resolve the user's default org.
  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) return NextResponse.json({ error: "No org found." }, { status: 400 });
  const { orgId, locationId } = resolved;

  if (provider === "gentu") {
    await seedGentuData(orgId, locationId);
    await db
      .insert(pmsConnections)
      .values({
        orgId,
        provider: "gentu",
        status: "connected",
        importedData: { clinicians: 4, appointment_types: 12, rooms: 3 },
      })
      .onConflictDoUpdate({
        target: pmsConnections.orgId,
        set: {
          provider: "gentu",
          status: "connected",
          importedData: { clinicians: 4, appointment_types: 12, rooms: 3 },
        },
      });
    try { await seedDefaultWorkflows(orgId); } catch (e) { console.error("[setup/pms] workflow re-seed failed:", e); }
  } else {
    await db
      .insert(pmsConnections)
      .values({
        orgId,
        provider: (provider ?? "cliniko") as typeof pmsConnections.$inferInsert.provider,
        status: "skipped",
      })
      .onConflictDoUpdate({
        target: pmsConnections.orgId,
        set: {
          provider: (provider ?? "cliniko") as typeof pmsConnections.$inferInsert.provider,
          status: "skipped",
        },
      });
  }

  return NextResponse.json({ ok: true });
}

async function seedGentuData(orgId: string, locationId: string) {
  // Existing names (one round trip each rather than per-record)
  const [existingTypes, existingForms, existingRooms] = await Promise.all([
    db.select({ name: appointmentTypes.name }).from(appointmentTypes).where(eq(appointmentTypes.orgId, orgId)),
    db.select({ name: formsT.name }).from(formsT).where(eq(formsT.orgId, orgId)),
    db.select({ name: roomsT.name }).from(roomsT).where(eq(roomsT.locationId, locationId)),
  ]);

  const typeNames = new Set((existingTypes ?? []).map((r) => r.name));
  const formNames = new Set((existingForms ?? []).map((r) => r.name));
  const roomNames = new Set((existingRooms ?? []).map((r) => r.name));

  const newTypes = GENTU_APPOINTMENT_TYPES.filter((t) => !typeNames.has(t.name));
  const newForms = GENTU_FORMS.filter((f) => !formNames.has(f.name));
  const newRooms = GENTU_ROOMS.filter((r) => !roomNames.has(r));

  // Bulk inserts in parallel
  await Promise.all([
    newTypes.length
      ? db.insert(appointmentTypes).values(
          newTypes.map((t) => ({
            orgId,
            name: t.name,
            modality: t.modality as typeof appointmentTypes.$inferInsert.modality,
            durationMinutes: t.duration_minutes,
            defaultFeeCents: t.default_fee_cents,
          }))
        )
      : Promise.resolve(),
    newForms.length
      ? db.insert(formsT).values(
          newForms.map((f) => ({
            orgId,
            name: f.name,
            description: f.description,
            status: "published",
            isPlatformDemo: false,
            schema: {},
          }))
        )
      : Promise.resolve(),
    newRooms.length
      ? db.insert(roomsT).values(
          newRooms.map((name) => ({ locationId, name, roomType: "clinical" as const }))
        )
      : Promise.resolve(),
  ]);

  // Demo clinicians. These are seeded providers who appear on the run sheet but
  // never log in, so we insert public.users rows directly rather than creating
  // Neon Auth accounts. (Prototype: no auth identity needed for demo staff.)
  await Promise.all(
    GENTU_CLINICIANS.map(async (clinician) => {
      const [upserted] = await db
        .insert(usersT)
        .values({ email: clinician.email, fullName: clinician.full_name })
        .onConflictDoUpdate({
          target: usersT.email,
          set: { fullName: clinician.full_name },
        })
        .returning({ id: usersT.id });

      const userId = upserted?.id;
      if (!userId) return;

      const [existingSa] = await db
        .select({ id: staffAssignments.id })
        .from(staffAssignments)
        .where(eq(staffAssignments.userId, userId))
        .limit(1);

      if (!existingSa) {
        await db.insert(staffAssignments).values({
          userId,
          locationId,
          role: "clinician",
          employmentType: "full_time",
        });
      }
    })
  );
}
