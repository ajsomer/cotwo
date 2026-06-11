import { NextRequest, NextResponse } from "next/server";
import { fetchRunsheetSessions } from "@/lib/runsheet/queries";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");

  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return denyResponse(access);
  }

  const sessions = await fetchRunsheetSessions(locationId);
  // Run-sheet data is volatile and must never be served stale from the browser
  // or a CDN — state the intent explicitly instead of cache-busting the URL.
  return NextResponse.json(
    { sessions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
