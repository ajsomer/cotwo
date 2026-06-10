import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appointments as appointmentsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { getAppointmentPmsGate } from "@/lib/pms/session-gate";
import { pushAppointmentFormSubmissions } from "@/lib/pms/sync/push";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * Appointment-scoped PMS write-back, used by the intake handoff panel.
 *   GET  ?appointmentId= → gate (should "Sync to {PMS}" show, with pushable data)
 *   POST { appointmentId } → push the appointment's PMS-bound submissions
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointmentId");
  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }
  const denied = await authorize(appointmentId);
  if (denied) return denied;
  return NextResponse.json(await getAppointmentPmsGate(appointmentId));
}

export async function POST(request: NextRequest) {
  const { appointmentId } = (await request.json().catch(() => ({}))) as {
    appointmentId?: string;
  };
  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }
  const denied = await authorize(appointmentId);
  if (denied) return denied;

  const [appt] = await db
    .select({ locationId: appointmentsT.locationId })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, appointmentId))
    .limit(1);
  if (!appt) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const result = await pushAppointmentFormSubmissions({
    appointmentId,
    locationId: appt.locationId,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

async function authorize(appointmentId: string): Promise<NextResponse | null> {
  const [appt] = await db
    .select({ locationId: appointmentsT.locationId })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, appointmentId))
    .limit(1);
  if (!appt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const access = await requireStaffLocationAccess(appt.locationId);
  if (!access.ok) {
    return denyResponse(access);
  }
  return null;
}
