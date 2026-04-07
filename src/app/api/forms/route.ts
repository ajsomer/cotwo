import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/forms?org_id=xxx
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data: forms, error } = await supabase
      .from("forms")
      .select("id, name, description, status, schema, created_at, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get assignment counts per form
    const formIds = (forms ?? []).map((f) => f.id);
    let assignmentCounts: Record<string, { total: number; completed: number }> = {};

    if (formIds.length > 0) {
      const { data: assignments } = await supabase
        .from("form_assignments")
        .select("form_id, status")
        .in("form_id", formIds);

      if (assignments) {
        assignmentCounts = assignments.reduce((acc, a) => {
          if (!acc[a.form_id]) acc[a.form_id] = { total: 0, completed: 0 };
          acc[a.form_id].total++;
          if (a.status === "completed") acc[a.form_id].completed++;
          return acc;
        }, {} as Record<string, { total: number; completed: number }>);
      }
    }

    const formsWithCounts = (forms ?? []).map((f) => ({
      ...f,
      assignment_counts: assignmentCounts[f.id] ?? { total: 0, completed: 0 },
    }));

    return NextResponse.json({ forms: formsWithCounts });
  } catch (err) {
    console.error("[Forms] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/forms
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { org_id, name, description, schema } = body;

  if (!org_id || !name) {
    return NextResponse.json(
      { error: "org_id and name are required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: form, error } = await supabase
    .from("forms")
    .insert({
      org_id,
      name,
      description: description ?? null,
      schema: schema ?? { pages: [] },
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ form }, { status: 201 });
}

// PATCH /api/forms
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, description, schema, status } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (schema !== undefined) updates.schema = schema;
  if (status !== undefined) updates.status = status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabase.from("forms").update(updates).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/forms?id=xxx
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Check for active (non-completed) assignments
  const { data: activeAssignments } = await supabase
    .from("form_assignments")
    .select("id")
    .eq("form_id", id)
    .neq("status", "completed")
    .limit(1);

  if (activeAssignments && activeAssignments.length > 0) {
    return NextResponse.json(
      { error: "Cannot delete form with active assignments. Complete or remove assignments first." },
      { status: 409 }
    );
  }

  const { error } = await supabase.from("forms").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
