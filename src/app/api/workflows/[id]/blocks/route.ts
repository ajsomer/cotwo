import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  requireStaffCanAccessWorkflowTemplate,
  assertFormsInOrg,
} from "@/lib/auth/staff-access";

/**
 * Collect every form id a block references — top-level form_id,
 * config.form_id, config.form_ids (intake_package), and a
 * form_not_completed precondition's form_id — so they can be org-validated
 * before the SECURITY DEFINER RPC writes them.
 */
function collectBlockFormIds(block: BlockInput): string[] {
  const ids: string[] = [];
  if (block.form_id) ids.push(block.form_id);

  const config = block.config as Record<string, unknown> | null;
  if (config) {
    if (typeof config.form_id === "string") ids.push(config.form_id);
    if (Array.isArray(config.form_ids)) {
      for (const f of config.form_ids) if (typeof f === "string") ids.push(f);
    }
  }

  const pre = block.precondition as Record<string, unknown> | null;
  if (pre && pre.type === "form_not_completed" && typeof pre.form_id === "string") {
    ids.push(pre.form_id);
  }

  return ids;
}

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
//
// The delete → update → insert → recalculate sequence runs inside the
// `save_workflow_blocks` Postgres RPC (migration 022) so it's a single
// transaction — a failure partway rolls the whole save back, rather than
// leaving blocks/actions half-applied.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: templateId } = await params;

  try {
    const service = createServiceClient();

    // AUTH: authenticate the caller and verify they staff the template's org.
    const access = await requireStaffCanAccessWorkflowTemplate(
      service,
      templateId
    );
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status }
      );
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

    // Every form id referenced by a block (top-level, config, or precondition)
    // must belong to the template's org — the RPC writes them directly with
    // service-role privileges, so a cross-org form id can't be trusted.
    const referencedFormIds = blocks.flatMap(collectBlockFormIds);
    if (!(await assertFormsInOrg(service, referencedFormIds, access.orgId))) {
      return NextResponse.json(
        { error: "A referenced form does not belong to this organisation" },
        { status: 400 }
      );
    }

    // Atomic save + in-flight recalculation (single transaction).
    const { data: result, error: rpcError } = await service.rpc(
      "save_workflow_blocks",
      {
        p_template_id: templateId,
        p_blocks: blocks,
        p_deleted_ids: deleted_ids,
      }
    );

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const summary = (result ?? {}) as {
      deleted?: number;
      inserted?: number;
      retimed?: number;
      in_flight_recalculated?: number;
    };

    // Return full updated block set for UI reconciliation
    const { data: allBlocks } = await service
      .from("workflow_action_blocks")
      .select("*")
      .eq("template_id", templateId)
      .order("sort_order");

    return NextResponse.json({
      success: true,
      blocks: allBlocks ?? [],
      in_flight_recalculated: summary.in_flight_recalculated ?? 0,
    });
  } catch (err) {
    console.error("[WORKFLOWS] PATCH blocks error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
