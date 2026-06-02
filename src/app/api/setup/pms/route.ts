import { createServiceClient } from "@/lib/supabase/service";
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

  const service = createServiceClient();

  // Setup flow: no scope is supplied, so resolve the user's default org.
  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) return NextResponse.json({ error: "No org found." }, { status: 400 });
  const { orgId, locationId } = resolved;

  if (provider === "gentu") {
    await seedGentuData(service, orgId, locationId);
    await service.from("pms_connections").upsert(
      { org_id: orgId, provider: "gentu", status: "connected", imported_data: { clinicians: 4, appointment_types: 12, rooms: 3 } },
      { onConflict: "org_id" }
    );
    try { await seedDefaultWorkflows(orgId); } catch (e) { console.error("[setup/pms] workflow re-seed failed:", e); }
  } else {
    await service.from("pms_connections").upsert(
      { org_id: orgId, provider: provider ?? "cliniko", status: "skipped" },
      { onConflict: "org_id" }
    );
  }

  return NextResponse.json({ ok: true });
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function seedGentuData(service: ServiceClient, orgId: string, locationId: string) {
  // Existing names (one round trip each rather than per-record)
  const [{ data: existingTypes }, { data: existingForms }, { data: existingRooms }] =
    await Promise.all([
      service.from("appointment_types").select("name").eq("org_id", orgId),
      service.from("forms").select("name").eq("org_id", orgId),
      service.from("rooms").select("name").eq("location_id", locationId),
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
      ? service.from("appointment_types").insert(newTypes.map((t) => ({ org_id: orgId, ...t })))
      : Promise.resolve(),
    newForms.length
      ? service.from("forms").insert(
          newForms.map((f) => ({
            org_id: orgId,
            name: f.name,
            description: f.description,
            status: "published",
            is_platform_demo: false,
            schema: {},
          }))
        )
      : Promise.resolve(),
    newRooms.length
      ? service
          .from("rooms")
          .insert(newRooms.map((name) => ({ location_id: locationId, name, room_type: "clinical" })))
      : Promise.resolve(),
  ]);

  // Clinicians — auth.admin.createUser must be sequential per call but we can run all 4 in parallel
  await Promise.all(
    GENTU_CLINICIANS.map(async (clinician) => {
      const { data: authUser, error } = await service.auth.admin.createUser({
        email: clinician.email,
        password: crypto.randomUUID(),
        user_metadata: { full_name: clinician.full_name },
        email_confirm: true,
      });

      // If user already exists, look them up by email so we can still assign them
      let userId = authUser?.user?.id;
      if (!userId && error) {
        const { data: existing } = await service
          .from("users")
          .select("id")
          .eq("email", clinician.email)
          .maybeSingle();
        userId = existing?.id;
      }
      if (!userId) return;

      const { data: existingSa } = await service
        .from("staff_assignments")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!existingSa) {
        await service.from("staff_assignments").insert({
          user_id: userId,
          location_id: locationId,
          role: "clinician",
          employment_type: "full_time",
        });
      }
    })
  );
}
