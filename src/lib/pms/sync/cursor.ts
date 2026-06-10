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

/**
 * Clear a resource's watermark so the next sync re-pulls from scratch. Needed
 * when a mapping change makes previously-SKIPPED records eligible (e.g. an
 * appointment type is confirmed telehealth, or a practitioner gains a room):
 * the cursor advanced past those records when they streamed by unprocessed, so
 * incremental sync alone would never see them again. Upserts are idempotent,
 * so a re-pull is safe — just a full sweep.
 */
export async function clearCursor(
  connectionId: string,
  resource: SyncResource
): Promise<void> {
  await db
    .delete(pmsSyncCursors)
    .where(
      and(
        eq(pmsSyncCursors.connectionId, connectionId),
        eq(pmsSyncCursors.resource, resource)
      )
    );
}
