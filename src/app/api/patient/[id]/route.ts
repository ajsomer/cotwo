import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { assertStaffCanAccessPatient } from "@/lib/auth/staff-access";
import { bucketByLocalDay, type DayBucket } from "@/lib/datetime/timezone-bucket";

// Split candidate fetching into future-asc + past-desc + awaiting (null
// scheduled_at) so each bucket has its own candidate budget. Without the
// awaiting split, "past + null" ordered by scheduled_at DESC NULLS LAST
// queues null-scheduled rows behind every past row before the limit,
// effectively hiding them whenever a patient has more than N past rows.
const FUTURE_LIMIT = 15;
const PAST_LIMIT = 15;
const AWAITING_LIMIT = 5;
const ON_DEMAND_LIMIT = 30;
const TIMELINE_CAP = 10;

type Bucket = DayBucket | "awaiting_scheduling";

interface AppointmentRow {
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

/**
 * GET /api/patient/:id?session_id=xxx
 * Patient details for the contact card. Staff-only; org-scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const activeAppointmentId = request.nextUrl.searchParams.get("appointment_id");
  const activeSessionId = request.nextUrl.searchParams.get("session_id");
  const supabase = createServiceClient();

  const access = await assertStaffCanAccessPatient(supabase, patientId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthenticated" : "Patient not found" },
      { status: access.status },
    );
  }

  const [patientRes, phonesRes, cardsRes] = await Promise.all([
    supabase
      .from("patients")
      .select("id, first_name, last_name, date_of_birth")
      .eq("id", patientId)
      .single(),
    supabase
      .from("patient_phone_numbers")
      .select("phone_number, is_primary")
      .eq("patient_id", patientId)
      .order("is_primary", { ascending: false }),
    supabase
      .from("payment_methods")
      .select("card_brand, card_last_four, card_expiry, is_default")
      .eq("patient_id", patientId)
      .order("is_default", { ascending: false }),
  ]);

  if (patientRes.error || !patientRes.data) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  // ------------------------------------------------------------
  // Form assignments + form submissions (merged client-side by submission_id)
  // ------------------------------------------------------------
  const [formAssignmentsRes, formSubmissionsRes] = await Promise.all([
    supabase
      .from("form_assignments")
      .select("id, form_id, appointment_id, status, sent_at, completed_at, created_at, submission_id")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("form_submissions")
      .select("id, form_id, appointment_id, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false }),
  ]);
  const formAssignmentsData = formAssignmentsRes.data;
  const formSubmissionsData = formSubmissionsRes.data;

  const formIds = new Set<string>();
  (formAssignmentsData ?? []).forEach((a) => formIds.add(a.form_id));
  (formSubmissionsData ?? []).forEach((s) => formIds.add(s.form_id));

  let formNameMap: Record<string, string> = {};
  if (formIds.size > 0) {
    const { data: formsData } = await supabase
      .from("forms")
      .select("id, name")
      .in("id", [...formIds]);
    if (formsData) {
      formNameMap = Object.fromEntries(formsData.map((f) => [f.id, f.name]));
    }
  }

  // For intake-package submission rows, look up the journey's per-form
  // completion timestamp so we can resolve completed_at properly.
  const submissionAppointmentIds = [
    ...new Set((formSubmissionsData ?? []).map((s) => s.appointment_id).filter((id): id is string => !!id)),
  ];
  let journeyByAppointment: Record<string, { forms_completed: Record<string, string> | null }> = {};
  if (submissionAppointmentIds.length > 0) {
    const { data: journeys } = await supabase
      .from("intake_package_journeys")
      .select("appointment_id, forms_completed")
      .in("appointment_id", submissionAppointmentIds);
    if (journeys) {
      journeyByAppointment = Object.fromEntries(
        journeys.map((j) => [j.appointment_id, { forms_completed: (j.forms_completed as Record<string, string>) ?? null }]),
      );
    }
  }

  const formAssignments = (formAssignmentsData ?? []).map((a) => ({
    id: a.id,
    form_id: a.form_id,
    appointment_id: a.appointment_id,
    form_name: formNameMap[a.form_id] ?? "Unknown form",
    status: a.status,
    sent_at: a.sent_at,
    completed_at: a.completed_at,
    created_at: a.created_at,
    submission_id: a.submission_id,
  }));

  const formSubmissions = (formSubmissionsData ?? []).map((s) => {
    const journey = s.appointment_id ? journeyByAppointment[s.appointment_id] : undefined;
    const journeyCompleted = journey?.forms_completed?.[s.form_id] ?? null;
    return {
      submission_id: s.id,
      form_id: s.form_id,
      appointment_id: s.appointment_id,
      form_name: formNameMap[s.form_id] ?? "Unknown form",
      completed_at: journeyCompleted ?? s.created_at,
      created_at: s.created_at,
    };
  });

  // ------------------------------------------------------------
  // Unified appointments timeline
  // ------------------------------------------------------------
  const nowIso = new Date().toISOString();
  const apptSelect = `
    id, scheduled_at, status, created_at,
    appointment_types ( name, modality ),
    rooms!appointments_room_id_fkey ( name ),
    locations ( timezone )
  `;
  // Future appointments (scheduled_at >= now) — soonest first, so the cap
  // truncates far-future rows rather than near-future ones.
  const [futureRes, pastRes, awaitingRes, apptsCountRes] = await Promise.all([
    supabase
      .from("appointments")
      .select(apptSelect)
      .eq("patient_id", patientId)
      .neq("status", "cancelled")
      .gte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(FUTURE_LIMIT),
    // Past appointments (scheduled_at < now) — most-recent first.
    supabase
      .from("appointments")
      .select(apptSelect)
      .eq("patient_id", patientId)
      .neq("status", "cancelled")
      .lt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: false })
      .limit(PAST_LIMIT),
    // Awaiting-scheduling rows (scheduled_at IS NULL) — most-recently created
    // first. Separate query so they don't queue behind past rows under a
    // shared limit.
    supabase
      .from("appointments")
      .select(apptSelect)
      .eq("patient_id", patientId)
      .neq("status", "cancelled")
      .is("scheduled_at", null)
      .order("created_at", { ascending: false })
      .limit(AWAITING_LIMIT),
    // Total count for the truncation footer.
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .neq("status", "cancelled"),
  ]);
  const apptsTotalCount = apptsCountRes.count;

  const apptsData = [
    ...(futureRes.data ?? []),
    ...(pastRes.data ?? []),
    ...(awaitingRes.data ?? []),
  ];

  // Latest session per appointment (correlated subquery isn't supported via
  // PostgREST nesting, so do a separate fetch and map).
  const apptIds = apptsData.map((a) => a.id);
  const latestSessionByAppt: Record<string, { id: string; status: string }> = {};

  const [sessionsForApptsRes, onDemandRes] = await Promise.all([
    apptIds.length > 0
      ? supabase
          .from("sessions")
          .select("id, status, appointment_id, created_at")
          .in("appointment_id", apptIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    // On-demand sessions (sessions without appointments)
    supabase
      .from("session_participants")
      .select(
        `
        sessions!inner (
          id, status, session_started_at, session_ended_at, created_at, location_id, room_id, appointment_id,
          locations ( timezone ),
          rooms ( name )
        )
      `,
        { count: "exact" },
      )
      .eq("patient_id", patientId)
      .is("sessions.appointment_id", null)
      .order("created_at", { ascending: false, referencedTable: "sessions" })
      .limit(ON_DEMAND_LIMIT),
  ]);

  for (const s of sessionsForApptsRes.data ?? []) {
    if (s.appointment_id && !latestSessionByAppt[s.appointment_id]) {
      latestSessionByAppt[s.appointment_id] = { id: s.id, status: s.status };
    }
  }

  const onDemandData = onDemandRes.data;
  const onDemandTotalCount = onDemandRes.count;

  const now = new Date();

  const apptCandidates: AppointmentRow[] = (apptsData ?? []).map((a) => {
    const apptType = (Array.isArray(a.appointment_types) ? a.appointment_types[0] : a.appointment_types) as
      | { name: string | null; modality: "telehealth" | "in_person" | null }
      | null;
    const room = (Array.isArray(a.rooms) ? a.rooms[0] : a.rooms) as { name: string | null } | null;
    const location = (Array.isArray(a.locations) ? a.locations[0] : a.locations) as { timezone: string | null } | null;
    const latestSession = latestSessionByAppt[a.id] ?? null;

    let bucket: Bucket;
    if (!a.scheduled_at) {
      // Appointment-driven rows with no scheduled_at always go to awaiting_scheduling,
      // regardless of created_at. Never bucketed as today.
      bucket = "awaiting_scheduling";
    } else {
      bucket = bucketByLocalDay(a.scheduled_at, location?.timezone ?? null, now);
    }

    return {
      appointment_id: a.id,
      session_id: latestSession?.id ?? null,
      scheduled_at: a.scheduled_at,
      created_at: a.created_at,
      type_name: apptType?.name ?? null,
      room_name: room?.name ?? null,
      modality: apptType?.modality ?? null,
      appointment_status: a.status,
      session_status: latestSession?.status ?? null,
      bucket,
      location_timezone: location?.timezone ?? null,
    };
  });

  const onDemandCandidates: AppointmentRow[] = [];
  for (const row of onDemandData ?? []) {
    const session = (Array.isArray(row.sessions) ? row.sessions[0] : row.sessions) as {
      id: string;
      status: string;
      session_started_at: string | null;
      session_ended_at: string | null;
      created_at: string;
      location_id: string | null;
      room_id: string | null;
      appointment_id: string | null;
      locations: { timezone: string | null } | { timezone: string | null }[] | null;
      rooms: { name: string | null } | { name: string | null }[] | null;
    } | null;
    if (!session) continue;

    const location = (Array.isArray(session.locations) ? session.locations[0] : session.locations) as
      | { timezone: string | null }
      | null;
    const room = (Array.isArray(session.rooms) ? session.rooms[0] : session.rooms) as { name: string | null } | null;

    // Synthetic on-demand rows fall back to session_started_at ?? created_at
    // for placement. created_at is always present.
    const placementInstant = session.session_started_at ?? session.created_at;
    const bucket: Bucket = bucketByLocalDay(placementInstant, location?.timezone ?? null, now);

    onDemandCandidates.push({
      appointment_id: null,
      session_id: session.id,
      scheduled_at: session.session_started_at,
      created_at: session.created_at,
      type_name: "On-demand",
      room_name: room?.name ?? null,
      modality: "telehealth",
      appointment_status: null,
      session_status: session.status,
      bucket,
      location_timezone: location?.timezone ?? null,
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

  // upcoming: soonest-first
  buckets.upcoming.sort((a, b) =>
    (a.scheduled_at ?? a.created_at ?? "").localeCompare(b.scheduled_at ?? b.created_at ?? ""),
  );
  // today: timed rows ascending (the slide-out floats the active row to top
  // separately, since the API doesn't know which row is active).
  buckets.today.sort((a, b) => {
    if (a.scheduled_at && !b.scheduled_at) return -1;
    if (!a.scheduled_at && b.scheduled_at) return 1;
    if (a.scheduled_at && b.scheduled_at) return a.scheduled_at.localeCompare(b.scheduled_at);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
  // past: most-recent-first
  buckets.past.sort((a, b) =>
    (b.scheduled_at ?? b.created_at ?? "").localeCompare(a.scheduled_at ?? a.created_at ?? ""),
  );
  // awaiting_scheduling: most-recently-created-first
  buckets.awaiting_scheduling.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  // Active-row hoist: float the active row (matched by appointment_id, or by
  // session_id for on-demand) to the top of its bucket. Guarantees the row
  // survives the cap and renders first in its bucket on the client.
  const isActiveRow = (row: AppointmentRow): boolean => {
    if (activeAppointmentId && row.appointment_id === activeAppointmentId) return true;
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

  // Force-include the active row if it isn't already in any bucket. This
  // happens when the patient has many far-future bookings and the active
  // row falls outside the regular candidate window. We add it to its bucket
  // (at the front, since the active row always renders first within its
  // bucket), then re-assemble buckets in display order.
  const haveActiveInBuckets =
    buckets.upcoming.some(isActiveRow) ||
    buckets.today.some(isActiveRow) ||
    buckets.past.some(isActiveRow) ||
    buckets.awaiting_scheduling.some(isActiveRow);

  if (!haveActiveInBuckets && (activeAppointmentId || activeSessionId)) {
    let extra: AppointmentRow | null = null;
    if (activeAppointmentId) {
      extra = await fetchAppointmentById(supabase, activeAppointmentId, patientId, now);
    } else if (activeSessionId) {
      extra = await fetchOnDemandSessionById(supabase, activeSessionId, patientId, now);
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
  // If the active row was pre-existing in a bucket but landed past position
  // 9, drop the last row and prepend it within its own bucket section. We
  // do this in two passes: first verify presence, then if missing, look at
  // orderedAll for the row and surgically insert it.
  if (!appointments.some(isActiveRow) && (activeAppointmentId || activeSessionId)) {
    const fullActive = orderedAll.find(isActiveRow);
    if (fullActive) {
      const insertionPoint = findBucketInsertionIndex(appointments, fullActive.bucket);
      appointments = [
        ...appointments.slice(0, insertionPoint),
        fullActive,
        ...appointments.slice(insertionPoint),
      ].slice(0, TIMELINE_CAP);
    }
  }

  // Combined timeline count: appointment rows (excluding cancelled) + on-demand sessions.
  // Postgres returns count even when the row payload is limited.
  const totalAppointmentCount = (apptsTotalCount ?? apptCandidates.length) + (onDemandTotalCount ?? onDemandCandidates.length);

  return NextResponse.json({
    patient: patientRes.data,
    phone_numbers: phonesRes.data ?? [],
    payment_methods: cardsRes.data ?? [],
    appointments,
    total_appointment_count: totalAppointmentCount,
    form_assignments: formAssignments,
    form_submissions: formSubmissions,
  });
}

// Bucket display order — must stay in sync with the orderedAll concat order.
const BUCKET_DISPLAY_ORDER: Bucket[] = [
  "upcoming",
  "today",
  "past",
  "awaiting_scheduling",
];

// Find the position to insert a row of `bucket` so the array stays in
// (upcoming → today → past → awaiting_scheduling) display order. Returns
// the index of the first row whose bucket is later in the order than
// `bucket`, or the array length if all existing rows are earlier or same.
function findBucketInsertionIndex(rows: AppointmentRow[], bucket: Bucket): number {
  const targetRank = BUCKET_DISPLAY_ORDER.indexOf(bucket);
  for (let i = 0; i < rows.length; i++) {
    const rowRank = BUCKET_DISPLAY_ORDER.indexOf(rows[i].bucket);
    if (rowRank > targetRank) return i;
  }
  return rows.length;
}

// Fetch + map a single appointment by ID, used to force-include the active
// row when it falls outside the regular candidate window. Same column shape
// as the inline candidate query so the row renders identically client-side.
//
// Critical: the appointmentId is caller-supplied via query param. We MUST
// filter by patient_id so a caller authorised for one patient can't pull
// arbitrary appointments belonging to other patients. The patient_id has
// already been authorised by assertStaffCanAccessPatient at the route
// entry, so this filter implicitly scopes the lookup to the caller's org.
async function fetchAppointmentById(
  supabase: SupabaseClient,
  appointmentId: string,
  patientId: string,
  now: Date,
): Promise<AppointmentRow | null> {
  const { data: a } = await supabase
    .from("appointments")
    .select(
      `id, scheduled_at, status, created_at,
       appointment_types ( name, modality ),
       rooms!appointments_room_id_fkey ( name ),
       locations ( timezone )`,
    )
    .eq("id", appointmentId)
    .eq("patient_id", patientId)
    .neq("status", "cancelled")
    .maybeSingle();

  if (!a) return null;

  const apptType = (Array.isArray(a.appointment_types) ? a.appointment_types[0] : a.appointment_types) as
    | { name: string | null; modality: "telehealth" | "in_person" | null }
    | null;
  const room = (Array.isArray(a.rooms) ? a.rooms[0] : a.rooms) as { name: string | null } | null;
  const location = (Array.isArray(a.locations) ? a.locations[0] : a.locations) as { timezone: string | null } | null;

  const { data: latestSession } = await supabase
    .from("sessions")
    .select("id, status, created_at")
    .eq("appointment_id", a.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const bucket: Bucket = a.scheduled_at
    ? bucketByLocalDay(a.scheduled_at, location?.timezone ?? null, now)
    : "awaiting_scheduling";

  return {
    appointment_id: a.id,
    session_id: latestSession?.id ?? null,
    scheduled_at: a.scheduled_at,
    created_at: a.created_at,
    type_name: apptType?.name ?? null,
    room_name: room?.name ?? null,
    modality: apptType?.modality ?? null,
    appointment_status: a.status,
    session_status: latestSession?.status ?? null,
    bucket,
    location_timezone: location?.timezone ?? null,
  };
}

// Same access-control reasoning as fetchAppointmentById: sessionId is
// caller-supplied via query param, so we must prove the session participates
// the authorised patient before returning row metadata.
async function fetchOnDemandSessionById(
  supabase: SupabaseClient,
  sessionId: string,
  patientId: string,
  now: Date,
): Promise<AppointmentRow | null> {
  // Membership check first: confirm the session has this patient on it.
  const { data: participation } = await supabase
    .from("session_participants")
    .select("session_id")
    .eq("session_id", sessionId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!participation) return null;

  const { data: s } = await supabase
    .from("sessions")
    .select(
      `id, status, session_started_at, session_ended_at, created_at, location_id, room_id, appointment_id,
       locations ( timezone ),
       rooms ( name )`,
    )
    .eq("id", sessionId)
    .is("appointment_id", null)
    .maybeSingle();

  if (!s) return null;

  const location = (Array.isArray(s.locations) ? s.locations[0] : s.locations) as { timezone: string | null } | null;
  const room = (Array.isArray(s.rooms) ? s.rooms[0] : s.rooms) as { name: string | null } | null;

  const placementInstant = s.session_started_at ?? s.created_at;
  const bucket: Bucket = bucketByLocalDay(placementInstant, location?.timezone ?? null, now);

  return {
    appointment_id: null,
    session_id: s.id,
    scheduled_at: s.session_started_at,
    created_at: s.created_at,
    type_name: "On-demand",
    room_name: room?.name ?? null,
    modality: "telehealth",
    appointment_status: null,
    session_status: s.status,
    bucket,
    location_timezone: location?.timezone ?? null,
  };
}
