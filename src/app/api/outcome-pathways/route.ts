import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/outcome-pathways?org_id=xxx
// Returns outcome pathways with their linked workflow template and action blocks
// in a single response to avoid a second round trip.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const includeArchived = request.nextUrl.searchParams.get("include_archived") === "true";

    let query = supabase
      .from("outcome_pathways")
      .select("*")
      .eq("org_id", orgId)
      .order("name");

    if (!includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data: pathways, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch linked workflow templates and their action blocks
    const templateIds = (pathways ?? [])
      .map((p) => p.workflow_template_id)
      .filter(Boolean) as string[];

    let templates: Record<string, unknown> = {};
    let blocksByTemplate: Record<string, unknown[]> = {};

    if (templateIds.length > 0) {
      const { data: templateData } = await supabase
        .from("workflow_templates")
        .select("*")
        .in("id", templateIds);

      for (const t of templateData ?? []) {
        templates[t.id] = t;
      }

      const { data: blocks } = await supabase
        .from("workflow_action_blocks")
        .select("*")
        .in("template_id", templateIds)
        .order("sort_order");

      for (const b of blocks ?? []) {
        if (!blocksByTemplate[b.template_id]) {
          blocksByTemplate[b.template_id] = [];
        }
        blocksByTemplate[b.template_id].push(b);
      }
    }

    // Assemble response: each pathway includes its template and blocks
    const result = (pathways ?? []).map((p) => ({
      ...p,
      template: p.workflow_template_id
        ? templates[p.workflow_template_id] ?? null
        : null,
      blocks: p.workflow_template_id
        ? blocksByTemplate[p.workflow_template_id] ?? []
        : [],
      action_count: p.workflow_template_id
        ? (blocksByTemplate[p.workflow_template_id] ?? []).length
        : 0,
    }));

    return NextResponse.json({ outcome_pathways: result });
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/outcome-pathways
// Creates a new outcome pathway, optionally with a linked post-appointment
// workflow template.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_id, name, description, create_workflow } = body;

    if (!org_id || !name) {
      return NextResponse.json(
        { error: "org_id and name required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    let workflowTemplateId: string | null = null;

    // Optionally create a linked workflow template
    if (create_workflow) {
      const { data: template, error: templateError } = await supabase
        .from("workflow_templates")
        .insert({
          org_id,
          name: `Post-workflow: ${name}`,
          direction: "post_appointment",
          status: "draft",
        })
        .select("id")
        .single();

      if (templateError) {
        return NextResponse.json(
          { error: templateError.message },
          { status: 500 }
        );
      }

      workflowTemplateId = template.id;
    }

    const { data: pathway, error } = await supabase
      .from("outcome_pathways")
      .insert({
        org_id,
        name,
        description: description ?? null,
        workflow_template_id: workflowTemplateId,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        outcome_pathway: {
          ...pathway,
          template: null,
          blocks: [],
          action_count: 0,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/outcome-pathways
// Updates an outcome pathway's metadata (name, description).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (body.archived_at !== undefined) updates.archived_at = body.archived_at;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updateable fields provided" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { error } = await supabase
      .from("outcome_pathways")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/outcome-pathways?id=xxx
// Soft-deletes an outcome pathway by setting archived_at.
// Existing in-flight workflow runs continue; pathway is hidden from Process picker.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { error } = await supabase
      .from("outcome_pathways")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
