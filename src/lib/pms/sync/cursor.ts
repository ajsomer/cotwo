import "server-only";
import { db } from "@/lib/db";
import { pmsSyncCursors } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Incremental sync watermark, one per (connection, resource). Plan §8.B.
 * Keyed on the connection so re-credentialing starts clean.
 */
export type SyncResource =
  | "appointments"
  | "patients"
  | "practitioners"
  | "appointment_types"
  | "businesses";

export async function getCursor(
  connectionId: string,
  resource: SyncResource
): Promise<Date | null> {
  const [row] = await db
    .select({ at: pmsSyncCursors.cursorUpdatedAt })
    .from(pmsSyncCursors)
    .where(
      and(
        eq(pmsSyncCursors.connectionId, connectionId),
        eq(pmsSyncCursors.resource, resource)
      )
    )
    .limit(1);
  return row?.at ? new Date(row.at) : null;
}

export async function setCursor(
  connectionId: string,
  resource: SyncResource,
  at: Date
): Promise<void> {
  await db
    .insert(pmsSyncCursors)
    .values({ connectionId, resource, cursorUpdatedAt: at.toISOString() })
    .onConflictDoUpdate({
      target: [pmsSyncCursors.connectionId, pmsSyncCursors.resource],
      set: { cursorUpdatedAt: at.toISOString() },
    });
}
