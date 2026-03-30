import { NextResponse } from "next/server";

export async function POST() {
  // TODO: PMS sync endpoint (Cliniko adapter)
  return NextResponse.json({ synced: true });
}
