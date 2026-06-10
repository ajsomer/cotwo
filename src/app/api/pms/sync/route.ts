import { NextResponse, type NextRequest } from "next/server";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import {
  getConnectionForLocation,
  isSyncActive,
} from "@/lib/pms/connection";
import { pullConnection } from "@/lib/pms/sync/pull";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * Staff-triggered "Sync now" for a location (plan §5). Pulls the location's
 * sync-active connection immediately, rather than waiting for the cron.
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

  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) {
    return NextResponse.json(
      { error: "No active PMS connection for this location." },
      { status: 409 }
    );
  }

  const result = await pullConnection(connection);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
