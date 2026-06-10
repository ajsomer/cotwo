import { NextResponse, type NextRequest } from "next/server";
import { requireStaffAppointmentLocationAccess } from "@/lib/auth/staff-access";
import { getAppointmentPmsGate } from "@/lib/pms/session-gate";
import { pushAppointmentFormSubmissions } from "@/lib/pms/sync/push";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * Appointment-scoped PMS write-back, used by the intake handoff panel.
 * Session-scoped sibling: /api/pms/push.
 *   GET  ?appointmentId= → gate (should "Sync to {PMS}" show, with pushable data)
 *   POST { appointmentId } → push the appointment's PMS-bound submissions
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointmentId");
  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }
  const access = await requireStaffAppointmentLocationAccess(appointmentId);
  if (!access.ok) {
    return denyResponse(access);
  }
  return NextResponse.json(await getAppointmentPmsGate(appointmentId));
}

export async function POST(request: NextRequest) {
  const { appointmentId } = (await request.json().catch(() => ({}))) as {
    appointmentId?: string;
  };
  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }
  const access = await requireStaffAppointmentLocationAccess(appointmentId);
  if (!access.ok) {
    return denyResponse(access);
  }

  // The gate already resolved the appointment's location — no second fetch.
  const result = await pushAppointmentFormSubmissions({
    appointmentId,
    locationId: access.locationId,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
