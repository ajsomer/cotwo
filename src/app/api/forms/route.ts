import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forms as formsT, formAssignments } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { fetchForms } from "@/lib/clinic/fetchers/forms";
import { defaultFormSchema, ensureIdentityPage } from "@/lib/survey/identity-page";
import { derivePmsProviderFromSchema } from "@/lib/survey/pms-target-schema";
import {
  requireStaffOrgAccess,
  requireStaffCanAccessForm,
} from "@/lib/auth/staff-access";

// GET /api/forms?org_id=xxx
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const access = await requireStaffOrgAccess(orgId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
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

  const access = await requireStaffOrgAccess(org_id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  // Every form gets a locked identity page at the top. If the caller
  // supplies a schema, defensively ensure it contains the identity page
  // anyway — the builder can't author its own identity, and the runtime
  // depends on those reserved field names being present.
  const finalSchema = schema
    ? ensureIdentityPage(schema)
    : defaultFormSchema();

  let form;
  try {
    [form] = await db
      .insert(formsT)
      .values({
        orgId: org_id,
        name,
        description: description ?? null,
        schema: finalSchema,
        status: "draft",
      })
      .returning({
        id: formsT.id,
        org_id: formsT.orgId,
        name: formsT.name,
        description: formsT.description,
        schema: formsT.schema,
        status: formsT.status,
        is_platform_demo: formsT.isPlatformDemo,
        public_token: formsT.publicToken,
        public_token_rotated_at: formsT.publicTokenRotatedAt,
        public_token_rotated_by: formsT.publicTokenRotatedBy,
        created_at: formsT.createdAt,
        updated_at: formsT.updatedAt,
      });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
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

  const access = await requireStaffCanAccessForm(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  const updates: Partial<typeof formsT.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (schema !== undefined) {
    // Auto-tag the form's PMS provider from its bindings (plan §8.F). The tag
    // is derived from the provider-namespaced pmsTarget keys, so it stays
    // authoritative without trusting the client. NULL = generic, not PMS-bound.
    const provider = derivePmsProviderFromSchema(schema);
    updates.pmsProvider = provider as typeof formsT.$inferInsert.pmsProvider;
    // PMS write-back forms (e.g. Patient Registration) intentionally omit the
    // locked identity page — the patient flow confirms identity separately and
    // the bound fields already capture name/DOB/email. For generic forms keep
    // the defensive guarantee that the identity page is present.
    updates.schema = provider ? schema : ensureIdentityPage(schema);
  }
  if (status !== undefined) updates.status = status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    await db.update(formsT).set(updates).where(eq(formsT.id, id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/forms?id=xxx
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const access = await requireStaffCanAccessForm(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  // Check for active (non-completed) assignments
  const activeAssignments = await db
    .select({ id: formAssignments.id })
    .from(formAssignments)
    .where(
      and(eq(formAssignments.formId, id), ne(formAssignments.status, "completed"))
    )
    .limit(1);

  if (activeAssignments.length > 0) {
    return NextResponse.json(
      { error: "Cannot delete form with active assignments. Complete or remove assignments first." },
      { status: 409 }
    );
  }

  try {
    await db.delete(formsT).where(eq(formsT.id, id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
