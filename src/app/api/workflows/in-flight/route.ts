import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaffCanAccessWorkflowTemplate } from "@/lib/auth/staff-access";

// GET /api/workflows/in-flight?template_id=xxx
// Returns count of active appointment_workflow_runs for a given template.
// Used by the UI to determine whether the mid-flight edit warning is needed.
export async function GET(request: NextRequest) {
  const templateId = request.nextUrl.searchParams.get("template_id");
  if (!templateId) {
    return NextResponse.json(
      { error: "template_id required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const access = await requireStaffCanAccessWorkflowTemplate(supabase, templateId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status },
    );
  }

  try {
    const { count, error } = await supabase
      .from("appointment_workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_template_id", templateId)
      .eq("status", "active");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ in_flight_count: count ?? 0 });
  } catch (err) {
    console.error("[WORKFLOWS] in-flight count error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
