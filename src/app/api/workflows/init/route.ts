import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/workflows/init?org_id=xxx&direction=pre_appointment
// Returns everything the workflows page needs in a single request:
// - Sidebar items (appointment types or outcome pathways with counts)
// - Published forms for pickers
// - First item's workflow template + action blocks
//
// Eliminates the 3-request waterfall on page load.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  const direction = request.nextUrl.searchParams.get("direction") ?? "pre_appointment";

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    if (direction === "pre_appointment") {
      // All 6 queries in parallel — includes templates for instant sidebar switching
      const [typesRes, linksRes, allBlocksRes, allTemplatesRes, runsRes, formsRes] = await Promise.all([
        supabase.from("appointment_types").select("*").eq("org_id", orgId).order("name"),
        supabase.from("type_workflow_links").select("appointment_type_id, workflow_template_id").eq("direction", "pre_appointment"),
        supabase.from("workflow_action_blocks").select("*").order("sort_order"),
        supabase.from("workflow_templates").select("*").eq("org_id", orgId).eq("direction", "pre_appointment"),
        supabase.from("appointment_workflow_runs").select("workflow_template_id").eq("status", "active"),
        supabase.from("forms").select("id, name, status").eq("org_id", orgId).eq("status", "published"),
      ]);

      const types = typesRes.data ?? [];
      const typeIds = new Set(types.map((t) => t.id));
      const links = (linksRes.data ?? []).filter((l) => typeIds.has(l.appointment_type_id));
      const linkByType = new Map(links.map((l) => [l.appointment_type_id, l.workflow_template_id]));
      const templateIds = new Set(links.map((l) => l.workflow_template_id));

      // Build templates map
      const templatesById: Record<string, unknown> = {};
      for (const t of allTemplatesRes.data ?? []) {
        if (templateIds.has(t.id)) templatesById[t.id] = t;
      }

      // Build blocks map (grouped by template)
      const blocksByTemplate: Record<string, unknown[]> = {};
      for (const b of allBlocksRes.data ?? []) {
        if (templateIds.has(b.template_id)) {
          if (!blocksByTemplate[b.template_id]) blocksByTemplate[b.template_id] = [];
          blocksByTemplate[b.template_id].push(b);
        }
      }

      const inFlightCounts: Record<string, number> = {};
      for (const r of runsRes.data ?? []) {
        if (templateIds.has(r.workflow_template_id)) {
          inFlightCounts[r.workflow_template_id] = (inFlightCounts[r.workflow_template_id] || 0) + 1;
        }
      }

      const appointmentTypes = types.map((t) => {
        const tid = linkByType.get(t.id) ?? null;
        const template = tid ? (templatesById[tid] as { terminal_type?: string } | undefined) : null;
        return {
          ...t,
          pre_workflow_template_id: tid,
          terminal_type: template?.terminal_type ?? null,
          action_count: tid ? (blocksByTemplate[tid] ?? []).length : 0,
          in_flight_count: tid ? inFlightCounts[tid] ?? 0 : 0,
        };
      });

      return NextResponse.json({
        appointment_types: appointmentTypes,
        outcome_pathways: [],
        forms: (formsRes.data ?? []).map((f) => ({ id: f.id, name: f.name })),
        templates: templatesById,
        blocks: blocksByTemplate,
      });
    } else {
      // Post-appointment: pathways already include template + blocks
      const [pathwaysRes, formsRes] = await Promise.all([
        supabase.from("outcome_pathways").select("*").eq("org_id", orgId).order("name"),
        supabase.from("forms").select("id, name, status").eq("org_id", orgId).eq("status", "published"),
      ]);

      const pathways = pathwaysRes.data ?? [];
      const templateIds = pathways.map((p) => p.workflow_template_id).filter(Boolean) as string[];

      let templates: Record<string, unknown> = {};
      let blocksByTemplate: Record<string, unknown[]> = {};

      if (templateIds.length > 0) {
        const [tplRes, blocksRes] = await Promise.all([
          supabase.from("workflow_templates").select("*").in("id", templateIds),
          supabase.from("workflow_action_blocks").select("*").in("template_id", templateIds).order("sort_order"),
        ]);
        for (const t of tplRes.data ?? []) templates[t.id] = t;
        for (const b of blocksRes.data ?? []) {
          if (!blocksByTemplate[b.template_id]) blocksByTemplate[b.template_id] = [];
          blocksByTemplate[b.template_id].push(b);
        }
      }

      const result = pathways.map((p) => ({
        ...p,
        template: p.workflow_template_id ? templates[p.workflow_template_id] ?? null : null,
        blocks: p.workflow_template_id ? blocksByTemplate[p.workflow_template_id] ?? [] : [],
        action_count: p.workflow_template_id ? (blocksByTemplate[p.workflow_template_id] ?? []).length : 0,
      }));

      // Build maps matching pre-appointment response shape
      const templatesById: Record<string, unknown> = {};
      const blocksByTemplateMap: Record<string, unknown[]> = {};
      for (const p of result) {
        if (p.template && p.workflow_template_id) {
          templatesById[p.workflow_template_id] = p.template;
          blocksByTemplateMap[p.workflow_template_id] = p.blocks;
        }
      }

      return NextResponse.json({
        appointment_types: [],
        outcome_pathways: result,
        forms: (formsRes.data ?? []).map((f) => ({ id: f.id, name: f.name })),
        templates: templatesById,
        blocks: blocksByTemplateMap,
      });
    }
  } catch (err) {
    console.error("[WORKFLOWS INIT] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
