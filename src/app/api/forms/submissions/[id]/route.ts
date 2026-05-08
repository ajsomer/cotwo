import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  assertStaffCanAccessPatient,
  requireAuthenticatedUser,
} from "@/lib/auth/staff-access";

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
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const { data: submission, error } = await supabase
      .from("form_submissions")
      .select("id, form_id, patient_id, appointment_id, responses, created_at")
      .eq("id", id)
      .single();

    if (error || !submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const access = await assertStaffCanAccessPatient(supabase, submission.patient_id);
    if (!access.ok) {
      // 404 (not 403) on the org-mismatch case — same shape as the
      // submission-not-found branch above, no existence leak.
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const [formRes, assignmentRes, patientRes] = await Promise.all([
      supabase
        .from("forms")
        .select("name")
        .eq("id", submission.form_id)
        .single(),
      supabase
        .from("form_assignments")
        .select("schema_snapshot, completed_at")
        .eq("submission_id", id)
        .single(),
      supabase
        .from("patients")
        .select("first_name, last_name")
        .eq("id", submission.patient_id)
        .single(),
    ]);

    return NextResponse.json({
      form_name: formRes.data?.name ?? "Form",
      patient_name: patientRes.data
        ? `${patientRes.data.first_name} ${patientRes.data.last_name}`
        : "Patient",
      completed_at: assignmentRes.data?.completed_at ?? submission.created_at,
      schema: assignmentRes.data?.schema_snapshot ?? {},
      responses: submission.responses,
    });
  } catch (err) {
    console.error("[Forms] GET submissions/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
