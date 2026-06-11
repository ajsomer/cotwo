import { cache } from 'react';
import { db } from '@/lib/db';
import {
  appointments as appointmentsT,
  appointmentTypes as appointmentTypesT,
  sessions as sessionsT,
  sessionParticipants,
  patients as patientsT,
  paymentMethods,
  rooms as roomsT,
  payments as paymentsT,
  users as usersT,
  staffAssignments,
  clinicianRoomAssignments,
  locations as locationsT,
} from '@/lib/db/schema';
import { and, eq, gte, lte, inArray, isNull, or } from 'drizzle-orm';
import type { RunsheetSession, Room } from '@/lib/types/domain';
import { dayBoundsInTimeZone } from '@/lib/runsheet/format';

/**
 * Fetch today's sessions for a location with all required joins.
 * Returns flat rows ready for enrichment and grouping.
 */
export const fetchRunsheetSessions = cache(async (
  locationId: string,
  date?: Date
): Promise<RunsheetSession[]> => {
  const targetDate = date ?? new Date();

  // Day bounds must be the clinic's LOCAL day (Australia/Sydney), resolved to
  // UTC instants — not the server's local day. Otherwise on-demand sessions,
  // matched purely on created_at, fall outside a UTC-built window depending on
  // the time of day and silently vanish from the run sheet. See
  // dayBoundsInTimeZone for the full reasoning.
  const [locationRow] = await db
    .select({ timezone: locationsT.timezone })
    .from(locationsT)
    .where(eq(locationsT.id, locationId))
    .limit(1);
  const timezone = locationRow?.timezone ?? 'Australia/Sydney';
  const { startOfDay, endOfDay } = dayBoundsInTimeZone(targetDate, timezone);

  // A session belongs to a day by its SCHEDULED date, not its creation date.
  // "Plan tomorrow" creates the session today but the appointment is scheduled
  // for tomorrow — filtering on created_at would wrongly show it today and
  // hide it tomorrow. So: first resolve the appointments scheduled for the day
  // at this location, then match sessions to those. On-demand sessions have no
  // appointment and legitimately key off their own created_at.
  const dayAppointments = await db
    .select({ id: appointmentsT.id })
    .from(appointmentsT)
    .where(
      and(
        eq(appointmentsT.locationId, locationId),
        gte(appointmentsT.scheduledAt, startOfDay.toISOString()),
        lte(appointmentsT.scheduledAt, endOfDay.toISOString())
      )
    );

  const dayAppointmentIds = dayAppointments.map((a) => a.id);

  // sessions for today = (scheduled appts today) OR (on-demand created today),
  // scoped to this location.
  const onDemandClause = and(
    isNull(sessionsT.appointmentId),
    gte(sessionsT.createdAt, startOfDay.toISOString()),
    lte(sessionsT.createdAt, endOfDay.toISOString())
  );
  const dayClause = dayAppointmentIds.length
    ? or(inArray(sessionsT.appointmentId, dayAppointmentIds), onDemandClause)
    : onDemandClause;

  const sessionRows = await db
    .select({
      id: sessionsT.id,
      status: sessionsT.status,
      entry_token: sessionsT.entryToken,
      video_call_id: sessionsT.videoCallId,
      notification_sent: sessionsT.notificationSent,
      notification_sent_at: sessionsT.notificationSentAt,
      patient_arrived: sessionsT.patientArrived,
      patient_arrived_at: sessionsT.patientArrivedAt,
      session_started_at: sessionsT.sessionStartedAt,
      session_ended_at: sessionsT.sessionEndedAt,
      created_at: sessionsT.createdAt,
      appointment_id: sessionsT.appointmentId,
      room_id: sessionsT.roomId,
    })
    .from(sessionsT)
    .where(and(eq(sessionsT.locationId, locationId), dayClause));

  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((s) => s.id);
  const apptIds = [...new Set(sessionRows.map((s) => s.appointment_id).filter((x): x is string => !!x))];
  const roomIds = [...new Set(sessionRows.map((s) => s.room_id).filter((x): x is string => !!x))];

  // Appointments + their type + clinician.
  const apptRows = apptIds.length === 0 ? [] : await db
    .select({
      id: appointmentsT.id,
      scheduled_at: appointmentsT.scheduledAt,
      status: appointmentsT.status,
      phone_number: appointmentsT.phoneNumber,
      appointment_type_id: appointmentsT.appointmentTypeId,
      clinician_id: appointmentsT.clinicianId,
      type_name: appointmentTypesT.name,
      type_modality: appointmentTypesT.modality,
      type_duration_minutes: appointmentTypesT.durationMinutes,
      type_default_fee_cents: appointmentTypesT.defaultFeeCents,
      clinician_name: usersT.fullName,
    })
    .from(appointmentsT)
    .leftJoin(appointmentTypesT, eq(appointmentTypesT.id, appointmentsT.appointmentTypeId))
    .leftJoin(usersT, eq(usersT.id, appointmentsT.clinicianId))
    .where(inArray(appointmentsT.id, apptIds));
  const apptMap = new Map(apptRows.map((a) => [a.id, a]));

  // Session participants → patient (one patient per session in MVP).
  const participantRows = await db
    .select({
      session_id: sessionParticipants.sessionId,
      patient_id: patientsT.id,
      first_name: patientsT.firstName,
      last_name: patientsT.lastName,
    })
    .from(sessionParticipants)
    .innerJoin(patientsT, eq(patientsT.id, sessionParticipants.patientId))
    .where(inArray(sessionParticipants.sessionId, sessionIds));
  const patientBySession = new Map(participantRows.map((p) => [p.session_id, p]));

  // Payment methods for the matched patients.
  const patientIds = [...new Set(participantRows.map((p) => p.patient_id))];
  const cardRows = patientIds.length === 0 ? [] : await db
    .select({
      patient_id: paymentMethods.patientId,
      card_last_four: paymentMethods.cardLastFour,
      card_brand: paymentMethods.cardBrand,
      is_default: paymentMethods.isDefault,
    })
    .from(paymentMethods)
    .where(inArray(paymentMethods.patientId, patientIds));
  const cardsByPatient = new Map<string, typeof cardRows>();
  for (const c of cardRows) {
    const list = cardsByPatient.get(c.patient_id) ?? [];
    list.push(c);
    cardsByPatient.set(c.patient_id, list);
  }

  // Rooms.
  const roomRows = roomIds.length === 0 ? [] : await db
    .select({
      id: roomsT.id,
      name: roomsT.name,
      room_type: roomsT.roomType,
      sort_order: roomsT.sortOrder,
    })
    .from(roomsT)
    .where(inArray(roomsT.id, roomIds));
  const roomMap = new Map(roomRows.map((r) => [r.id, r]));

  // Payments by session.
  const paymentRows = await db
    .select({
      session_id: paymentsT.sessionId,
      status: paymentsT.status,
      amount_cents: paymentsT.amountCents,
    })
    .from(paymentsT)
    .where(inArray(paymentsT.sessionId, sessionIds));
  const paymentsBySession = new Map<string, typeof paymentRows>();
  for (const p of paymentRows) {
    if (!p.session_id) continue;
    const list = paymentsBySession.get(p.session_id) ?? [];
    list.push(p);
    paymentsBySession.set(p.session_id, list);
  }

  return sessionRows.map((row): RunsheetSession => {
    const appointment = row.appointment_id ? apptMap.get(row.appointment_id) ?? null : null;
    const patient = patientBySession.get(row.id) ?? null;
    const cards = patient ? cardsByPatient.get(patient.patient_id) ?? [] : [];
    const defaultCard = cards.find((pm) => pm.is_default) ?? cards[0];
    const room = row.room_id ? roomMap.get(row.room_id) ?? null : null;
    const payments = paymentsBySession.get(row.id) ?? [];
    // Pick the most relevant payment: completed first, then any other.
    const completedPayment = payments.find((p) => p.status === 'completed') ?? payments[0] ?? null;

    return {
      session_id: row.id,
      status: row.status as RunsheetSession['status'],
      entry_token: row.entry_token as string,
      video_call_id: row.video_call_id,
      notification_sent: row.notification_sent,
      notification_sent_at: row.notification_sent_at,
      patient_arrived: row.patient_arrived,
      patient_arrived_at: row.patient_arrived_at,
      session_started_at: row.session_started_at,
      session_ended_at: row.session_ended_at,
      session_created_at: row.created_at,

      appointment_id: appointment?.id ?? null,
      scheduled_at: appointment?.scheduled_at ?? null,
      appointment_status: appointment?.status ?? null,
      phone_number: appointment?.phone_number ?? null,

      appointment_type_id: appointment?.appointment_type_id ?? null,
      type_name: appointment?.type_name ?? null,
      // On-demand sessions (joined via room link, no appointment) are always
      // telehealth by definition — room links are telehealth only.
      modality: (appointment?.type_modality as RunsheetSession['modality'])
        ?? (appointment ? null : 'telehealth'),
      duration_minutes: appointment?.type_duration_minutes ?? null,
      default_fee_cents: appointment?.type_default_fee_cents ?? null,

      patient_id: patient?.patient_id ?? null,
      patient_first_name: patient?.first_name ?? null,
      patient_last_name: patient?.last_name ?? null,

      room_id: room?.id ?? null,
      room_name: room?.name ?? null,
      room_type: (room?.room_type as RunsheetSession['room_type']) ?? null,
      room_sort_order: room?.sort_order ?? null,

      clinician_id: appointment?.clinician_id ?? null,
      clinician_name: appointment?.clinician_name ?? null,

      has_card_on_file: !!defaultCard,
      card_last_four: defaultCard?.card_last_four ?? null,
      card_brand: defaultCard?.card_brand ?? null,

      payment_status: (completedPayment?.status as RunsheetSession['payment_status']) ?? null,
      payment_amount_cents: completedPayment?.amount_cents ?? null,
    };
  });
});

/** Fetch all rooms at a location, ordered by sort_order. */
export const fetchLocationRooms = cache(async (locationId: string): Promise<Room[]> => {
  const data = await db
    .select({
      id: roomsT.id,
      location_id: roomsT.locationId,
      name: roomsT.name,
      room_type: roomsT.roomType,
      link_token: roomsT.linkToken,
      sort_order: roomsT.sortOrder,
      payments_enabled: roomsT.paymentsEnabled,
    })
    .from(roomsT)
    .where(eq(roomsT.locationId, locationId))
    .orderBy(roomsT.sortOrder);

  return data as Room[];
});

/** Fetch room IDs a clinician is assigned to at a location. */
export const fetchClinicianRoomIds = cache(async (
  userId: string,
  locationId: string
): Promise<string[]> => {
  const data = await db
    .select({ room_id: clinicianRoomAssignments.roomId })
    .from(clinicianRoomAssignments)
    .innerJoin(
      staffAssignments,
      eq(staffAssignments.id, clinicianRoomAssignments.staffAssignmentId)
    )
    .where(
      and(
        eq(staffAssignments.userId, userId),
        eq(staffAssignments.locationId, locationId)
      )
    );

  return data.map((row) => row.room_id);
});
