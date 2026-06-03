import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import {
  organisations as organisationsT,
  locations as locationsT,
  staffAssignments,
  appointmentTypes,
  forms as formsT,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { generateSlug } from "@/lib/utils/slug";
import { seedDefaultWorkflows } from "@/lib/workflows/seed-defaults";
import { newPatientIntakeSchema, defaultFormSchema } from "@/lib/survey/identity-page";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, logo_url } = body as { name?: string; logo_url?: string | null };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Clinic name is required." }, { status: 400 });
  }

  let slug = generateSlug(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [existing] = await db
      .select({ id: organisationsT.id })
      .from(organisationsT)
      .where(eq(organisationsT.slug, slug))
      .limit(1);
    if (!existing) break;
    slug = generateSlug(name);
  }

  let org: { id: string };
  try {
    [org] = await db
      .insert(organisationsT)
      .values({ name: name.trim(), slug, logoUrl: logo_url ?? null, tier: "complete" })
      .returning({ id: organisationsT.id });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create organisation: " + (err as Error).message },
      { status: 500 }
    );
  }

  let location: { id: string };
  try {
    [location] = await db
      .insert(locationsT)
      .values({ orgId: org.id, name: name.trim(), address: null })
      .returning({ id: locationsT.id });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create location: " + (err as Error).message },
      { status: 500 }
    );
  }

  try {
    await db.insert(staffAssignments).values({
      userId,
      locationId: location.id,
      role: "clinic_owner",
      employmentType: "full_time",
    });
  } catch {
    return NextResponse.json({ error: "Failed to create staff assignment." }, { status: 500 });
  }

  // Seed no-PMS floor: default appointment type + forms
  await seedNoPmsFloor(org.id);

  // Seed platform demo form (hidden from clinic UI)
  await seedPlatformDemoForm(org.id);

  // Seed default workflow templates
  try {
    await seedDefaultWorkflows(org.id);
  } catch (err) {
    console.error("[setup/clinic] Workflow seed failed (non-blocking):", err);
  }

  return NextResponse.json({ org_id: org.id, location_id: location.id });
}

async function seedNoPmsFloor(orgId: string): Promise<void> {
  // Default appointment type
  const [existing] = await db
    .select({ id: appointmentTypes.id })
    .from(appointmentTypes)
    .where(
      and(
        eq(appointmentTypes.orgId, orgId),
        eq(appointmentTypes.name, "Initial Consultation"),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(appointmentTypes).values({
      orgId,
      name: "Initial Consultation",
      modality: "telehealth",
      durationMinutes: 30,
      defaultFeeCents: 0,
    });
  }

  // Default forms (referenced by workflow seeder by name). "New Patient Intake"
  // ships with real fields so it's not empty when a patient opens it; the others
  // are shells the clinic builds out. All carry the locked identity page.
  const defaultForms = [
    {
      name: "New Patient Intake",
      description: "Standard new patient intake form",
      schema: newPatientIntakeSchema(),
    },
    {
      name: "Mental Health Assessment (K10)",
      description: "Kessler Psychological Distress Scale",
      schema: defaultFormSchema(),
    },
    {
      name: "Patient Satisfaction Survey",
      description: "Post-appointment satisfaction survey",
      schema: defaultFormSchema(),
    },
  ];

  for (const form of defaultForms) {
    const [existingForm] = await db
      .select({ id: formsT.id })
      .from(formsT)
      .where(and(eq(formsT.orgId, orgId), eq(formsT.name, form.name)))
      .limit(1);

    if (!existingForm) {
      await db.insert(formsT).values({
        orgId,
        name: form.name,
        description: form.description,
        status: "published",
        isPlatformDemo: false,
        schema: form.schema,
      });
    }
  }
}

async function seedPlatformDemoForm(orgId: string): Promise<void> {
  const [existing] = await db
    .select({ id: formsT.id })
    .from(formsT)
    .where(and(eq(formsT.orgId, orgId), eq(formsT.isPlatformDemo, true)))
    .limit(1);

  if (existing) return;

  await db.insert(formsT).values({
    orgId,
    name: "Coviu Demo Form",
    description: null,
    status: "published",
    isPlatformDemo: true,
    schema: DEMO_FORM_SCHEMA,
  });
}

// SurveyJS-compatible schema for the onboarding demo form
const DEMO_FORM_SCHEMA = {
  pages: [
    {
      name: "page1",
      elements: [
        {
          type: "text",
          name: "reason_for_visit",
          title: "What brings you in today?",
          isRequired: true,
        },
        {
          type: "comment",
          name: "duration",
          title: "How long has this been going on?",
          isRequired: true,
        },
        {
          type: "signaturepad",
          name: "patient_signature",
          title: "Patient signature",
          isRequired: true,
        },
      ],
    },
  ],
};
