import { NextResponse } from "next/server";
import { resolveDefaultStaffOrg, getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { seedDefaultWorkflows } from "@/lib/workflows/seed-defaults";

// POST /api/workflows/seed
// Seeds default workflow templates for the authenticated user's org.
// Idempotent — skips templates that already exist by name.
export async function POST() {
  try {
    const userId = await getAuthenticatedUserId();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Setup flow: no scope is supplied, so resolve the user's default org.
    const resolved = await resolveDefaultStaffOrg(userId);
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
