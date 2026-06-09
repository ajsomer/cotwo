import "server-only";
import { db } from "@/lib/db";
import { sessions as sessionsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  adapterForConnection,
  getConnectionForLocation,
  isSyncActive,
} from "./connection";
import { getPatientExternalId } from "./sync/mapping";

/**
 * Human-facing PMS web-app URL for a patient at a location (plan §6.2).
 * One helper, two call sites: the patient slideout Quick action and the §6.1
 * failed-field "Open in {PMS}" link. Returns null when there's no sync-active
 * connection, no patient link, or the provider has no web links.
 */
export async function webLinkForPatientAtLocation(
  locationId: string,
  patientId: string
): Promise<string | null> {
  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) return null;
  const adapter = adapterForConnection(connection);
  if (!adapter || !adapter.capabilities().webLinks) return null;
  const externalId = await getPatientExternalId(connection.id, patientId);
  if (!externalId) return null;
  return adapter.webLinkForPatient(externalId);
}

/** Same, resolving the location from a session. */
export async function webLinkForPatientBySession(
  sessionId: string,
  patientId: string
): Promise<string | null> {
  const [session] = await db
    .select({ locationId: sessionsT.locationId })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId))
    .limit(1);
  if (!session) return null;
  return webLinkForPatientAtLocation(session.locationId, patientId);
}
