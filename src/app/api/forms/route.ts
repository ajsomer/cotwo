import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchForms } from "@/lib/clinic/fetchers/forms";
import { defaultFormSchema, ensureIdentityPage } from "@/lib/survey/identity-page";

// GET /api/forms?org_id=xxx
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  try {
    const forms = await fetchForms(orgId);
    return NextResponse.json({ forms });
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

  // Every form gets a locked identity page at the top. If the caller
  // supplies a schema, defensively ensure it contains the identity page
  // anyway — the builder can't author its own identity, and the runtime
  // depends on those reserved field names being present.
  const finalSchema = schema
    ? ensureIdentityPage(schema)
    : defaultFormSchema();

  const { data: form, error } = await supabase
    .from("forms")
    .insert({
      org_id,
      name,
      description: description ?? null,
      schema: finalSchema,
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
  // Defensive: any schema write must contain the locked identity page.
  // The builder UI prevents deleting it, but a tampered client or a
  // direct API call could submit a schema without it.
  if (schema !== undefined) updates.schema = ensureIdentityPage(schema);
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
