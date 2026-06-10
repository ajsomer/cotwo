import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  formSubmissions,
  forms as formsT,
  patients as patientsT,
  staffAssignments,
  locations,
} from "@/lib/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { requireAuthenticatedUser } from "@/lib/auth/staff-access";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";

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
    return unauthenticatedResponse();
  }

  // Org membership check: the user must have at least one staff_assignment
  // at a location in this org.
  const assignments = await db
    .select({ org_id: locations.orgId })
    .from(staffAssignments)
    .innerJoin(locations, eq(locations.id, staffAssignments.locationId))
    .where(eq(staffAssignments.userId, auth.userId));

  const userOrgIds = new Set(
    assignments.map((a) => a.org_id).filter((id): id is string => !!id),
  );
  if (!userOrgIds.has(orgId)) {
    return NextResponse.json({ submissions: [] });
  }

  // Pull standalone submissions joined to the form (for the form name + org
  // scope) and the patient (for the display name in the inbox row).
  let data;
  try {
    data = await db
      .select({
        id: formSubmissions.id,
        form_id: formSubmissions.formId,
        patient_id: formSubmissions.patientId,
        submission_source: formSubmissions.submissionSource,
        review_status: formSubmissions.reviewStatus,
        responses: formSubmissions.responses,
        created_at: formSubmissions.createdAt,
        form_name: formsT.name,
        patient_first_name: patientsT.firstName,
        patient_last_name: patientsT.lastName,
      })
      .from(formSubmissions)
      .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
      .innerJoin(patientsT, eq(patientsT.id, formSubmissions.patientId))
      .where(
        and(
          ne(formSubmissions.submissionSource, "entry_flow"),
          eq(formSubmissions.reviewStatus, status),
          eq(formsT.orgId, orgId),
        ),
      )
      .orderBy(desc(formSubmissions.createdAt))
      .limit(100);
  } catch (error) {
    console.error("[standalone-submissions] list error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }

  const submissions = data.map((r) => {
    const responses = r.responses as Record<string, unknown> | null;
    const serverMeta = (responses?.__server_meta ?? null) as {
      duplicate_suspected?: boolean;
      possible_duplicate_patient_id?: string;
      possible_duplicate_patient_name?: string;
    } | null;

    return {
      id: r.id,
      form_id: r.form_id,
      form_name: r.form_name ?? "Form",
      patient_id: r.patient_id,
      patient_name: `${r.patient_first_name} ${r.patient_last_name}`,
      // Carry first/last separately (not split from the display string) so the
      // contact card can build a real PatientSeed.
      patient_first_name: r.patient_first_name ?? "",
      patient_last_name: r.patient_last_name ?? "",
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
