import { NextResponse } from "next/server";
import { executeScheduledActions } from "@/lib/workflows/engine";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthenticatedResponse();
  }

  try {
    const result = await executeScheduledActions();

    return NextResponse.json({
      scanned: true,
      ...result,
    });
  } catch (err) {
    console.error("[DAILY SCAN] Error:", err);
    return NextResponse.json(
      { scanned: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
