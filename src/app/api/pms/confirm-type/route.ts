import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appointmentTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffOrgAccess } from "@/lib/auth/staff-access";
import { confirmAppointmentTypeSync } from "@/lib/pms/integrations-service";

/**
 * POST { appointmentTypeId, confirmedModality, syncEnabled }
 * Confirm a PMS-imported appointment type's modality + run-sheet sync toggle
 * (set from the Workflows type editor). Room is NOT here — it comes from the
 * practitioner mapping (§025).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    appointmentTypeId?: string;
    confirmedModality?: "telehealth" | "in_person";
    syncEnabled?: boolean;
  };
  if (!body.appointmentTypeId) {
    return NextResponse.json(
      { error: "appointmentTypeId required" },
      { status: 400 }
    );
  }

  // Authorize via the type's org.
  const [type] = await db
    .select({ orgId: appointmentTypes.orgId })
    .from(appointmentTypes)
    .where(eq(appointmentTypes.id, body.appointmentTypeId))
    .limit(1);
  if (!type) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const access = await requireStaffOrgAccess(type.orgId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status }
    );
  }

  const result = await confirmAppointmentTypeSync({
    appointmentTypeId: body.appointmentTypeId,
    confirmedModality: body.confirmedModality ?? null,
    syncEnabled: Boolean(body.syncEnabled),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
