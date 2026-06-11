import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  formSubmissions,
  forms as formsT,
  formAssignments,
  patients as patientsT,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  assertStaffCanAccessPatient,
  requireAuthenticatedUser,
} from "@/lib/auth/staff-access";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";

// GET /api/forms/submissions/[id]
// Staff-only; org-scoped via the submission's patient.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cookie auth first — must precede any service-role lookup so an
  // unauthenticated caller can't tell valid IDs from invalid ones.
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return unauthenticatedResponse();
  }

  try {
    const [submission] = await db
      .select({
        id: formSubmissions.id,
        form_id: formSubmissions.formId,
        patient_id: formSubmissions.patientId,
        appointment_id: formSubmissions.appointmentId,
        responses: formSubmissions.responses,
        created_at: formSubmissions.createdAt,
      })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, id));

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const access = await assertStaffCanAccessPatient(submission.patient_id);
    if (!access.ok) {
      // 404 (not 403) on the org-mismatch case — same shape as the
      // submission-not-found branch above, no existence leak.
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const [formRes, assignmentRes, patientRes] = await Promise.all([
      db
        .select({ name: formsT.name })
        .from(formsT)
        .where(eq(formsT.id, submission.form_id)),
      db
        .select({
          schema_snapshot: formAssignments.schemaSnapshot,
          completed_at: formAssignments.completedAt,
        })
        .from(formAssignments)
        .where(eq(formAssignments.submissionId, id)),
      db
        .select({
          first_name: patientsT.firstName,
          last_name: patientsT.lastName,
        })
        .from(patientsT)
        .where(eq(patientsT.id, submission.patient_id)),
    ]);

    const form = formRes[0];
    const assignment = assignmentRes[0];
    const patient = patientRes[0];

    return NextResponse.json({
      form_name: form?.name ?? "Form",
      patient_name: patient
        ? `${patient.first_name} ${patient.last_name}`
        : "Patient",
      completed_at: assignment?.completed_at ?? submission.created_at,
      schema: assignment?.schema_snapshot ?? {},
      responses: submission.responses,
    });
  } catch (err) {
    console.error("[Forms] GET submissions/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
