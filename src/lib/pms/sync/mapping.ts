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

/** Upsert a connection-scoped patient link. */
export async function linkPatient(
  connectionId: string,
  patientId: string,
  externalId: string
): Promise<void> {
  await db
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
