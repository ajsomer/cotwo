import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Scope a patient flow resolves to from its entry token.
 *
 * Patients are not authenticated users — the unguessable entry token from
 * their URL is the only proof they may act on a given session/org. Patient
 * service-role routes must derive org/location/room/session from the token
 * (server-side) rather than trusting caller-supplied ids, or a crafted request
 * could read/mutate another clinic's or patient's data with RLS bypassed.
 *
 * Mirrors the lookup chain in /api/patient/resolve:
 *   sessions.entry_token → rooms.link_token → locations.qr_token.
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
  service: SupabaseClient,
  token: string,
): Promise<EntryTokenScope | null> {
  if (!token || typeof token !== "string") return null;

  // 1. Session entry token (SMS-link entry) — most specific.
  const { data: session } = await service
    .from("sessions")
    .select(
      "id, appointment_id, room_id, location_id, locations!inner(org_id)",
    )
    .eq("entry_token", token)
    .maybeSingle();

  if (session) {
    const loc = session.locations as
      | { org_id: string }
      | { org_id: string }[]
      | null;
    const orgId = Array.isArray(loc) ? loc[0]?.org_id : loc?.org_id;
    if (orgId) {
      return {
        orgId,
        locationId: session.location_id,
        roomId: session.room_id,
        sessionId: session.id,
        appointmentId: session.appointment_id,
        patientId: null,
      };
    }
  }

  // 2. Room link token (on-demand entry) — no session yet.
  const { data: room } = await service
    .from("rooms")
    .select("id, location_id, locations!inner(org_id)")
    .eq("link_token", token)
    .maybeSingle();

  if (room) {
    const loc = room.locations as
      | { org_id: string }
      | { org_id: string }[]
      | null;
    const orgId = Array.isArray(loc) ? loc[0]?.org_id : loc?.org_id;
    if (orgId) {
      return {
        orgId,
        locationId: room.location_id,
        roomId: room.id,
        sessionId: null,
        appointmentId: null,
        patientId: null,
      };
    }
  }

  // 3. Location QR token (in-person QR entry) — no room/session.
  const { data: location } = await service
    .from("locations")
    .select("id, org_id")
    .eq("qr_token", token)
    .maybeSingle();

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

  // 4. Intake journey token — used by the embedded intake flow. Binds to a
  //    patient + appointment; org/location come from the appointment.
  const { data: journey } = await service
    .from("intake_package_journeys")
    .select(
      "patient_id, appointment_id, appointments!inner(org_id, location_id)",
    )
    .eq("journey_token", token)
    .maybeSingle();

  if (journey) {
    const appt = journey.appointments as
      | { org_id: string; location_id: string }
      | { org_id: string; location_id: string }[]
      | null;
    const a = Array.isArray(appt) ? appt[0] : appt;
    if (a?.org_id) {
      return {
        orgId: a.org_id,
        locationId: a.location_id,
        roomId: null,
        sessionId: null,
        appointmentId: journey.appointment_id,
        patientId: journey.patient_id,
      };
    }
  }

  return null;
}
