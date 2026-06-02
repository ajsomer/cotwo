import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateSlug } from "@/lib/utils/slug";
import { seedDefaultWorkflows } from "@/lib/workflows/seed-defaults";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, logo_url } = body as { name?: string; logo_url?: string | null };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Clinic name is required." }, { status: 400 });
  }

  const service = createServiceClient();

  let slug = generateSlug(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing } = await service
      .from("organisations")
      .select("id")
      .eq("slug", slug)
      .limit(1)
      .single();
    if (!existing) break;
    slug = generateSlug(name);
  }

  const { data: org, error: orgError } = await service
    .from("organisations")
    .insert({ name: name.trim(), slug, logo_url: logo_url ?? null, tier: "complete" })
    .select("id")
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: "Failed to create organisation: " + orgError?.message },
      { status: 500 }
    );
  }

  const { data: location, error: locError } = await service
    .from("locations")
    .insert({ org_id: org.id, name: name.trim(), address: null })
    .select("id")
    .single();

  if (locError || !location) {
    return NextResponse.json(
      { error: "Failed to create location: " + locError?.message },
      { status: 500 }
    );
  }

  const { error: saError } = await service.from("staff_assignments").insert({
    user_id: user.id,
    location_id: location.id,
    role: "clinic_owner",
    employment_type: "full_time",
  });

  if (saError) {
    return NextResponse.json({ error: "Failed to create staff assignment." }, { status: 500 });
  }

  // Seed no-PMS floor: default appointment type + forms
  await seedNoPmsFloor(service, org.id);

  // Seed platform demo form (hidden from clinic UI)
  await seedPlatformDemoForm(service, org.id);

  // Seed default workflow templates
  try {
    await seedDefaultWorkflows(org.id);
  } catch (err) {
    console.error("[setup/clinic] Workflow seed failed (non-blocking):", err);
  }

  return NextResponse.json({ org_id: org.id, location_id: location.id });
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function seedNoPmsFloor(service: ServiceClient, orgId: string): Promise<void> {
  // Default appointment type
  const { data: existing } = await service
    .from("appointment_types")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", "Initial Consultation")
    .maybeSingle();

  if (!existing) {
    await service.from("appointment_types").insert({
      org_id: orgId,
      name: "Initial Consultation",
      modality: "telehealth",
      duration_minutes: 30,
      default_fee_cents: 0,
    });
  }

  // Default forms (referenced by workflow seeder by name)
  const defaultForms = [
    { name: "New Patient Intake", description: "Standard new patient intake form" },
    { name: "Mental Health Assessment (K10)", description: "Kessler Psychological Distress Scale" },
    { name: "Patient Satisfaction Survey", description: "Post-appointment satisfaction survey" },
  ];

  for (const form of defaultForms) {
    const { data: existingForm } = await service
      .from("forms")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", form.name)
      .maybeSingle();

    if (!existingForm) {
      await service.from("forms").insert({
        org_id: orgId,
        name: form.name,
        description: form.description,
        status: "published",
        is_platform_demo: false,
        schema: {},
      });
    }
  }
}

async function seedPlatformDemoForm(service: ServiceClient, orgId: string): Promise<void> {
  const { data: existing } = await service
    .from("forms")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_platform_demo", true)
    .maybeSingle();

  if (existing) return;

  await service.from("forms").insert({
    org_id: orgId,
    name: "Coviu Demo Form",
    description: null,
    status: "published",
    is_platform_demo: true,
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
