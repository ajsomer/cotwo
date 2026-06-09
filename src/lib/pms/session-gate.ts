import "server-only";
import { db } from "@/lib/db";
import { sessions as sessionsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getStaticMetadata } from "./registry";
import { getConnectionForLocation, isSyncActive } from "./connection";

/**
 * The §6.1 gate: does this session's location have a sync-active PMS that can
 * write back? The Process flow Done step renders "Complete & send to {PMS}"
 * only when this is true; otherwise it auto-completes exactly as before.
 */
export interface SessionPmsGate {
  active: boolean;
  provider: string | null;
  providerLabel: string | null;
}

export async function getSessionPmsGate(
  sessionId: string
): Promise<SessionPmsGate> {
  const [session] = await db
    .select({ locationId: sessionsT.locationId })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId))
    .limit(1);
  if (!session) return { active: false, provider: null, providerLabel: null };

  const connection = await getConnectionForLocation(session.locationId);
  if (!connection || !isSyncActive(connection)) {
    return { active: false, provider: null, providerLabel: null };
  }

  const meta = getStaticMetadata(connection.provider);
  const caps = meta?.capabilities;
  const canWrite = Boolean(caps?.writeForms || caps?.writePatientFields);
  return {
    active: canWrite,
    provider: canWrite ? connection.provider : null,
    providerLabel: canWrite
      ? (meta ? labelFor(connection.provider) : connection.provider)
      : null,
  };
}

function labelFor(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
