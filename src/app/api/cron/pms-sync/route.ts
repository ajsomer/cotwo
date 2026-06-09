import { NextResponse } from "next/server";
import { listSyncActiveConnections } from "@/lib/pms/connection";
import { pullConnection } from "@/lib/pms/sync/pull";

/**
 * PMS read-sync cron. Plan §5: poll every 2-3 minutes (no webhooks).
 * Sweeps every sync-active connection (credentials present). Marker-only rows
 * are skipped because they have no credentials.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await listSyncActiveConnections();
  const results: Array<{ connectionId: string; provider: string } & Awaited<ReturnType<typeof pullConnection>>> =
    [];

  for (const c of connections) {
    try {
      const r = await pullConnection(c);
      results.push({ connectionId: c.id, provider: c.provider, ...r });
    } catch (err) {
      results.push({
        connectionId: c.id,
        provider: c.provider,
        ok: false,
        patients: 0,
        appointmentsUpserted: 0,
        sessionsScheduled: 0,
        cancelled: 0,
        skippedNonTelehealth: 0,
        reconciled: 0,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json({ swept: connections.length, results });
}
