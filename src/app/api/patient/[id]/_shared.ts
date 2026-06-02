import { db } from "@/lib/db";
import {
  patients as patientsT,
  patientPhoneNumbers,
  paymentMethods,
  formAssignments,
  formSubmissions,
  forms as formsT,
  intakePackageJourneys,
  appointments as appointmentsT,
  appointmentTypes,
  rooms as roomsT,
  locations as locationsT,
  sessions as sessionsT,
  sessionParticipants,
} from "@/lib/db/schema";
import { and, eq, ne, gte, lt, isNull, inArray, desc, asc, sql } from "drizzle-orm";
import { bucketByLocalDay, type DayBucket } from "@/lib/datetime/timezone-bucket";

// Split candidate fetching into future-asc + past-desc + awaiting (null
// scheduled_at) so each bucket has its own candidate budget. Without the
// awaiting split, "past + null" ordered by scheduled_at DESC NULLS LAST
// queues null-scheduled rows behind every past row before the limit,
// effectively hiding them whenever a patient has more than N past rows.
export const FUTURE_LIMIT = 15;
export const PAST_LIMIT = 15;
export const AWAITING_LIMIT = 5;
export const ON_DEMAND_LIMIT = 30;
export const TIMELINE_CAP = 10;
// Bounded recent-form history. The active appointment's forms are fetched
// separately and unbounded (see fetchPatientHistory), so a patient with many
// newer forms from other appointments can never push the active appointment's
// older form outside this window.
export const FORM_HISTORY_LIMIT = 25;

export type Bucket = DayBucket | "awaiting_scheduling";

export interface AppointmentRow {
  appointment_id: string | null;
  session_id: string | null;
  scheduled_at: string | null;
  created_at: string | null;
  type_name: string | null;
  room_name: string | null;
  modality: "telehealth" | "in_person" | null;
  appointment_status: string | null;
  session_status: string | null;
  bucket: Bucket;
  location_timezone: string | null;
}

export interface PatientSummary {
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  };
  phone_numbers: { phone_number: string; is_primary: boolean }[];
  payment_methods: {
    card_brand: string;
    card_last_four: string;
    card_expiry: string | null;
    is_default: boolean;
  }[];
}

export interface FormAssignmentRow {
  id: string;
  form_id: string;
  appointment_id: string | null;
  form_name: string;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  submission_id: string | null;
}

export interface FormSubmissionRow {
  submission_id: string;
  form_id: string;
  appointment_id: string | null;
  form_name: string;
  completed_at: string;
  created_at: string;
}

export interface PatientHistory {
  appointments: AppointmentRow[];
  total_appointment_count: number;
  form_assignments: FormAssignmentRow[];
  form_submissions: FormSubmissionRow[];
  // True when the bounded patient-wide form history hit FORM_HISTORY_LIMIT, so
  // the panel can surface a "+ earlier forms" affordance. The active
  // appointment's forms are always included regardless (fetched unbounded).
  form_history_truncated: boolean;
}

// Column shape for an appointment row joined with its type/room/location.
interface ApptJoinRow {
  id: string;
  scheduled_at: string | null;
  status: string;
  created_at: string;
  type_name: string | null;
  modality: "telehealth" | "in_person" | null;
  room_name: string | null;
  location_timezone: string | null;
}

// Bucket display order — must stay in sync with the orderedAll concat order.
const BUCKET_DISPLAY_ORDER: Bucket[] = [
  "upcoming",
  "today",
  "past",
  "awaiting_scheduling",
];

// Dedupe rows by `id`, keeping first occurrence (so recent-history order wins
// over the active-appointment top-up).
function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary: small, fast, indexed single-patient lookups (DOB, phones, cards).
// ---------------------------------------------------------------------------
export async function fetchPatientSummary(
  patientId: string,
): Promise<PatientSummary | null> {
  const [patientRows, phonesRows, cardsRows] = await Promise.all([
    db
      .select({
        id: patientsT.id,
        first_name: patientsT.firstName,
        last_name: patientsT.lastName,
        date_of_birth: patientsT.dateOfBirth,
      })
      .from(patientsT)
      .where(eq(patientsT.id, patientId)),
    db
      .select({
        phone_number: patientPhoneNumbers.phoneNumber,
        is_primary: patientPhoneNumbers.isPrimary,
      })
      .from(patientPhoneNumbers)
      .where(eq(patientPhoneNumbers.patientId, patientId))
      .orderBy(desc(patientPhoneNumbers.isPrimary)),
    db
      .select({
        card_brand: paymentMethods.cardBrand,
        card_last_four: paymentMethods.cardLastFour,
        card_expiry: paymentMethods.cardExpiry,
        is_default: paymentMethods.isDefault,
      })
      .from(paymentMethods)
      .where(eq(paymentMethods.patientId, patientId))
      .orderBy(desc(paymentMethods.isDefault)),
  ]);

  const patient = patientRows[0];
  if (!patient) return null;

  return {
    patient,
    phone_numbers: phonesRows,
    payment_methods: cardsRows,
  };
}

// ---------------------------------------------------------------------------
// History: the heavy timeline — form assignments/submissions, intake journeys,
// appointment buckets + count, sessions, on-demand history, active-row hoist.
// ---------------------------------------------------------------------------
export async function fetchPatientHistory(
  patientId: string,
  activeAppointmentId: string | null,
  activeSessionId: string | null,
): Promise<PatientHistory> {
  // Form assignments + form submissions, fetched in two parts so bounding the
  // patient-wide history can never hide the active appointment's forms:
  //   (1) active-appointment forms — UNBOUNDED, filtered by appointment_id.
  //       These always survive regardless of how many newer forms exist.
  //   (2) bounded recent patient-wide history — most-recent FORM_HISTORY_LIMIT,
  //       for the "earlier forms" context.
  // Merged + deduped by row id below. (Readiness mode is unaffected — it reads
  // from the row's completed_form_submissions, not this list.)
  const recentAssignmentsPromise = db
    .select({
      id: formAssignments.id,
      form_id: formAssignments.formId,
      appointment_id: formAssignments.appointmentId,
      status: formAssignments.status,
      sent_at: formAssignments.sentAt,
      completed_at: formAssignments.completedAt,
      created_at: formAssignments.createdAt,
      submission_id: formAssignments.submissionId,
    })
    .from(formAssignments)
    .where(eq(formAssignments.patientId, patientId))
    .orderBy(desc(formAssignments.createdAt))
    .limit(FORM_HISTORY_LIMIT);

  const recentSubmissionsPromise = db
    .select({
      id: formSubmissions.id,
      form_id: formSubmissions.formId,
      appointment_id: formSubmissions.appointmentId,
      created_at: formSubmissions.createdAt,
    })
    .from(formSubmissions)
    .where(eq(formSubmissions.patientId, patientId))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(FORM_HISTORY_LIMIT);

  type AssignmentRowT = Awaited<typeof recentAssignmentsPromise>[number];
  type SubmissionRowT = Awaited<typeof recentSubmissionsPromise>[number];

  const [
    recentAssignmentsRes,
    recentSubmissionsRes,
    activeAssignmentsRes,
    activeSubmissionsRes,
  ] = await Promise.all([
    recentAssignmentsPromise,
    recentSubmissionsPromise,
    activeAppointmentId
      ? db
          .select({
            id: formAssignments.id,
            form_id: formAssignments.formId,
            appointment_id: formAssignments.appointmentId,
            status: formAssignments.status,
            sent_at: formAssignments.sentAt,
            completed_at: formAssignments.completedAt,
            created_at: formAssignments.createdAt,
            submission_id: formAssignments.submissionId,
          })
          .from(formAssignments)
          .where(
            and(
              eq(formAssignments.patientId, patientId),
              eq(formAssignments.appointmentId, activeAppointmentId),
            ),
          )
      : Promise.resolve([] as AssignmentRowT[]),
    activeAppointmentId
      ? db
          .select({
            id: formSubmissions.id,
            form_id: formSubmissions.formId,
            appointment_id: formSubmissions.appointmentId,
            created_at: formSubmissions.createdAt,
          })
          .from(formSubmissions)
          .where(
            and(
              eq(formSubmissions.patientId, patientId),
              eq(formSubmissions.appointmentId, activeAppointmentId),
            ),
          )
      : Promise.resolve([] as SubmissionRowT[]),
  ]);

  // Dedupe by id, recent-history rows first (preserves recency order); the
  // active-appointment rows top up anything the bounded window dropped.
  const formAssignmentsData = dedupeById([
    ...recentAssignmentsRes,
    ...activeAssignmentsRes,
  ]);
  const formSubmissionsData = dedupeById([
    ...recentSubmissionsRes,
    ...activeSubmissionsRes,
  ]);

  // Either bounded branch hitting the limit means there may be older forms
  // beyond the window (the active appointment's are still guaranteed present).
  const formHistoryTruncated =
    recentAssignmentsRes.length >= FORM_HISTORY_LIMIT ||
    recentSubmissionsRes.length >= FORM_HISTORY_LIMIT;

  const formIds = new Set<string>();
  formAssignmentsData.forEach((a) => formIds.add(a.form_id));
  formSubmissionsData.forEach((s) => formIds.add(s.form_id));

  let formNameMap: Record<string, string> = {};
  if (formIds.size > 0) {
    const formsData = await db
      .select({ id: formsT.id, name: formsT.name })
      .from(formsT)
      .where(inArray(formsT.id, [...formIds]));
    formNameMap = Object.fromEntries(formsData.map((f) => [f.id, f.name]));
  }

  // For intake-package submission rows, look up the journey's per-form
  // completion timestamp so we can resolve completed_at properly.
  const submissionAppointmentIds = [
    ...new Set(
      formSubmissionsData
        .map((s) => s.appointment_id)
        .filter((id): id is string => !!id),
    ),
  ];
  let journeyByAppointment: Record<
    string,
    { forms_completed: Record<string, string> | null }
  > = {};
  if (submissionAppointmentIds.length > 0) {
    const journeys = await db
      .select({
        appointment_id: intakePackageJourneys.appointmentId,
        forms_completed: intakePackageJourneys.formsCompleted,
      })
      .from(intakePackageJourneys)
      .where(inArray(intakePackageJourneys.appointmentId, submissionAppointmentIds));
    journeyByAppointment = Object.fromEntries(
      journeys.map((j) => [
        j.appointment_id,
        {
          forms_completed:
            (j.forms_completed as Record<string, string>) ?? null,
        },
      ]),
    );
  }

  const formAssignments_: FormAssignmentRow[] = formAssignmentsData.map(
    (a) => ({
      id: a.id,
      form_id: a.form_id,
      appointment_id: a.appointment_id,
      form_name: formNameMap[a.form_id] ?? "Unknown form",
      status: a.status,
      sent_at: a.sent_at,
      completed_at: a.completed_at,
      created_at: a.created_at,
      submission_id: a.submission_id,
    }),
  );

  const formSubmissions_: FormSubmissionRow[] = formSubmissionsData.map(
    (s) => {
      const journey = s.appointment_id
        ? journeyByAppointment[s.appointment_id]
        : undefined;
      const journeyCompleted = journey?.forms_completed?.[s.form_id] ?? null;
      return {
        submission_id: s.id,
        form_id: s.form_id,
        appointment_id: s.appointment_id,
        form_name: formNameMap[s.form_id] ?? "Unknown form",
        completed_at: journeyCompleted ?? s.created_at,
        created_at: s.created_at,
      };
    },
  );

  // Unified appointments timeline
  const nowIso = new Date().toISOString();
  const [futureRes, pastRes, awaitingRes, apptsCountRes] = await Promise.all([
    db
      .select(APPT_SELECT)
      .from(appointmentsT)
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointmentsT.appointmentTypeId))
      .leftJoin(roomsT, eq(roomsT.id, appointmentsT.roomId))
      .leftJoin(locationsT, eq(locationsT.id, appointmentsT.locationId))
      .where(
        and(
          eq(appointmentsT.patientId, patientId),
          ne(appointmentsT.status, "cancelled"),
          gte(appointmentsT.scheduledAt, nowIso),
        ),
      )
      .orderBy(asc(appointmentsT.scheduledAt))
      .limit(FUTURE_LIMIT),
    db
      .select(APPT_SELECT)
      .from(appointmentsT)
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointmentsT.appointmentTypeId))
      .leftJoin(roomsT, eq(roomsT.id, appointmentsT.roomId))
      .leftJoin(locationsT, eq(locationsT.id, appointmentsT.locationId))
      .where(
        and(
          eq(appointmentsT.patientId, patientId),
          ne(appointmentsT.status, "cancelled"),
          lt(appointmentsT.scheduledAt, nowIso),
        ),
      )
      .orderBy(desc(appointmentsT.scheduledAt))
      .limit(PAST_LIMIT),
    db
      .select(APPT_SELECT)
      .from(appointmentsT)
      .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointmentsT.appointmentTypeId))
      .leftJoin(roomsT, eq(roomsT.id, appointmentsT.roomId))
      .leftJoin(locationsT, eq(locationsT.id, appointmentsT.locationId))
      .where(
        and(
          eq(appointmentsT.patientId, patientId),
          ne(appointmentsT.status, "cancelled"),
          isNull(appointmentsT.scheduledAt),
        ),
      )
      .orderBy(desc(appointmentsT.createdAt))
      .limit(AWAITING_LIMIT),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentsT)
      .where(
        and(
          eq(appointmentsT.patientId, patientId),
          ne(appointmentsT.status, "cancelled"),
        ),
      ),
  ]);
  const apptsTotalCount = apptsCountRes[0]?.count ?? null;

  const apptsData: ApptJoinRow[] = [...futureRes, ...pastRes, ...awaitingRes];

  // Latest session per appointment.
  const apptIds = apptsData.map((a) => a.id);
  const latestSessionByAppt: Record<string, { id: string; status: string }> =
    {};

  const [sessionsForApptsRes, onDemandRes] = await Promise.all([
    apptIds.length > 0
      ? db
          .select({
            id: sessionsT.id,
            status: sessionsT.status,
            appointment_id: sessionsT.appointmentId,
            created_at: sessionsT.createdAt,
          })
          .from(sessionsT)
          .where(inArray(sessionsT.appointmentId, apptIds))
          .orderBy(desc(sessionsT.createdAt))
      : Promise.resolve([] as Array<{
          id: string;
          status: string;
          appointment_id: string | null;
          created_at: string;
        }>),
    db
      .select({
        id: sessionsT.id,
        status: sessionsT.status,
        session_started_at: sessionsT.sessionStartedAt,
        session_ended_at: sessionsT.sessionEndedAt,
        created_at: sessionsT.createdAt,
        location_id: sessionsT.locationId,
        room_id: sessionsT.roomId,
        appointment_id: sessionsT.appointmentId,
        location_timezone: locationsT.timezone,
        room_name: roomsT.name,
      })
      .from(sessionParticipants)
      .innerJoin(sessionsT, eq(sessionsT.id, sessionParticipants.sessionId))
      .leftJoin(locationsT, eq(locationsT.id, sessionsT.locationId))
      .leftJoin(roomsT, eq(roomsT.id, sessionsT.roomId))
      .where(
        and(
          eq(sessionParticipants.patientId, patientId),
          isNull(sessionsT.appointmentId),
        ),
      )
      .orderBy(desc(sessionsT.createdAt))
      .limit(ON_DEMAND_LIMIT),
  ]);

  for (const s of sessionsForApptsRes) {
    if (s.appointment_id && !latestSessionByAppt[s.appointment_id]) {
      latestSessionByAppt[s.appointment_id] = { id: s.id, status: s.status };
    }
  }

  const onDemandData = onDemandRes;
  // On-demand total count: the previous Supabase head-count was over the same
  // filtered set, capped by limit; mirror by using the returned length.
  const onDemandTotalCount = onDemandRes.length;

  const now = new Date();

  const apptCandidates: AppointmentRow[] = apptsData.map((a) => {
    const latestSession = latestSessionByAppt[a.id] ?? null;

    let bucket: Bucket;
    if (!a.scheduled_at) {
      bucket = "awaiting_scheduling";
    } else {
      bucket = bucketByLocalDay(a.scheduled_at, a.location_timezone ?? null, now);
    }

    return {
      appointment_id: a.id,
      session_id: latestSession?.id ?? null,
      scheduled_at: a.scheduled_at,
      created_at: a.created_at,
      type_name: a.type_name ?? null,
      room_name: a.room_name ?? null,
      modality: a.modality ?? null,
      appointment_status: a.status,
      session_status: latestSession?.status ?? null,
      bucket,
      location_timezone: a.location_timezone ?? null,
    };
  });

  const onDemandCandidates: AppointmentRow[] = [];
  for (const session of onDemandData) {
    const placementInstant = session.session_started_at ?? session.created_at;
    const bucket: Bucket = bucketByLocalDay(
      placementInstant,
      session.location_timezone ?? null,
      now,
    );

    onDemandCandidates.push({
      appointment_id: null,
      session_id: session.id,
      scheduled_at: session.session_started_at,
      created_at: session.created_at,
      type_name: "On-demand",
      room_name: session.room_name ?? null,
      modality: "telehealth",
      appointment_status: null,
      session_status: session.status,
      bucket,
      location_timezone: session.location_timezone ?? null,
    });
  }

  const combined = [...apptCandidates, ...onDemandCandidates];

  const buckets: Record<Bucket, AppointmentRow[]> = {
    upcoming: [],
    today: [],
    past: [],
    awaiting_scheduling: [],
  };
  for (const row of combined) buckets[row.bucket].push(row);

  buckets.upcoming.sort((a, b) =>
    (a.scheduled_at ?? a.created_at ?? "").localeCompare(
      b.scheduled_at ?? b.created_at ?? "",
    ),
  );
  buckets.today.sort((a, b) => {
    if (a.scheduled_at && !b.scheduled_at) return -1;
    if (!a.scheduled_at && b.scheduled_at) return 1;
    if (a.scheduled_at && b.scheduled_at)
      return a.scheduled_at.localeCompare(b.scheduled_at);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
  buckets.past.sort((a, b) =>
    (b.scheduled_at ?? b.created_at ?? "").localeCompare(
      a.scheduled_at ?? a.created_at ?? "",
    ),
  );
  buckets.awaiting_scheduling.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  const isActiveRow = (row: AppointmentRow): boolean => {
    if (activeAppointmentId && row.appointment_id === activeAppointmentId)
      return true;
    if (
      !activeAppointmentId &&
      activeSessionId &&
      row.session_id === activeSessionId
    ) {
      return true;
    }
    return false;
  };
  for (const key of Object.keys(buckets) as Bucket[]) {
    const idx = buckets[key].findIndex(isActiveRow);
    if (idx > 0) {
      const [active] = buckets[key].splice(idx, 1);
      buckets[key].unshift(active);
    }
  }

  const haveActiveInBuckets =
    buckets.upcoming.some(isActiveRow) ||
    buckets.today.some(isActiveRow) ||
    buckets.past.some(isActiveRow) ||
    buckets.awaiting_scheduling.some(isActiveRow);

  if (!haveActiveInBuckets && (activeAppointmentId || activeSessionId)) {
    let extra: AppointmentRow | null = null;
    if (activeAppointmentId) {
      extra = await fetchAppointmentById(
        activeAppointmentId,
        patientId,
        now,
      );
    } else if (activeSessionId) {
      extra = await fetchOnDemandSessionById(
        activeSessionId,
        patientId,
        now,
      );
    }
    if (extra) {
      buckets[extra.bucket].unshift(extra);
    }
  }

  const orderedAll = [
    ...buckets.upcoming,
    ...buckets.today,
    ...buckets.past,
    ...buckets.awaiting_scheduling,
  ];

  let appointments = orderedAll.slice(0, TIMELINE_CAP);
  if (
    !appointments.some(isActiveRow) &&
    (activeAppointmentId || activeSessionId)
  ) {
    const fullActive = orderedAll.find(isActiveRow);
    if (fullActive) {
      const insertionPoint = findBucketInsertionIndex(
        appointments,
        fullActive.bucket,
      );
      appointments = [
        ...appointments.slice(0, insertionPoint),
        fullActive,
        ...appointments.slice(insertionPoint),
      ].slice(0, TIMELINE_CAP);
    }
  }

  const totalAppointmentCount =
    (apptsTotalCount ?? apptCandidates.length) +
    (onDemandTotalCount ?? onDemandCandidates.length);

  return {
    appointments,
    total_appointment_count: totalAppointmentCount,
    form_assignments: formAssignments_,
    form_submissions: formSubmissions_,
    form_history_truncated: formHistoryTruncated,
  };
}

// Shared select shape for appointment timeline rows. Joins type/room/location
// and aliases the nested columns flat, matching the old APPT_SELECT relation
// pick.
const APPT_SELECT = {
  id: appointmentsT.id,
  scheduled_at: appointmentsT.scheduledAt,
  status: appointmentsT.status,
  created_at: appointmentsT.createdAt,
  type_name: appointmentTypes.name,
  modality: appointmentTypes.modality,
  room_name: roomsT.name,
  location_timezone: locationsT.timezone,
};

// Find the position to insert a row of `bucket` so the array stays in
// (upcoming → today → past → awaiting_scheduling) display order.
function findBucketInsertionIndex(
  rows: AppointmentRow[],
  bucket: Bucket,
): number {
  const targetRank = BUCKET_DISPLAY_ORDER.indexOf(bucket);
  for (let i = 0; i < rows.length; i++) {
    const rowRank = BUCKET_DISPLAY_ORDER.indexOf(rows[i].bucket);
    if (rowRank > targetRank) return i;
  }
  return rows.length;
}

// Fetch + map a single appointment by ID, used to force-include the active
// row when it falls outside the regular candidate window.
//
// Critical: the appointmentId is caller-supplied via query param. We MUST
// filter by patient_id so a caller authorised for one patient can't pull
// arbitrary appointments belonging to other patients. The patient_id has
// already been authorised by assertStaffCanAccessPatient at the route entry,
// so this filter implicitly scopes the lookup to the caller's org.
async function fetchAppointmentById(
  appointmentId: string,
  patientId: string,
  now: Date,
): Promise<AppointmentRow | null> {
  const [a] = await db
    .select(APPT_SELECT)
    .from(appointmentsT)
    .leftJoin(appointmentTypes, eq(appointmentTypes.id, appointmentsT.appointmentTypeId))
    .leftJoin(roomsT, eq(roomsT.id, appointmentsT.roomId))
    .leftJoin(locationsT, eq(locationsT.id, appointmentsT.locationId))
    .where(
      and(
        eq(appointmentsT.id, appointmentId),
        eq(appointmentsT.patientId, patientId),
        ne(appointmentsT.status, "cancelled"),
      ),
    )
    .limit(1);

  if (!a) return null;

  const [latestSession] = await db
    .select({
      id: sessionsT.id,
      status: sessionsT.status,
      created_at: sessionsT.createdAt,
    })
    .from(sessionsT)
    .where(eq(sessionsT.appointmentId, a.id))
    .orderBy(desc(sessionsT.createdAt))
    .limit(1);

  const bucket: Bucket = a.scheduled_at
    ? bucketByLocalDay(a.scheduled_at, a.location_timezone ?? null, now)
    : "awaiting_scheduling";

  return {
    appointment_id: a.id,
    session_id: latestSession?.id ?? null,
    scheduled_at: a.scheduled_at,
    created_at: a.created_at,
    type_name: a.type_name ?? null,
    room_name: a.room_name ?? null,
    modality: a.modality ?? null,
    appointment_status: a.status,
    session_status: latestSession?.status ?? null,
    bucket,
    location_timezone: a.location_timezone ?? null,
  };
}

// Same access-control reasoning as fetchAppointmentById: sessionId is
// caller-supplied via query param, so we must prove the session participates
// the authorised patient before returning row metadata.
async function fetchOnDemandSessionById(
  sessionId: string,
  patientId: string,
  now: Date,
): Promise<AppointmentRow | null> {
  const [participation] = await db
    .select({ session_id: sessionParticipants.sessionId })
    .from(sessionParticipants)
    .where(
      and(
        eq(sessionParticipants.sessionId, sessionId),
        eq(sessionParticipants.patientId, patientId),
      ),
    )
    .limit(1);
  if (!participation) return null;

  const [s] = await db
    .select({
      id: sessionsT.id,
      status: sessionsT.status,
      session_started_at: sessionsT.sessionStartedAt,
      session_ended_at: sessionsT.sessionEndedAt,
      created_at: sessionsT.createdAt,
      location_id: sessionsT.locationId,
      room_id: sessionsT.roomId,
      appointment_id: sessionsT.appointmentId,
      location_timezone: locationsT.timezone,
      room_name: roomsT.name,
    })
    .from(sessionsT)
    .leftJoin(locationsT, eq(locationsT.id, sessionsT.locationId))
    .leftJoin(roomsT, eq(roomsT.id, sessionsT.roomId))
    .where(
      and(eq(sessionsT.id, sessionId), isNull(sessionsT.appointmentId)),
    )
    .limit(1);

  if (!s) return null;

  const placementInstant = s.session_started_at ?? s.created_at;
  const bucket: Bucket = bucketByLocalDay(
    placementInstant,
    s.location_timezone ?? null,
    now,
  );

  return {
    appointment_id: null,
    session_id: s.id,
    scheduled_at: s.session_started_at,
    created_at: s.created_at,
    type_name: "On-demand",
    room_name: s.room_name ?? null,
    modality: "telehealth",
    appointment_status: null,
    session_status: s.status,
    bucket,
    location_timezone: s.location_timezone ?? null,
  };
}
