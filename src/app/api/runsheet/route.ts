import { NextRequest, NextResponse } from "next/server";
import { fetchRunsheetSessions } from "@/lib/runsheet/queries";

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");

  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }

  const sessions = await fetchRunsheetSessions(locationId);
  return NextResponse.json({ sessions });
}
