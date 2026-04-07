import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

interface BlockInput {
  id?: string;
  action_type: string;
  offset_minutes: number;
  offset_direction: string;
  config: Record<string, unknown>;
  precondition: Record<string, unknown> | null;
  form_id?: string | null;
  sort_order: number;
}

interface BulkSaveInput {
  blocks: BlockInput[];
  deleted_ids: string[];
}

// PATCH /api/workflows/[id]/blocks
// Bulk save action blocks with transactional in-flight recalculation.
// See plan pseudocode for full algorithm.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: templateId } = await params;

  try {
    const service = createServiceClient();

    // AUTH: verify org ownership (service role bypasses RLS)
    const authSupabase = await createClient();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the template and verify it exists
    const { data: template } = await service
      .from("workflow_templates")
      .select("id, org_id, direction")
      .eq("id", templateId)
      .single();

    if (!template) {
      return NextResponse.json(
        { error: "Workflow template not found" },
        { status: 404 }
      );
    }

    // Verify the user belongs to the template's org
    const { data: staffAssignment } = await service
      .from("staff_assignments")
      .select("id, locations!inner(org_id)")
      .eq("user_id", user.id)
      .limit(10);

    const userOrgIds = (staffAssignment ?? []).map(
      (sa) => (sa.locations as unknown as { org_id: string }).org_id
    );

    if (!userOrgIds.includes(template.org_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse and validate input
    const body: BulkSaveInput = await request.json();
    const { blocks, deleted_ids } = body;

    if (!Array.isArray(blocks) || !Array.isArray(deleted_ids)) {
      return NextResponse.json(
        { error: "blocks and deleted_ids arrays required" },
        { status: 400 }
      );
    }

    for (const block of blocks) {
      if (block.offset_minutes < 0) {
        return NextResponse.json(
          { error: "offset_minutes must be >= 0" },
          { status: 400 }
        );
      }
      if (block.action_type === "deliver_form" && !block.form_id) {
        return NextResponse.json(
          { error: "deliver_form actions require a form_id" },
          { status: 400 }
        );
      }
    }

    // Fetch current state
    const { data: existingBlocks } = await service
      .from("workflow_action_blocks")
      .select("*")
      .eq("template_id", templateId);

    const existingBlockIds = new Set(
      (existingBlocks ?? []).map((b) => b.id)
    );

    // Categorise changes
    const blocksToDelete = deleted_ids.filter((id) =>
      existingBlockIds.has(id)
    );
    const blocksToUpdate = blocks.filter(
      (b) => b.id && existingBlockIds.has(b.id)
    );
    const blocksToInsert = blocks.filter((b) => !b.id);
    const blocksRetimed = blocksToUpdate.filter((b) => {
      const existing = (existingBlocks ?? []).find((e) => e.id === b.id);
      return existing && existing.offset_minutes !== b.offset_minutes;
    });

    // --- BEGIN TRANSACTION (sequential operations via service client) ---

    // 1. Delete removed blocks
    if (blocksToDelete.length > 0) {
      const { error: delError } = await service
        .from("workflow_action_blocks")
        .delete()
        .in("id", blocksToDelete)
        .eq("template_id", templateId);

      if (delError) {
        return NextResponse.json({ error: delError.message }, { status: 500 });
      }
    }

    // 2. Update existing blocks
    for (const block of blocksToUpdate) {
      const { error: updError } = await service
        .from("workflow_action_blocks")
        .update({
          action_type: block.action_type as Database["public"]["Enums"]["action_type"],
          offset_minutes: block.offset_minutes,
          offset_direction: block.offset_direction,
          config: block.config,
          precondition: block.precondition,
          form_id: block.form_id ?? null,
          sort_order: block.sort_order,
        })
        .eq("id", block.id!)
        .eq("template_id", templateId);

      if (updError) {
        return NextResponse.json({ error: updError.message }, { status: 500 });
      }
    }

    // 3. Insert new blocks — capture returned IDs
    const insertedBlocks: Array<{ id: string; offset_minutes: number }> = [];
    for (const block of blocksToInsert) {
      const { data: inserted, error: insError } = await service
        .from("workflow_action_blocks")
        .insert({
          template_id: templateId,
          action_type: block.action_type as Database["public"]["Enums"]["action_type"],
          offset_minutes: block.offset_minutes,
          offset_direction: block.offset_direction,
          config: block.config,
          precondition: block.precondition,
          form_id: block.form_id ?? null,
          sort_order: block.sort_order,
        })
        .select("id, offset_minutes")
        .single();

      if (insError) {
        return NextResponse.json({ error: insError.message }, { status: 500 });
      }

      insertedBlocks.push(inserted);
    }

    // 4. Recalculate in-flight runs
    const { data: activeRuns } = await service
      .from("appointment_workflow_runs")
      .select("id, appointment_id, direction")
      .eq("workflow_template_id", templateId)
      .eq("status", "active");

    // Fetch appointment scheduled_at for active runs
    let runDetails: Array<{
      runId: string;
      appointmentId: string;
      direction: string;
      scheduledAt: string;
    }> = [];

    if (activeRuns && activeRuns.length > 0) {
      const appointmentIds = activeRuns.map((r) => r.appointment_id);
      const { data: appointments } = await service
        .from("appointments")
        .select("id, scheduled_at")
        .in("id", appointmentIds);

      const apptMap = new Map(
        (appointments ?? []).map((a) => [a.id, a.scheduled_at])
      );

      runDetails = activeRuns.map((r) => ({
        runId: r.id,
        appointmentId: r.appointment_id,
        direction: r.direction,
        scheduledAt: apptMap.get(r.appointment_id) ?? "",
      }));
    }

    if (runDetails.length > 0) {
      for (const run of runDetails) {
        // 4a. Cancel actions for deleted blocks
        if (blocksToDelete.length > 0) {
          await service
            .from("appointment_actions")
            .update({ status: "cancelled" })
            .eq("workflow_run_id", run.runId)
            .in("action_block_id", blocksToDelete)
            .eq("status", "scheduled");
        }

        // 4b. Add actions for newly inserted blocks
        for (const newBlock of insertedBlocks) {
          const scheduledFor = calculateScheduledFor(
            run.scheduledAt,
            newBlock.offset_minutes,
            run.direction
          );

          await service.from("appointment_actions").insert({
            appointment_id: run.appointmentId,
            action_block_id: newBlock.id,
            workflow_run_id: run.runId,
            status: "scheduled",
            scheduled_for: scheduledFor,
          });
        }

        // 4c. Retime actions for retimed blocks
        for (const retimed of blocksRetimed) {
          const newScheduledFor = calculateScheduledFor(
            run.scheduledAt,
            retimed.offset_minutes,
            run.direction
          );

          await service
            .from("appointment_actions")
            .update({ scheduled_for: newScheduledFor })
            .eq("workflow_run_id", run.runId)
            .eq("action_block_id", retimed.id!)
            .eq("status", "scheduled");
        }
      }
    }

    // --- END TRANSACTION ---

    console.log(
      `[WORKFLOWS] Saved template ${templateId}: ${blocksToUpdate.length} updated, ${blocksToDelete.length} deleted, ${insertedBlocks.length} inserted. ${runDetails.length} in-flight runs recalculated.`
    );

    // Return full updated block set for UI reconciliation
    const { data: allBlocks } = await service
      .from("workflow_action_blocks")
      .select("*")
      .eq("template_id", templateId)
      .order("sort_order");

    return NextResponse.json({
      success: true,
      blocks: allBlocks ?? [],
      in_flight_recalculated: runDetails.length,
    });
  } catch (err) {
    console.error("[WORKFLOWS] PATCH blocks error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Calculate scheduled_for from appointment time and action offset.
// Pre-appointment: subtract offset. Post-appointment: add offset.
function calculateScheduledFor(
  appointmentScheduledAt: string,
  offsetMinutes: number,
  direction: string
): string {
  const apptTime = new Date(appointmentScheduledAt);
  const offsetMs = offsetMinutes * 60 * 1000;

  if (direction === "pre_appointment") {
    return new Date(apptTime.getTime() - offsetMs).toISOString();
  }
  // post_appointment
  return new Date(apptTime.getTime() + offsetMs).toISOString();
}

// Type import needed for cast in update calls
import type { Database } from "@/lib/supabase/types";
