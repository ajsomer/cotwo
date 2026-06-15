import "server-only";
import { db } from "@/lib/db";
import {
  pmsAppointmentTypeLinks,
  pmsPatientLinks,
  pmsPractitionerLinks,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * External-id resolution: Cliniko (PMS) id ↔ Coviu uuid, connection-scoped.
 * All link lookups go through here so the rest of the engine stays clean.
 */

/** db or a transaction handle — lets link writes join a caller's transaction. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TypeLink {
  appointmentTypeId: string;
  confirmedModality: "telehealth" | "in_person" | null;
  roomId: string | null;
  syncEnabled: boolean;
}

/**
 * All three link tables for a connection, preloaded into Maps keyed by PMS
 * external id. A pull batch resolves every record against these instead of
 * issuing 3-7 lookup queries per record. The pull updates patientIdByExternal
 * as it creates+links new patients, so the cache stays current within a run.
 */
export interface MappingCache {
  patientIdByExternal: Map<string, string>;
  roomByPractitionerExternal: Map<string, string>;
  typeLinkByExternal: Map<string, TypeLink>;
}

export async function loadMappingCache(connectionId: string): Promise<MappingCache> {
  const [patientLinks, practitionerLinks, typeLinks] = await Promise.all([
    db
      .select({
        ext: pmsPatientLinks.pmsExternalId,
        patientId: pmsPatientLinks.patientId,
      })
      .from(pmsPatientLinks)
      .where(eq(pmsPatientLinks.connectionId, connectionId)),
    db
      .select({
        ext: pmsPractitionerLinks.pmsExternalId,
        roomId: pmsPractitionerLinks.roomId,
      })
      .from(pmsPractitionerLinks)
      .where(eq(pmsPractitionerLinks.connectionId, connectionId)),
    db
      .select({
        ext: pmsAppointmentTypeLinks.pmsExternalId,
        appointmentTypeId: pmsAppointmentTypeLinks.appointmentTypeId,
        confirmedModality: pmsAppointmentTypeLinks.confirmedModality,
        roomId: pmsAppointmentTypeLinks.roomId,
        syncEnabled: pmsAppointmentTypeLinks.syncEnabled,
      })
      .from(pmsAppointmentTypeLinks)
      .where(eq(pmsAppointmentTypeLinks.connectionId, connectionId)),
  ]);

  const cache: MappingCache = {
    patientIdByExternal: new Map(),
    roomByPractitionerExternal: new Map(),
    typeLinkByExternal: new Map(),
  };
  for (const row of patientLinks) {
    cache.patientIdByExternal.set(row.ext, row.patientId);
  }
  for (const row of practitionerLinks) {
    if (row.roomId) cache.roomByPractitionerExternal.set(row.ext, row.roomId);
  }
  for (const row of typeLinks) {
    cache.typeLinkByExternal.set(row.ext, {
      appointmentTypeId: row.appointmentTypeId,
      confirmedModality: row.confirmedModality,
      roomId: row.roomId,
      syncEnabled: row.syncEnabled,
    });
  }
  return cache;
}

/** Cliniko patient id for a Coviu patient under a connection, or null. */
export async function getPatientExternalId(
  connectionId: string,
  patientId: string
): Promise<string | null> {
  const [row] = await db
    .select({ ext: pmsPatientLinks.pmsExternalId })
    .from(pmsPatientLinks)
    .where(
      and(
        eq(pmsPatientLinks.connectionId, connectionId),
        eq(pmsPatientLinks.patientId, patientId)
      )
    )
    .limit(1);
  return row?.ext ?? null;
}

/** Coviu patient uuid for a Cliniko patient id under a connection, or null. */
export async function getPatientIdByExternal(
  connectionId: string,
  externalId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: pmsPatientLinks.patientId })
    .from(pmsPatientLinks)
    .where(
      and(
        eq(pmsPatientLinks.connectionId, connectionId),
        eq(pmsPatientLinks.pmsExternalId, externalId)
      )
    )
    .limit(1);
  return row?.id ?? null;
}

/** Upsert a connection-scoped patient link. Pass `executor` to join a
 *  caller's transaction (patient create + link must commit atomically — an
 *  unlinked patient gets duplicated on the next sync). */
export async function linkPatient(
  connectionId: string,
  patientId: string,
  externalId: string,
  executor: Executor = db
): Promise<void> {
  await executor
    .insert(pmsPatientLinks)
    .values({ connectionId, patientId, pmsExternalId: externalId })
    .onConflictDoUpdate({
      target: [pmsPatientLinks.connectionId, pmsPatientLinks.pmsExternalId],
      set: { patientId },
    });
}

/**
 * Coviu room id for a Cliniko practitioner (the appointment-book column) under a
 * connection. A synced appointment resolves its room from here (§025).
 */
export async function getRoomByPractitionerExternal(
  connectionId: string,
  externalId: string
): Promise<string | null> {
  const [row] = await db
    .select({ roomId: pmsPractitionerLinks.roomId })
    .from(pmsPractitionerLinks)
    .where(
      and(
        eq(pmsPractitionerLinks.connectionId, connectionId),
        eq(pmsPractitionerLinks.pmsExternalId, externalId)
      )
    )
    .limit(1);
  return row?.roomId ?? null;
}

/**
 * PMS practitioner external id for a Coviu room under a connection (the reverse
 * of the room mapping). Used to file practitioner-scoped writes — e.g. Gentu's
 * attachment upload needs the appointment's practitioner id. Returns null when
 * the room isn't mapped to a PMS practitioner.
 */
export async function getPractitionerExternalByRoom(
  connectionId: string,
  roomId: string
): Promise<string | null> {
  const [row] = await db
    .select({ ext: pmsPractitionerLinks.pmsExternalId })
    .from(pmsPractitionerLinks)
    .where(
      and(
        eq(pmsPractitionerLinks.connectionId, connectionId),
        eq(pmsPractitionerLinks.roomId, roomId)
      )
    )
    .limit(1);
  return row?.ext ?? null;
}

/** Resolution config for a Cliniko appointment type under a connection. */
export async function getTypeLinkByExternal(
  connectionId: string,
  externalId: string
): Promise<{
  appointmentTypeId: string;
  confirmedModality: "telehealth" | "in_person" | null;
  roomId: string | null;
  syncEnabled: boolean;
} | null> {
  const [row] = await db
    .select({
      appointmentTypeId: pmsAppointmentTypeLinks.appointmentTypeId,
      confirmedModality: pmsAppointmentTypeLinks.confirmedModality,
      roomId: pmsAppointmentTypeLinks.roomId,
      syncEnabled: pmsAppointmentTypeLinks.syncEnabled,
    })
    .from(pmsAppointmentTypeLinks)
    .where(
      and(
        eq(pmsAppointmentTypeLinks.connectionId, connectionId),
        eq(pmsAppointmentTypeLinks.pmsExternalId, externalId)
      )
    )
    .limit(1);
  return row ?? null;
}
