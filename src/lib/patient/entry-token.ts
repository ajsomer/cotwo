import { db } from "@/lib/db";
import {
  sessions as sessionsT,
  rooms as roomsT,
  locations as locationsT,
  intakePackageJourneys,
  appointments as appointmentsT,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Scope a patient flow resolves to from its entry token.
 *
 * Patients are not authenticated users — the unguessable entry token from
 * their URL is the only proof they may act on a given session/org. Patient
 * service-role routes must derive org/location/room/session from the token
 * (server-side) rather than trusting caller-supplied ids, or a crafted request
 * could read/mutate another clinic's or patient's data.
 *
 * Mirrors the lookup chain in /api/patient/resolve:
 *   sessions.entry_token → rooms.link_token → locations.qr_token →
 *   intake_package_journeys.journey_token.
 */
export interface EntryTokenScope {
  orgId: string;
  locationId: string;
  roomId: string | null;
  sessionId: string | null;
  appointmentId: string | null;
  /** Patient bound to the token, when the token itself identifies one
   *  (intake journey tokens do; entry/room/qr tokens don't). */
  patientId: string | null;
}

export async function resolveEntryTokenScope(
  token: string,
): Promise<EntryTokenScope | null> {
  if (!token || typeof token !== "string") return null;

  // A token only ever matches one of these distinct token columns, so run all
  // lookups concurrently and take the single hit.
  const [sessionRows, roomRows, locationRows, journeyRows] = await Promise.all([
    db
      .select({
        id: sessionsT.id,
        appointment_id: sessionsT.appointmentId,
        room_id: sessionsT.roomId,
        location_id: sessionsT.locationId,
        org_id: locationsT.orgId,
      })
      .from(sessionsT)
      .innerJoin(locationsT, eq(locationsT.id, sessionsT.locationId))
      .where(eq(sessionsT.entryToken, token))
      .limit(1),
    db
      .select({
        id: roomsT.id,
        location_id: roomsT.locationId,
        org_id: locationsT.orgId,
      })
      .from(roomsT)
      .innerJoin(locationsT, eq(locationsT.id, roomsT.locationId))
      .where(eq(roomsT.linkToken, token))
      .limit(1),
    db
      .select({ id: locationsT.id, org_id: locationsT.orgId })
      .from(locationsT)
      .where(eq(locationsT.qrToken, token))
      .limit(1),
    db
      .select({
        patient_id: intakePackageJourneys.patientId,
        appointment_id: intakePackageJourneys.appointmentId,
        org_id: appointmentsT.orgId,
        location_id: appointmentsT.locationId,
      })
      .from(intakePackageJourneys)
      .innerJoin(appointmentsT, eq(appointmentsT.id, intakePackageJourneys.appointmentId))
      .where(eq(intakePackageJourneys.journeyToken, token))
      .limit(1),
  ]);

  // 1. Session entry token (SMS-link entry) — most specific.
  const session = sessionRows[0];
  if (session) {
    return {
      orgId: session.org_id,
      locationId: session.location_id,
      roomId: session.room_id,
      sessionId: session.id,
      appointmentId: session.appointment_id,
      patientId: null,
    };
  }

  // 2. Room link token (on-demand entry) — no session yet.
  const room = roomRows[0];
  if (room) {
    return {
      orgId: room.org_id,
      locationId: room.location_id,
      roomId: room.id,
      sessionId: null,
      appointmentId: null,
      patientId: null,
    };
  }

  // 3. Location QR token (in-person QR entry) — no room/session.
  const location = locationRows[0];
  if (location) {
    return {
      orgId: location.org_id,
      locationId: location.id,
      roomId: null,
      sessionId: null,
      appointmentId: null,
      patientId: null,
    };
  }

  // 4. Intake journey token — binds to a patient + appointment.
  const journey = journeyRows[0];
  if (journey && journey.org_id) {
    return {
      orgId: journey.org_id,
      locationId: journey.location_id,
      roomId: null,
      sessionId: null,
      appointmentId: journey.appointment_id,
      patientId: journey.patient_id,
    };
  }

  return null;
}
