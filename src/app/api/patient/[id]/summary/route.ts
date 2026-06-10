import { NextRequest, NextResponse } from "next/server";
import { assertStaffCanAccessPatient } from "@/lib/auth/staff-access";
import { fetchPatientWorkflowActions } from "@/lib/clinic/fetchers/workflow-actions";
import { fetchPatientSummary } from "../_shared";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * GET /api/patient/:id/summary?appointment_id=yyy
 *
 * The fast essentials: patient (incl. date_of_birth), phone numbers, payment
 * methods. Three indexed single-patient lookups, run in parallel. The contact
 * card fetches this first so DOB / contact / card paint before the heavy
 * history.
 *
 * The response also carries `workflow_actions` — the patient's workflow-run
 * actions across a bounded recent appointment window — for the patient pane's
 * grouped Workflows section. Fetched unconditionally (not gated on
 * appointment_id) so it lands in every pane mode, including readiness. Bounded
 * so it stays light enough for the fast path. Scoped to the authorised patient.
 *
 * Staff-only; org-scoped. Auth runs independently of /history by design (see
 * the plan's "auth runs twice" trade-off) — the cost is off the critical
 * render path because the shell has already painted.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;

  const access = await assertStaffCanAccessPatient(patientId);
  if (!access.ok) {
    return denyResponse(access, { notFound: "Patient not found" });
  }

  const [summary, workflowActions] = await Promise.all([
    fetchPatientSummary(patientId),
    fetchPatientWorkflowActions(patientId),
  ]);

  if (!summary) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...summary,
    workflow_actions: workflowActions,
  });
}
