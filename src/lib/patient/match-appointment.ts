import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  locations as locationsT,
  patientPhoneNumbers,
} from "@/lib/db/schema";
import { and, asc, eq, gte, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
import { dayBoundsInTimeZone } from "@/lib/runsheet/format";

/**
 * Find a scheduled appointment to map a patient onto when they arrive via a
 * generic room link (on-demand entry).
 *
 * Scope is strict: today (clinic-local day), in the link's room, at the link's
 * location, non-terminal status. The match is fully server-derived from the
 * confirmed patient_id — never a client-supplied phone — and is shared-phone
 * safe: an appointment matches only if it is already linked to this patient,
 * or it is UNLINKED and its raw phone (e.g. from PMS sync) matches one of the
 * patient's numbers. The `patient_id IS NULL` guard prevents a shared phone
 * from mapping onto an appointment booked for a different patient.
 *
 * Terminal appointment statuses (cancelled/completed/no_show) are excluded so
 * an earlier-in-the-day finished appointment can't win the earliest-first
 * ordering over the active one the patient is actually arriving for.
 *
 * `excludeAppointmentIds` supports the caller's bounded retry loop: when a
 * candidate fails post-lock revalidation, it is excluded and we re-match so a
 * second still-valid appointment isn't silently skipped.
 *
 * Returns the earliest matching appointment, or null.
 */
export async function findMatchingAppointmentForRoom(params: {
  patientId: string;
  roomId: string;
  locationId: string;
  now?: Date;
  excludeAppointmentIds?: string[];
}): Promise<{ appointmentId: string; patientIdOnAppt: string | null } | null> {
  const { patientId, roomId, locationId, excludeAppointmentIds = [] } = params;
  const now = params.now ?? new Date();

  // Day bounds in the clinic's local day, resolved to UTC instants. Matching on
  // the server's local day would drop or misplace appointments near midnight.
  const [locationRow] = await db
    .select({ timezone: locationsT.timezone })
    .from(locationsT)
    .where(eq(locationsT.id, locationId))
    .limit(1);
  const timezone = locationRow?.timezone ?? "Australia/Sydney";
  const { startOfDay, endOfDay } = dayBoundsInTimeZone(now, timezone);

  // The patient's phone numbers. Lenient on verified_at: OTP writes the
  // canonical E.164 row, so its existence is sufficient; the unlinked-only
  // guard below is what keeps the phone match safe.
  const phoneRows = await db
    .select({ phone_number: patientPhoneNumbers.phoneNumber })
    .from(patientPhoneNumbers)
    .where(eq(patientPhoneNumbers.patientId, patientId));
  const phones = phoneRows.map((r) => r.phone_number).filter((p): p is string => !!p);

  // Shared-phone-safe match: linked-to-me OR (unlinked AND raw phone matches).
  const phoneClause = phones.length
    ? and(isNull(appointmentsT.patientId), inArray(appointmentsT.phoneNumber, phones))
    : undefined;
  const matchClause = phoneClause
    ? or(eq(appointmentsT.patientId, patientId), phoneClause)
    : eq(appointmentsT.patientId, patientId);

  const where = and(
    eq(appointmentsT.locationId, locationId),
    eq(appointmentsT.roomId, roomId),
    gte(appointmentsT.scheduledAt, startOfDay.toISOString()),
    lte(appointmentsT.scheduledAt, endOfDay.toISOString()),
    // Exclude all terminal statuses, not just cancelled.
    notInArray(appointmentsT.status, ["cancelled", "completed", "no_show"]),
    matchClause,
    excludeAppointmentIds.length
      ? notInArray(appointmentsT.id, excludeAppointmentIds)
      : undefined,
  );

  const [row] = await db
    .select({ id: appointmentsT.id, patient_id: appointmentsT.patientId })
    .from(appointmentsT)
    .where(where)
    .orderBy(asc(appointmentsT.scheduledAt))
    .limit(1);

  if (!row) return null;
  return { appointmentId: row.id, patientIdOnAppt: row.patient_id };
}
