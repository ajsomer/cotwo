import { NextResponse, type NextRequest } from "next/server";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { getConnectionForLocation, isSyncActive } from "@/lib/pms/connection";
import { getStaticMetadata } from "@/lib/pms/registry";
import { webLinkForPatientAtLocation } from "@/lib/pms/web-link";

/**
 * GET ?locationId=&patientId= → the "Open in {PMS}" deep link for a patient,
 * or { url: null } when there's no sync-active PMS / no patient link / no web
 * links. Plan §6.2.
 */
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  const patientId = request.nextUrl.searchParams.get("patientId");
  if (!locationId || !patientId) {
    return NextResponse.json(
      { error: "locationId and patientId required" },
      { status: 400 }
    );
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }

  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) {
    return NextResponse.json({ url: null });
  }
  const url = await webLinkForPatientAtLocation(locationId, patientId);
  const meta = getStaticMetadata(connection.provider);
  return NextResponse.json({
    url,
    providerLabel:
      url && meta
        ? connection.provider.charAt(0).toUpperCase() +
          connection.provider.slice(1)
        : null,
  });
}
