import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertStaffCanAccessPatient } from "@/lib/auth/staff-access";
import { fetchPatientHistory } from "../_shared";

/**
 * GET /api/patient/:id/history?appointment_id=&session_id=
 *
 * The heavy timeline: form assignments/submissions, form names, intake
 * journeys, appointment buckets + count, sessions, on-demand history, and
 * active-row hoisting. Loads after the panel is already usable (shell +
 * summary have painted).
 *
 * Returns exactly { appointments, total_appointment_count, form_assignments,
 * form_submissions } — disjoint from /summary, so the client can merge both
 * into one PatientDetails without field collisions.
 *
 * Staff-only; org-scoped. Auth runs independently of /summary by design.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const activeAppointmentId = request.nextUrl.searchParams.get("appointment_id");
  const activeSessionId = request.nextUrl.searchParams.get("session_id");
  const supabase = createServiceClient();

  const access = await assertStaffCanAccessPatient(supabase, patientId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthenticated" : "Patient not found" },
      { status: access.status },
    );
  }

  const history = await fetchPatientHistory(
    supabase,
    patientId,
    activeAppointmentId,
    activeSessionId,
  );

  return NextResponse.json(history);
}
