import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

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

    const supabase = createServiceClient();
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
