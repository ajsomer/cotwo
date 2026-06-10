import { NextResponse, type NextRequest } from "next/server";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { getConnectionForLocation, isSyncActive } from "@/lib/pms/connection";
import { importAppointmentTypes } from "@/lib/pms/integrations-service";
import { denyResponse } from "@/lib/api/route-helpers";

const PM_ROLES = new Set(["clinic_owner", "practice_manager"]);

/**
 * POST { locationId } → pull all appointment types from the location's PMS
 * connection into Coviu (unconfirmed), so the Workflows view can attach
 * pre-appointment workflows to every real type. The "refresh" button.
 */
export async function POST(request: NextRequest) {
  const { locationId } = (await request.json().catch(() => ({}))) as {
    locationId?: string;
  };
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return denyResponse(access);
  }
  if (!PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) {
    return NextResponse.json(
      { error: "No active PMS connection for this location." },
      { status: 409 }
    );
  }

  const result = await importAppointmentTypes(connection);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
