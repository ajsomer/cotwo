import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertStaffCanAccessPatient } from "@/lib/auth/staff-access";
import { fetchAppointmentWorkflowActions } from "@/lib/clinic/fetchers/workflow-actions";
import { fetchPatientSummary } from "../_shared";

/**
 * GET /api/patient/:id/summary?appointment_id=yyy
 *
 * The fast essentials: patient (incl. date_of_birth), phone numbers, payment
 * methods. Three indexed single-patient lookups, run in parallel. The contact
 * card fetches this first so DOB / contact / card paint before the heavy
 * history.
 *
 * When `appointment_id` is supplied, the response also carries
 * `workflow_actions` for that active appointment (Stage 7). Workflow is
 * active-appointment context, so it rides the fast path here rather than the
 * deferred /history payload. Scoped to the authorised patient.
 *
 * Staff-only; org-scoped. Auth runs independently of /history by design (see
 * the plan's "auth runs twice" trade-off) — the cost is off the critical
 * render path because the shell has already painted.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const activeAppointmentId = request.nextUrl.searchParams.get("appointment_id");
  const supabase = createServiceClient();

  const access = await assertStaffCanAccessPatient(supabase, patientId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthenticated" : "Patient not found" },
      { status: access.status },
    );
  }

  const [summary, workflowActions] = await Promise.all([
    fetchPatientSummary(supabase, patientId),
    activeAppointmentId
      ? fetchAppointmentWorkflowActions(supabase, activeAppointmentId, patientId)
      : Promise.resolve(null),
  ]);

  if (!summary) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...summary,
    ...(workflowActions ? { workflow_actions: workflowActions } : {}),
  });
}
