import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuthenticatedUser } from "@/lib/auth/staff-access";
import { extractFieldsFromSchema } from "@/lib/forms/extract-fields";

/**
 * GET /api/forms/standalone/submissions/[id]
 *
 * Staff-only. Returns the field rows for a standalone submission, ready for
 * inline review in the Readiness detail panel. Reuses the form's schema to
 * produce labelled rows and the same `{label, value}` shape the existing
 * form-handoff panel consumes — so the panel renders standalone submissions
 * the same way as appointment-bound ones.
 *
 * Author fields render from the response payload directly. Identity fields
 * (which are stored under `responses.patient_identity` as a server-owned
 * snapshot, not under their schema keys) are projected back into the
 * response shape before extraction so they render inline like everything
 * else.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { data: submission } = await supabase
    .from("form_submissions")
    .select(
      `
      id,
      form_id,
      patient_id,
      submission_source,
      review_status,
      reviewed_at,
      reviewed_by,
      responses,
      created_at,
      forms!inner(id, name, schema, org_id),
      patients!inner(id, first_name, last_name)
    `,
    )
    .eq("id", id)
    .single();

  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = Array.isArray(submission.forms)
    ? submission.forms[0]
    : submission.forms;
  const patient = Array.isArray(submission.patients)
    ? submission.patients[0]
    : submission.patients;

  const { data: assignments } = await supabase
    .from("staff_assignments")
    .select("locations!inner(org_id)")
    .eq("user_id", auth.userId);

  const userOrgIds = new Set(
    (assignments ?? [])
      .map((a) => {
        const loc = a.locations as
          | { org_id: string }
          | { org_id: string }[]
          | null;
        if (Array.isArray(loc)) return loc[0]?.org_id;
        return loc?.org_id;
      })
      .filter((orgId): orgId is string => !!orgId),
  );

  if (!form?.org_id || !userOrgIds.has(form.org_id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const responses = (submission.responses ?? {}) as Record<string, unknown>;
  const identity = (responses.patient_identity ?? {}) as Record<string, unknown>;
  const serverMeta = (responses.__server_meta ?? null) as {
    duplicate_suspected?: boolean;
    possible_duplicate_patient_id?: string;
    possible_duplicate_patient_name?: string;
  } | null;

  // Project the identity snapshot back to its schema-key namespace so the
  // existing extractor surfaces those fields inline alongside author fields.
  // Strip the locked-page intro `html` element (no real value) and the
  // existing-match radiogroup (its value is a patient_id sentinel, not
  // useful here).
  const projectedResponses: Record<string, unknown> = { ...responses };
  if (identity.first_name) projectedResponses.__identity_first_name = identity.first_name;
  if (identity.last_name) projectedResponses.__identity_last_name = identity.last_name;
  if (identity.date_of_birth)
    projectedResponses.__identity_date_of_birth = identity.date_of_birth;
  if (identity.email) projectedResponses.__identity_email = identity.email;

  const allFields = extractFieldsFromSchema(
    form.schema as Record<string, unknown>,
    projectedResponses,
  );

  // Strip rows that are noise on the staff side:
  //  - the existing-match radiogroup (`__identity_existing`) value is a
  //    patient_id or "__someone_else" sentinel
  //  - the locked intro html element
  //  - the canonical snapshot key itself (we already rendered the values
  //    individually)
  //  - the server-meta key
  const HIDDEN_NAMES = new Set([
    "__identity_existing",
    "__identity_intro",
    "patient_identity",
    "__server_meta",
  ]);
  const fields = allFields.filter((f) => !HIDDEN_NAMES.has(f.label));

  return NextResponse.json({
    id: submission.id,
    form_id: submission.form_id,
    form_name: form.name,
    patient: {
      id: patient.id,
      name: `${patient.first_name} ${patient.last_name}`,
    },
    submission_source: submission.submission_source,
    review_status: submission.review_status,
    reviewed_at: submission.reviewed_at,
    reviewed_by: submission.reviewed_by,
    created_at: submission.created_at,
    identity: {
      first_name: identity.first_name ?? null,
      last_name: identity.last_name ?? null,
      date_of_birth: identity.date_of_birth ?? null,
      email: identity.email ?? null,
      phone: identity.phone ?? null,
      resolution_kind: identity.resolution_kind ?? null,
    },
    duplicate: serverMeta?.duplicate_suspected
      ? {
          possible_duplicate_patient_id:
            serverMeta.possible_duplicate_patient_id ?? null,
          possible_duplicate_patient_name:
            serverMeta.possible_duplicate_patient_name ?? null,
        }
      : null,
    fields,
  });
}
