import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { seedDefaultWorkflows } from "@/lib/workflows/seed-defaults";

// POST /api/workflows/seed
// Seeds default workflow templates for the authenticated user's org.
// Idempotent — skips templates that already exist by name.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve the user's org
    const service = createServiceClient();
    const { data: assignment } = await service
      .from("staff_assignments")
      .select("locations!inner(org_id)")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!assignment) {
      return NextResponse.json(
        { error: "No staff assignment found" },
        { status: 404 }
      );
    }

    const orgId = (assignment.locations as unknown as { org_id: string }).org_id;

    await seedDefaultWorkflows(orgId);

    return NextResponse.json({ success: true, org_id: orgId });
  } catch (err) {
    console.error("[WORKFLOW SEED] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
