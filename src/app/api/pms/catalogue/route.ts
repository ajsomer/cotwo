import { NextResponse, type NextRequest } from "next/server";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { getConnectionForLocation } from "@/lib/pms/connection";
import { getStaticMetadata } from "@/lib/pms/registry";

/**
 * GET ?locationId= → the active provider's field catalogue + capabilities,
 * for the form builder's pmsTarget dropdown. Returns an empty catalogue when
 * the location has no PMS connection (the dropdown then offers only "don't send").
 */
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }

  const connection = await getConnectionForLocation(locationId);
  const meta = connection ? getStaticMetadata(connection.provider) : null;

  return NextResponse.json({
    provider: connection?.provider ?? null,
    capabilities: meta?.capabilities ?? null,
    fieldCatalogue: meta?.fieldCatalogue ?? [],
  });
}
