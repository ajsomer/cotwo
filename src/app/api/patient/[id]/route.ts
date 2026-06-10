import { NextRequest, NextResponse } from "next/server";
import { assertStaffCanAccessPatient } from "@/lib/auth/staff-access";
import { fetchPatientSummary, fetchPatientHistory } from "./_shared";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * GET /api/patient/:id?session_id=xxx&appointment_id=yyy
 *
 * The full dossier (summary ∪ history) in one shot. Preserved for callers
 * that want everything up front. The contact card now prefers the split
 * `/summary` + `/history` routes for staged loading; this route remains the
 * single-fetch compatibility surface. Staff-only; org-scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const activeAppointmentId = request.nextUrl.searchParams.get("appointment_id");
  const activeSessionId = request.nextUrl.searchParams.get("session_id");

  const access = await assertStaffCanAccessPatient(patientId);
  if (!access.ok) {
    return denyResponse(access, { notFound: "Patient not found" });
  }

  const [summary, history] = await Promise.all([
    fetchPatientSummary(patientId),
    fetchPatientHistory(patientId, activeAppointmentId, activeSessionId),
  ]);

  if (!summary) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  return NextResponse.json({ ...summary, ...history });
}
