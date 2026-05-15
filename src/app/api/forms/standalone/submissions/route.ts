import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuthenticatedUser } from "@/lib/auth/staff-access";

/**
 * GET /api/forms/standalone/submissions?org_id=xxx&status=pending
 *
 * Staff-only. Returns standalone submissions for an org, filtered by review
 * status (default: pending). Used by the Readiness dashboard's
 * Standalone-submissions section.
 *
 * Auth: cookie session must resolve to a user with at least one
 * staff_assignment at a location whose org matches org_id.
 */
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  const status = request.nextUrl.searchParams.get("status") ?? "pending";

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }
  if (!["pending", "reviewed", "archived"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Org membership check: the user must have at least one staff_assignment
  // at a location in this org.
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
      .filter((id): id is string => !!id),
  );
  if (!userOrgIds.has(orgId)) {
    return NextResponse.json({ submissions: [] });
  }

  // Pull standalone submissions joined to the form (for the form name + org
  // scope) and the patient (for the display name in the inbox row).
  const { data, error } = await supabase
    .from("form_submissions")
    .select(
      `
      id,
      form_id,
      patient_id,
      submission_source,
      review_status,
      responses,
      created_at,
      forms!inner(id, name, org_id),
      patients!inner(id, first_name, last_name)
    `,
    )
    .neq("submission_source", "entry_flow")
    .eq("review_status", status)
    .eq("forms.org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[standalone-submissions] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    form_id: string;
    patient_id: string;
    submission_source: string;
    review_status: string;
    responses: Record<string, unknown> | null;
    created_at: string;
    forms: { id: string; name: string; org_id: string } | { id: string; name: string; org_id: string }[];
    patients: { id: string; first_name: string; last_name: string } | { id: string; first_name: string; last_name: string }[];
  };

  const submissions = (data as Row[] | null ?? []).map((r) => {
    const form = Array.isArray(r.forms) ? r.forms[0] : r.forms;
    const patient = Array.isArray(r.patients) ? r.patients[0] : r.patients;
    const serverMeta = (r.responses?.__server_meta ?? null) as {
      duplicate_suspected?: boolean;
      possible_duplicate_patient_id?: string;
      possible_duplicate_patient_name?: string;
    } | null;

    return {
      id: r.id,
      form_id: r.form_id,
      form_name: form?.name ?? "Form",
      patient_id: r.patient_id,
      patient_name: patient
        ? `${patient.first_name} ${patient.last_name}`
        : "Unknown patient",
      submission_source: r.submission_source,
      review_status: r.review_status,
      duplicate: serverMeta?.duplicate_suspected
        ? {
            possible_duplicate_patient_id:
              serverMeta.possible_duplicate_patient_id ?? null,
            possible_duplicate_patient_name:
              serverMeta.possible_duplicate_patient_name ?? null,
          }
        : null,
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ submissions });
}
