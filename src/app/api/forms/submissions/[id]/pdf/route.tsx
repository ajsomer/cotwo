import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import {
  formSubmissions,
  forms as formsT,
  formAssignments,
  patients as patientsT,
  organisations,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  assertStaffCanAccessPatient,
  requireAuthenticatedUser,
} from "@/lib/auth/staff-access";
import {
  normaliseQuestions,
  type SchemaRoot,
} from "@/lib/forms/format-answer-pdf";
import { SubmissionPdf, pdfFilename } from "@/lib/forms/submission-pdf-document";

// GET /api/forms/submissions/[id]/pdf
// Renders a form submission as an inline PDF. Staff-only; org-scoped.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cookie auth first — must precede any service-role lookup.
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

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
    // 404 on the org-mismatch case — no existence leak.
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const [formRes, assignmentRes, patientRes] = await Promise.all([
    db
      .select({ name: formsT.name, schema: formsT.schema })
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
        date_of_birth: patientsT.dateOfBirth,
        org_id: patientsT.orgId,
      })
      .from(patientsT)
      .where(eq(patientsT.id, submission.patient_id)),
  ]);

  const form = formRes[0];
  const assignment = assignmentRes[0];
  const patient = patientRes[0];

  let org: { name: string; logo_url: string | null } | null = null;
  if (patient?.org_id) {
    const [orgRow] = await db
      .select({ name: organisations.name, logo_url: organisations.logoUrl })
      .from(organisations)
      .where(eq(organisations.id, patient.org_id));
    org = orgRow ?? null;
  }

  // Schema source: prefer assignment-level snapshot (taken at send time),
  // fall back to forms.schema (current published schema) for intake-package
  // submissions which have no assignment row.
  const snapshot = assignment?.schema_snapshot as SchemaRoot | null | undefined;
  const fallbackSchema = (form?.schema as SchemaRoot | null | undefined) ?? null;
  const schema = snapshot ?? fallbackSchema ?? null;
  const usedFallbackSchema = !snapshot && !!fallbackSchema;

  const responses = (submission.responses as Record<string, unknown>) ?? {};
  const questions = normaliseQuestions(schema, responses);

  const completedAt = assignment?.completed_at ?? submission.created_at;
  const formName = form?.name ?? "Form";
  const patientName = patient
    ? `${patient.first_name} ${patient.last_name}`
    : "Patient";
  const dob = patient?.date_of_birth ?? null;
  const orgName = org?.name ?? null;
  const orgLogoUrl = org?.logo_url ?? null;

  const buffer = await renderToBuffer(
    <SubmissionPdf
      formName={formName}
      patientName={patientName}
      patientDob={dob}
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
      completedAt={completedAt}
      questions={questions}
      formId={submission.form_id}
      submissionId={submission.id}
      usedFallbackSchema={usedFallbackSchema}
    />,
  );

  // ArrayBuffer cast keeps TS happy with the Response body type.
  return new Response(buffer as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFilename(patientName, formName, completedAt)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
