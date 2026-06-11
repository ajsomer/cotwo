import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointmentWorkflowRuns } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireStaffCanAccessWorkflowTemplate } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

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

  const access = await requireStaffCanAccessWorkflowTemplate(templateId);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentWorkflowRuns)
      .where(
        and(
          eq(appointmentWorkflowRuns.workflowTemplateId, templateId),
          eq(appointmentWorkflowRuns.status, "active")
        )
      );

    return NextResponse.json({ in_flight_count: row?.count ?? 0 });
  } catch (err) {
    console.error("[WORKFLOWS] in-flight count error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
