import { NextRequest, NextResponse } from "next/server";
import { fetchRunsheetSessions } from "@/lib/runsheet/queries";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");

  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status },
    );
  }

  const sessions = await fetchRunsheetSessions(locationId);
  return NextResponse.json({ sessions });
}
