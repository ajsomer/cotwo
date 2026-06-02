import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveDefaultStaffOrg } from "@/lib/auth/staff-access";
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

    // Setup flow: no scope is supplied, so resolve the user's default org.
    const resolved = await resolveDefaultStaffOrg(user.id);
    if (!resolved) {
      return NextResponse.json(
        { error: "No staff assignment found" },
        { status: 404 }
      );
    }

    const { orgId } = resolved;

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
