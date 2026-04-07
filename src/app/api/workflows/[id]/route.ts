import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/workflows/[id]
// Returns a single workflow template with all its action blocks.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = createServiceClient();

    const { data: template, error: templateError } = await supabase
      .from("workflow_templates")
      .select("*")
      .eq("id", id)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: "Workflow template not found" },
        { status: 404 }
      );
    }

    const { data: blocks, error: blocksError } = await supabase
      .from("workflow_action_blocks")
      .select("*")
      .eq("template_id", id)
      .order("sort_order");

    if (blocksError) {
      return NextResponse.json(
        { error: blocksError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ template, blocks: blocks ?? [] });
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

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updateable fields provided" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { error } = await supabase
      .from("workflow_templates")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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

  try {
    const supabase = createServiceClient();

    // Check for active in-flight runs
    const { data: activeRuns } = await supabase
      .from("appointment_workflow_runs")
      .select("id")
      .eq("workflow_template_id", id)
      .eq("status", "active");

    const inFlightCount = activeRuns?.length ?? 0;

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
      const runIds = activeRuns!.map((r) => r.id);

      // Cancel scheduled actions on those runs
      await supabase
        .from("appointment_actions")
        .update({ status: "cancelled" })
        .in("workflow_run_id", runIds)
        .eq("status", "scheduled");

      // Cancel the runs themselves
      await supabase
        .from("appointment_workflow_runs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .in("id", runIds);

      console.log(
        `[WORKFLOWS] Force-deleted template ${id}: cancelled ${inFlightCount} in-flight runs`
      );
    }

    // Delete the template (cascades to workflow_action_blocks and type_workflow_links)
    const { error } = await supabase
      .from("workflow_templates")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[WORKFLOWS] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
