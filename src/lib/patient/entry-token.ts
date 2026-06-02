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

function relOrgId(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return (v as { org_id?: string } | null)?.org_id;
}

export async function resolveEntryTokenScope(
  service: SupabaseClient,
  token: string,
): Promise<EntryTokenScope | null> {
  if (!token || typeof token !== "string") return null;

  // A token only ever matches one of these distinct token columns, so run all
  // lookups concurrently and take the single hit. (Sequential fallthrough made
  // a journey token pay 3 wasted round-trips before resolving.)
  const [sessionRes, roomRes, locationRes, journeyRes] = await Promise.all([
    service
      .from("sessions")
      .select("id, appointment_id, room_id, location_id, locations!inner(org_id)")
      .eq("entry_token", token)
      .maybeSingle(),
    service
      .from("rooms")
      .select("id, location_id, locations!inner(org_id)")
      .eq("link_token", token)
      .maybeSingle(),
    service
      .from("locations")
      .select("id, org_id")
      .eq("qr_token", token)
      .maybeSingle(),
    service
      .from("intake_package_journeys")
      .select("patient_id, appointment_id, appointments!inner(org_id, location_id)")
      .eq("journey_token", token)
      .maybeSingle(),
  ]);

  // 1. Session entry token (SMS-link entry) — most specific.
  const session = sessionRes.data;
  if (session) {
    const orgId = relOrgId(session.locations);
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
  const room = roomRes.data;
  if (room) {
    const orgId = relOrgId(room.locations);
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
  const location = locationRes.data;
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
  const journey = journeyRes.data;
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
