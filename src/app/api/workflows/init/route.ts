import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchWorkflowsInit } from "@/lib/clinic/fetchers/workflows";
import { requireStaffOrgAccess } from "@/lib/auth/staff-access";

// GET /api/workflows/init?org_id=xxx
// Returns everything the workflows page needs — both pre- and
// post-appointment templates/blocks plus published forms — in ONE payload.
// fetchWorkflowsInit already computes both directions, so a single call
// avoids the previous two-request cold load that discarded half of each.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const service = createServiceClient();
  const access = await requireStaffOrgAccess(service, orgId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status },
    );
  }

  try {
    const [workflows, formsRes] = await Promise.all([
      fetchWorkflowsInit(orgId),
      service
        .from("forms")
        .select("id, name, status")
        .eq("org_id", orgId)
        .eq("status", "published")
        .eq("is_platform_demo", false),
    ]);

    const forms = (formsRes.data ?? []).map((f) => ({ id: f.id, name: f.name }));

    return NextResponse.json({
      appointment_types: workflows.appointmentTypes,
      outcome_pathways: workflows.outcomePathways,
      forms,
      pre_templates: workflows.preWorkflowTemplates,
      pre_blocks: workflows.preWorkflowBlocks,
      post_templates: workflows.postWorkflowTemplates,
      post_blocks: workflows.postWorkflowBlocks,
    });
  } catch (err) {
    console.error("[WORKFLOWS INIT] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
