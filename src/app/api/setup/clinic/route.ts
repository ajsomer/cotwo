import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateSlug } from "@/lib/utils/slug";
import { seedDefaultWorkflows } from "@/lib/workflows/seed-defaults";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Verify auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, address, logo_url } = body as {
    name?: string;
    address?: string;
    logo_url?: string | null;
  };

  if (!name?.trim() || !address?.trim()) {
    return NextResponse.json(
      { error: "Clinic name and address are required." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Generate unique slug
  let slug = generateSlug(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing } = await service
      .from("organisations")
      .select("id")
      .eq("slug", slug)
      .limit(1)
      .single();

    if (!existing) break;
    slug = generateSlug(name); // Retry with new random suffix
  }

  console.log("[setup/clinic] Creating org for user:", user.id, "slug:", slug);

  // Create organisation
  const { data: org, error: orgError } = await service
    .from("organisations")
    .insert({
      name: name.trim(),
      slug,
      logo_url: logo_url ?? null,
      tier: "complete",
    })
    .select("id")
    .single();

  if (orgError || !org) {
    console.log("[setup/clinic] org error:", orgError?.message);
    return NextResponse.json(
      { error: "Failed to create organisation: " + orgError?.message },
      { status: 500 }
    );
  }
  console.log("[setup/clinic] org created:", org.id);

  // Create location (inherits clinic name)
  const { data: location, error: locError } = await service
    .from("locations")
    .insert({
      org_id: org.id,
      name: name.trim(),
      address: address.trim(),
    })
    .select("id")
    .single();

  if (locError || !location) {
    console.log("[setup/clinic] location error:", locError?.message);
    return NextResponse.json(
      { error: "Failed to create location: " + locError?.message },
      { status: 500 }
    );
  }
  console.log("[setup/clinic] location created:", location.id);

  // Create staff assignment (clinic owner)
  const { error: saError } = await service.from("staff_assignments").insert({
    user_id: user.id,
    location_id: location.id,
    role: "clinic_owner",
    employment_type: "full_time",
  });

  if (saError) {
    console.log("[setup/clinic] staff_assignment error:", saError.message);
    return NextResponse.json(
      { error: "Failed to create staff assignment." },
      { status: 500 }
    );
  }

  // Seed default workflow templates for the new org
  try {
    await seedDefaultWorkflows(org.id);
  } catch (err) {
    console.error("[setup/clinic] Workflow seed failed (non-blocking):", err);
  }

  console.log("[setup/clinic] Success. org:", org.id, "location:", location.id);
  return NextResponse.json({ org_id: org.id, location_id: location.id });
}
