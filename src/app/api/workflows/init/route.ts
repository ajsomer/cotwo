import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchWorkflowsInit } from "@/lib/clinic/fetchers/workflows";

// GET /api/workflows/init?org_id=xxx&direction=pre_appointment|post_appointment
// Returns data the workflows page needs for the requested direction.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  const direction = request.nextUrl.searchParams.get("direction") ?? "pre_appointment";

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  try {
    const [workflows, formsRes] = await Promise.all([
      fetchWorkflowsInit(orgId),
      createServiceClient()
        .from("forms")
        .select("id, name, status")
        .eq("org_id", orgId)
        .eq("status", "published"),
    ]);

    const forms = (formsRes.data ?? []).map((f) => ({ id: f.id, name: f.name }));

    if (direction === "pre_appointment") {
      return NextResponse.json({
        appointment_types: workflows.appointmentTypes,
        outcome_pathways: [],
        forms,
        templates: workflows.preWorkflowTemplates,
        blocks: workflows.preWorkflowBlocks,
      });
    }

    return NextResponse.json({
      appointment_types: [],
      outcome_pathways: workflows.outcomePathways,
      forms,
      templates: workflows.postWorkflowTemplates,
      blocks: workflows.postWorkflowBlocks,
    });
  } catch (err) {
    console.error("[WORKFLOWS INIT] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
