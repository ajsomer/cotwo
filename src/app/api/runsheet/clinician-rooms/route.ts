import { NextRequest, NextResponse } from "next/server";
import { fetchClinicianRoomIds } from "@/lib/runsheet/queries";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");

  if (!locationId) {
    return NextResponse.json({ error: "location_id required" }, { status: 400 });
  }

  // Get authenticated user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roomIds = await fetchClinicianRoomIds(user.id, locationId);
  return NextResponse.json({ roomIds });
}
