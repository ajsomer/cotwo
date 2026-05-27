import { NextResponse } from "next/server";
import { executeScheduledActions } from "@/lib/workflows/engine";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[DAILY SCAN] Starting...");

  try {
    const result = await executeScheduledActions();

    console.log(
      `[DAILY SCAN] Complete. Fired: ${result.fired}, Skipped: ${result.skipped}, Failed: ${result.failed}`
    );

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
