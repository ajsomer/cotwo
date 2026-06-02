import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  requireStaffOrgAccess,
  assertFormsInOrg,
} from "@/lib/auth/staff-access";

/** Collect every form id a pathway block references (form_id + config). */
function collectPathwayBlockFormIds(block: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof block.form_id === "string") ids.push(block.form_id);
  const config = block.config as Record<string, unknown> | null;
  if (config) {
    if (typeof config.form_id === "string") ids.push(config.form_id);
    if (Array.isArray(config.form_ids)) {
      for (const f of config.form_ids) if (typeof f === "string") ids.push(f);
    }
  }
  return ids;
}

/**
 * POST /api/outcome-pathways/configure
 *
 * Atomic save for an outcome pathway and its action blocks.
 * Wraps the configure_outcome_pathway RPC function.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_id, pathway_id, name, description, blocks } = body;

    if (!org_id) {
      return NextResponse.json({ error: "org_id is required" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const access = await requireStaffOrgAccess(supabase, org_id);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status }
      );
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const blockList = Array.isArray(blocks) ? blocks : [];
    if (blockList.length === 0) {
      return NextResponse.json(
        { error: "At least one action block is required" },
        { status: 400 }
      );
    }

    // Form ids in the blocks are written by the RPC with service-role
    // privileges — prove they belong to this org first.
    const referencedFormIds = blockList.flatMap((b: Record<string, unknown>) =>
      collectPathwayBlockFormIds(b)
    );
    if (!(await assertFormsInOrg(supabase, referencedFormIds, access.orgId))) {
      return NextResponse.json(
        { error: "A referenced form does not belong to this organisation" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("configure_outcome_pathway", {
      p_org_id: org_id,
      p_pathway_id: pathway_id ?? null,
      p_name: name.trim(),
      p_description: description ?? null,
      p_blocks: blockList.map((b: Record<string, unknown>, i: number) => ({
        id: b.id ?? null,
        action_type: b.action_type,
        offset_minutes: b.offset_minutes ?? 0,
        form_id: b.form_id ?? null,
        config: b.config ?? {},
        sort_order: b.sort_order ?? i,
      })),
    });

    if (error) {
      console.error("[configure-pathway] RPC error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[configure-pathway] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
