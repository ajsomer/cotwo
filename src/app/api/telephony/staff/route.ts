import { NextRequest, NextResponse } from "next/server";
import { PM_ROLES, requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { listLocationStaff } from "@/lib/telephony/config-service";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * GET /api/telephony/staff?locationId= — staff at the location, for the
 * "pop on this user's screen" picker in the phone-test settings page. PM-gated
 * (same as the connection route).
 */
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) return denyResponse(access);
  if (!PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ staff: await listLocationStaff(locationId) });
}
