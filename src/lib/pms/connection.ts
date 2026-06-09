import "server-only";
import { db } from "@/lib/db";
import { pmsConnections, locations } from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import type { PmsAdapter } from "./adapter";
import { buildAdapter } from "./registry";

export interface PmsConnectionRow {
  id: string;
  orgId: string;
  locationId: string;
  provider: string;
  status: string;
  credentialsEncrypted: string | null;
  defaultBusinessExternalId: string | null;
  accountSubdomain: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

const COLS = {
  id: pmsConnections.id,
  orgId: pmsConnections.orgId,
  locationId: pmsConnections.locationId,
  provider: pmsConnections.provider,
  status: pmsConnections.status,
  credentialsEncrypted: pmsConnections.credentialsEncrypted,
  defaultBusinessExternalId: pmsConnections.defaultBusinessExternalId,
  accountSubdomain: pmsConnections.accountSubdomain,
  lastSyncedAt: pmsConnections.lastSyncedAt,
  lastSyncError: pmsConnections.lastSyncError,
};

/** The connection for a location (sync-active or marker), or null. */
export async function getConnectionForLocation(
  locationId: string
): Promise<PmsConnectionRow | null> {
  const [row] = await db
    .select(COLS)
    .from(pmsConnections)
    .where(eq(pmsConnections.locationId, locationId))
    .limit(1);
  return row ?? null;
}

export async function getConnectionById(
  id: string
): Promise<PmsConnectionRow | null> {
  const [row] = await db
    .select(COLS)
    .from(pmsConnections)
    .where(eq(pmsConnections.id, id))
    .limit(1);
  return row ?? null;
}

/** A connection is sync-active iff it has stored credentials (plan §8.A). */
export function isSyncActive(c: PmsConnectionRow | null): boolean {
  return Boolean(c?.credentialsEncrypted);
}

/** All sync-active connections (for the cron sweep). */
export async function listSyncActiveConnections(): Promise<PmsConnectionRow[]> {
  return db
    .select(COLS)
    .from(pmsConnections)
    .where(isNotNull(pmsConnections.credentialsEncrypted));
}

/** Build a live adapter for a connection, or null if not sync-active. */
export function adapterForConnection(c: PmsConnectionRow): PmsAdapter | null {
  return buildAdapter({
    id: c.id,
    provider: c.provider,
    credentials_encrypted: c.credentialsEncrypted,
    account_subdomain: c.accountSubdomain,
  });
}

/** Record the outcome of a sync run on the connection. */
export async function recordSyncResult(
  connectionId: string,
  error: string | null
): Promise<void> {
  await db
    .update(pmsConnections)
    .set({
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: error,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pmsConnections.id, connectionId));
}

/** Resolve a location's org for org-scoped upserts (patients, types). */
export async function orgForLocation(locationId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: locations.orgId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  return row?.orgId ?? null;
}

export { and, eq };
