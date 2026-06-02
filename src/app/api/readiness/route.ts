import { NextRequest, NextResponse } from "next/server";
import { fetchReadinessSlice } from "@/lib/clinic/fetchers/readiness";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";

// GET /api/readiness?location_id=xxx&direction=pre_appointment|post_appointment
// Returns appointments with workflow actions for the readiness dashboard,
// enriched with priority derivation, room/type names, and mode counts.
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");
  const direction = request.nextUrl.searchParams.get("direction") ?? "pre_appointment";

  if (!locationId) {
    return NextResponse.json({ error: "location_id required" }, { status: 400 });
  }

  if (direction !== "pre_appointment" && direction !== "post_appointment") {
    return NextResponse.json(
      { error: "direction must be pre_appointment or post_appointment" },
      { status: 400 }
    );
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status },
    );
  }

  try {
    const slice = await fetchReadinessSlice(locationId, direction);
    return NextResponse.json(slice, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[Readiness] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
