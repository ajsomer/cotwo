import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appointments as appointmentsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { attachIntakePdfToPms } from "@/lib/pms/sync/push";

/**
 * POST { appointmentId } → attach the appointment's intake-package PDF to the
 * patient's PMS record (Cliniko patient_attachments). Location-gated.
 */
export async function POST(request: NextRequest) {
  const { appointmentId } = (await request.json().catch(() => ({}))) as {
    appointmentId?: string;
  };
  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }

  const [appt] = await db
    .select({
      locationId: appointmentsT.locationId,
      patientId: appointmentsT.patientId,
    })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, appointmentId))
    .limit(1);
  if (!appt) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const access = await requireStaffLocationAccess(appt.locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  if (!appt.patientId) {
    return NextResponse.json({ error: "No patient on appointment" }, { status: 409 });
  }

  const result = await attachIntakePdfToPms({
    appointmentId,
    locationId: appt.locationId,
    patientId: appt.patientId,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
