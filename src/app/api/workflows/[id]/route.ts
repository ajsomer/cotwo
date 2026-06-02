import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  workflowTemplates,
  workflowActionBlocks,
  appointmentWorkflowRuns,
  appointmentActions,
} from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireStaffCanAccessWorkflowTemplate } from "@/lib/auth/staff-access";

// Column projections that alias Drizzle's camelCase fields back to the
// snake_case shape the UI consumes (byte-identical to the old supabase `*`).
const templateColumns = {
  id: workflowTemplates.id,
  org_id: workflowTemplates.orgId,
  name: workflowTemplates.name,
  description: workflowTemplates.description,
  direction: workflowTemplates.direction,
  status: workflowTemplates.status,
  terminal_type: workflowTemplates.terminalType,
  at_risk_after_days: workflowTemplates.atRiskAfterDays,
  overdue_after_days: workflowTemplates.overdueAfterDays,
  created_at: workflowTemplates.createdAt,
  updated_at: workflowTemplates.updatedAt,
};

const blockColumns = {
  id: workflowActionBlocks.id,
  template_id: workflowActionBlocks.templateId,
  action_type: workflowActionBlocks.actionType,
  offset_minutes: workflowActionBlocks.offsetMinutes,
  offset_direction: workflowActionBlocks.offsetDirection,
  modality_filter: workflowActionBlocks.modalityFilter,
  form_id: workflowActionBlocks.formId,
  config: workflowActionBlocks.config,
  sort_order: workflowActionBlocks.sortOrder,
  precondition: workflowActionBlocks.precondition,
  parent_action_block_id: workflowActionBlocks.parentActionBlockId,
  created_at: workflowActionBlocks.createdAt,
  updated_at: workflowActionBlocks.updatedAt,
};

// GET /api/workflows/[id]
// Returns a single workflow template with all its action blocks.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireStaffCanAccessWorkflowTemplate(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status },
    );
  }

  try {
    const [template] = await db
      .select(templateColumns)
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, id))
      .limit(1);

    if (!template) {
      return NextResponse.json(
        { error: "Workflow template not found" },
        { status: 404 }
      );
    }

    const blocks = await db
      .select(blockColumns)
      .from(workflowActionBlocks)
      .where(eq(workflowActionBlocks.templateId, id))
      .orderBy(asc(workflowActionBlocks.sortOrder));

    return NextResponse.json({ template, blocks });
  } catch (err) {
    console.error("[WORKFLOWS] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/workflows/[id]
// Updates workflow template metadata (name, description, status).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description, status } = body;

    const updates: Partial<{
      name: string;
      description: string;
      status: typeof workflowTemplates.$inferInsert.status;
    }> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updateable fields provided" },
        { status: 400 }
      );
    }

    const access = await requireStaffCanAccessWorkflowTemplate(id);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status },
      );
    }

    await db
      .update(workflowTemplates)
      .set(updates)
      .where(eq(workflowTemplates.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[WORKFLOWS] PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/workflows/[id]?force=true
// Deletes a workflow template.
//
// Without ?force: returns 409 if active runs exist, with the in-flight count.
// With ?force=true: cancels all active runs and their scheduled actions, then
// deletes the template. Cascade deletes type_workflow_links and action blocks.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const force = request.nextUrl.searchParams.get("force") === "true";

  const access = await requireStaffCanAccessWorkflowTemplate(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status },
    );
  }

  try {
    // Check for active in-flight runs
    const activeRuns = await db
      .select({ id: appointmentWorkflowRuns.id })
      .from(appointmentWorkflowRuns)
      .where(
        and(
          eq(appointmentWorkflowRuns.workflowTemplateId, id),
          eq(appointmentWorkflowRuns.status, "active")
        )
      );

    const inFlightCount = activeRuns.length;

    if (inFlightCount > 0 && !force) {
      return NextResponse.json(
        {
          error: `${inFlightCount} appointments are currently using this workflow. Pass ?force=true to cancel them and delete.`,
          in_flight_count: inFlightCount,
        },
        { status: 409 }
      );
    }

    // If force: cancel active runs and their scheduled actions
    if (inFlightCount > 0) {
      const runIds = activeRuns.map((r) => r.id);

      // Cancel scheduled actions on those runs
      await db
        .update(appointmentActions)
        .set({ status: "cancelled" })
        .where(
          and(
            inArray(appointmentActions.workflowRunId, runIds),
            eq(appointmentActions.status, "scheduled")
          )
        );

      // Cancel the runs themselves
      await db
        .update(appointmentWorkflowRuns)
        .set({ status: "cancelled", completedAt: new Date().toISOString() })
        .where(inArray(appointmentWorkflowRuns.id, runIds));
    }

    // Delete the template (cascades to workflow_action_blocks and type_workflow_links)
    await db.delete(workflowTemplates).where(eq(workflowTemplates.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[WORKFLOWS] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
