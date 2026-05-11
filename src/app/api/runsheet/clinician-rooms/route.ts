import { NextRequest, NextResponse } from "next/server";
import { fetchClinicianRoomIds } from "@/lib/runsheet/queries";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");

  if (!locationId) {
    return NextResponse.json({ error: "location_id required" }, { status: 400 });
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status },
    );
  }

  const roomIds = await fetchClinicianRoomIds(access.userId, locationId);
  return NextResponse.json({ roomIds });
}
