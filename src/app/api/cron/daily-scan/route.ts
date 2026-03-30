import { NextResponse } from "next/server";

export async function GET() {
  // TODO: Morning scan - create sessions from today's appointments
  return NextResponse.json({ scanned: true });
}
