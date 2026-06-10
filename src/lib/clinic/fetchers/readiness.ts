import { cache } from "react";
import { db } from "@/lib/db";
import {
  appointmentWorkflowRuns,
  appointments as appointmentsT,
  appointmentActions,
  patients as patientsT,
  users as usersT,
  patientPhoneNumbers,
  forms as formsT,
  rooms as roomsT,
  appointmentTypes,
  workflowTemplates,
  intakePackageJourneys,
  formAssignments,
  formSubmissions,
} from "@/lib/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  getReadinessPriority,
  sortByPriority,
  getMostRecentActionUpdate,
  TERMINAL_STATUSES,
  RECENTLY_COMPLETED_RETENTION_MS,
  type ReadinessPriority,
} from "@/lib/readiness/derived-state";
import {
  enrichActionRows,
  type EnrichedWorkflowAction,
} from "./enrich-actions";
import type {
  CompletedFormSubmission,
  ReadinessAppointment,
  ReadinessCounts,
} from "@/stores/clinic-store";

export type ReadinessDirection = "pre_appointment" | "post_appointment";

export interface ReadinessSlice {
  appointments: ReadinessAppointment[];
  counts: ReadinessCounts;
}

/**
 * Build the readiness dashboard payload for one location + direction.
 * Staged pipeline:
 *   1. fetchActiveRunPartition — active workflow runs, partitioned by direction
 *   2. fetchRunAppointments    — the appointments those runs belong to
 *   3. fetchRunActionRows      — raw appointment_actions for the runs
 *      + enrichActionRows      — shared enrichment (labels, forms, pathways)
 *   4. hydrateAppointmentLookups — patient/clinician/room/type/journey maps
 *   5. buildCompletedSubmissions — completed form submissions per appointment
 *   6. buildReadinessAppointments — pure grouping into per-appointment rows
 *   7. finalise: priority derivation, retention filter, priority sort
 */
export const fetchReadinessSlice = cache(async (
  locationId: string,
  direction: ReadinessDirection
): Promise<ReadinessSlice> => {
  const now = new Date();

  const { runsByAppointment, templateIdsByAppointment, counts } =
    await fetchActiveRunPartition(locationId, direction);

  if (runsByAppointment.size === 0) {
    return { appointments: [], counts };
  }

  const appointmentsData = await fetchRunAppointments(
    [...runsByAppointment.keys()],
    locationId
  );
  if (appointmentsData.length === 0) {
    return { appointments: [], counts };
  }

  const locationApptIds = appointmentsData.map((a) => a.id);
  const runIds = locationApptIds.flatMap((id) => runsByAppointment.get(id) ?? []);

  const [actionRows, lookups] = await Promise.all([
    fetchRunActionRows(runIds),
    hydrateAppointmentLookups(appointmentsData, [
      ...new Set([...templateIdsByAppointment.values()]),
    ]),
  ]);

  const [enrichedActions, completedSubsByAppt] = await Promise.all([
    enrichActionRows(actionRows),
    buildCompletedSubmissions(locationApptIds, lookups.journeyMap),
  ]);

  const grouped = buildReadinessAppointments({
    appointmentsData,
    enrichedActions,
    lookups,
    templateIdsByAppointment,
    completedSubsByAppt,
  });

  // Finalise: derive priority, drop stale recently-completed rows, sort.
  const result: GroupedAppointment[] = [];
  for (const appt of grouped) {
    appt.priority = getReadinessPriority(appt as Parameters<typeof getReadinessPriority>[0], now);

    if (appt.priority === "recently_completed") {
      const mostRecentUpdate = getMostRecentActionUpdate(appt.actions);
      if (mostRecentUpdate && now.getTime() - mostRecentUpdate > RECENTLY_COMPLETED_RETENTION_MS) {
        continue;
      }
    }

    result.push(appt);
  }

  const sorted = sortByPriority(result as Parameters<typeof sortByPriority>[0], now);

  return { appointments: sorted as ReadinessAppointment[], counts };
});

// ---------------------------------------------------------------------------
// Stage 1: active workflow runs for the location, partitioned by direction
// ---------------------------------------------------------------------------

interface RunPartition {
  /** Active run ids per appointment, for the requested direction. */
  runsByAppointment: Map<string, string[]>;
  /** Workflow template id per appointment (last run wins, matching legacy). */
  templateIdsByAppointment: Map<string, string>;
  counts: ReadinessCounts;
}

async function fetchActiveRunPartition(
  locationId: string,
  direction: ReadinessDirection
): Promise<RunPartition> {
  // Active runs for THIS location only — scoped via the appointment's
  // location (inner join). One query covers both directions; we partition in
  // memory. This is a correctness fix: previously runs/counts weren't
  // location-scoped, so the count badges leaked other locations' workflow
  // runs in multi-location orgs.
  const allRuns = await db
    .select({
      id: appointmentWorkflowRuns.id,
      appointment_id: appointmentWorkflowRuns.appointmentId,
      workflow_template_id: appointmentWorkflowRuns.workflowTemplateId,
      direction: appointmentWorkflowRuns.direction,
      status: appointmentWorkflowRuns.status,
    })
    .from(appointmentWorkflowRuns)
    .innerJoin(
      appointmentsT,
      eq(appointmentsT.id, appointmentWorkflowRuns.appointmentId)
    )
    .where(
      and(
        eq(appointmentWorkflowRuns.status, "active"),
        eq(appointmentsT.locationId, locationId)
      )
    );

  const oppositeDirection: ReadinessDirection =
    direction === "pre_appointment" ? "post_appointment" : "pre_appointment";

  const runsByAppointment = new Map<string, string[]>();
  const templateIdsByAppointment = new Map<string, string>();
  const oppositeAppointments = new Set<string>();
  for (const run of allRuns ?? []) {
    if (run.direction === direction) {
      const list = runsByAppointment.get(run.appointment_id) ?? [];
      list.push(run.id);
      runsByAppointment.set(run.appointment_id, list);
      templateIdsByAppointment.set(run.appointment_id, run.workflow_template_id);
    } else if (run.direction === oppositeDirection) {
      oppositeAppointments.add(run.appointment_id);
    }
  }
  const oppositeApptCount = oppositeAppointments.size;

  // Counts are per-appointment (an appointment with N runs counts once),
  // matching runsByAppointment.size for the active direction.
  const counts: ReadinessCounts = {
    pre: direction === "pre_appointment" ? runsByAppointment.size : oppositeApptCount,
    post: direction === "post_appointment" ? runsByAppointment.size : oppositeApptCount,
  };

  return { runsByAppointment, templateIdsByAppointment, counts };
}

// ---------------------------------------------------------------------------
// Stage 2: the appointments those runs belong to (re-scoped to the location)
// ---------------------------------------------------------------------------

async function fetchRunAppointments(appointmentIds: string[], locationId: string) {
  return db
    .select({
      id: appointmentsT.id,
      scheduled_at: appointmentsT.scheduledAt,
      patient_id: appointmentsT.patientId,
      clinician_id: appointmentsT.clinicianId,
      location_id: appointmentsT.locationId,
      phone_number: appointmentsT.phoneNumber,
      room_id: appointmentsT.roomId,
      appointment_type_id: appointmentsT.appointmentTypeId,
    })
    .from(appointmentsT)
    .where(
      and(
        inArray(appointmentsT.id, appointmentIds),
        eq(appointmentsT.locationId, locationId)
      )
    );
}

type AppointmentRow = Awaited<ReturnType<typeof fetchRunAppointments>>[number];

// ---------------------------------------------------------------------------
// Stage 3: raw action rows for the runs (enriched via the shared module)
// ---------------------------------------------------------------------------

async function fetchRunActionRows(runIds: string[]) {
  if (runIds.length === 0) return [];
  return db
    .select({
      id: appointmentActions.id,
      appointment_id: appointmentActions.appointmentId,
      action_block_id: appointmentActions.actionBlockId,
      status: appointmentActions.status,
      scheduled_for: appointmentActions.scheduledFor,
      fired_at: appointmentActions.firedAt,
      completed_at: appointmentActions.completedAt,
      error_message: appointmentActions.errorMessage,
      updated_at: appointmentActions.updatedAt,
      session_id: appointmentActions.sessionId,
      config: appointmentActions.config,
      form_id: appointmentActions.formId,
      resolved_at: appointmentActions.resolvedAt,
      resolved_by: appointmentActions.resolvedBy,
      resolution_note: appointmentActions.resolutionNote,
    })
    .from(appointmentActions)
    .where(inArray(appointmentActions.workflowRunId, runIds));
}

// ---------------------------------------------------------------------------
// Stage 4: lookup maps for hydrating the grouped rows
// ---------------------------------------------------------------------------

type JourneyRow = {
  appointment_id: string;
  journey_token: string;
  status: string;
  form_ids: unknown;
  forms_completed: unknown;
  includes_card_capture: boolean;
  card_captured_at: string | null;
  includes_consent: boolean;
  consent_completed_at: string | null;
  created_at: string;
  completed_at: string | null;
};

interface AppointmentLookups {
  patientMap: Map<string, { id: string; first_name: string; last_name: string }>;
  clinicianMap: Map<string, string>;
  phoneMap: Map<string, string>;
  roomMap: Map<string, string>;
  typeMap: Map<string, string>;
  templateMap: Map<
    string,
    { id: string; terminal_type: string | null; at_risk_after_days: number | null; overdue_after_days: number | null }
  >;
  journeyMap: Map<string, JourneyRow>;
}

async function hydrateAppointmentLookups(
  appointmentsData: AppointmentRow[],
  templateIds: string[]
): Promise<AppointmentLookups> {
  const nonNull = (x: string | null): x is string => !!x;
  const patientIds = [...new Set(appointmentsData.map((a) => a.patient_id).filter(nonNull))];
  const clinicianIds = [...new Set(appointmentsData.map((a) => a.clinician_id).filter(nonNull))];
  const roomIds = [...new Set(appointmentsData.map((a) => a.room_id).filter(nonNull))];
  const typeIds = [...new Set(appointmentsData.map((a) => a.appointment_type_id).filter(nonNull))];
  const locationApptIds = appointmentsData.map((a) => a.id);

  const [patientsRes, cliniciansRes, phonesRes, roomsRes, typesRes, templatesRes, journeysRes] = await Promise.all([
    patientIds.length > 0
      ? db.select({ id: patientsT.id, first_name: patientsT.firstName, last_name: patientsT.lastName }).from(patientsT).where(inArray(patientsT.id, patientIds))
      : Promise.resolve([]),
    clinicianIds.length > 0
      ? db.select({ id: usersT.id, full_name: usersT.fullName }).from(usersT).where(inArray(usersT.id, clinicianIds))
      : Promise.resolve([]),
    patientIds.length > 0
      ? db.select({ patient_id: patientPhoneNumbers.patientId, phone_number: patientPhoneNumbers.phoneNumber }).from(patientPhoneNumbers).where(and(inArray(patientPhoneNumbers.patientId, patientIds), eq(patientPhoneNumbers.isPrimary, true)))
      : Promise.resolve([]),
    roomIds.length > 0
      ? db.select({ id: roomsT.id, name: roomsT.name }).from(roomsT).where(inArray(roomsT.id, roomIds))
      : Promise.resolve([]),
    typeIds.length > 0
      ? db.select({ id: appointmentTypes.id, name: appointmentTypes.name }).from(appointmentTypes).where(inArray(appointmentTypes.id, typeIds))
      : Promise.resolve([]),
    templateIds.length > 0
      ? db.select({ id: workflowTemplates.id, terminal_type: workflowTemplates.terminalType, at_risk_after_days: workflowTemplates.atRiskAfterDays, overdue_after_days: workflowTemplates.overdueAfterDays }).from(workflowTemplates).where(inArray(workflowTemplates.id, templateIds))
      : Promise.resolve([]),
    locationApptIds.length > 0
      ? db.select({ appointment_id: intakePackageJourneys.appointmentId, journey_token: intakePackageJourneys.journeyToken, status: intakePackageJourneys.status, form_ids: intakePackageJourneys.formIds, forms_completed: intakePackageJourneys.formsCompleted, includes_card_capture: intakePackageJourneys.includesCardCapture, card_captured_at: intakePackageJourneys.cardCapturedAt, includes_consent: intakePackageJourneys.includesConsent, consent_completed_at: intakePackageJourneys.consentCompletedAt, created_at: intakePackageJourneys.createdAt, completed_at: intakePackageJourneys.completedAt }).from(intakePackageJourneys).where(inArray(intakePackageJourneys.appointmentId, locationApptIds))
      : Promise.resolve([]),
  ]);

  return {
    patientMap: new Map((patientsRes ?? []).map((p) => [p.id, p])),
    clinicianMap: new Map((cliniciansRes ?? []).map((c) => [c.id, c.full_name])),
    phoneMap: new Map((phonesRes ?? []).map((p) => [p.patient_id, p.phone_number])),
    roomMap: new Map((roomsRes ?? []).map((r) => [r.id, r.name])),
    typeMap: new Map((typesRes ?? []).map((t) => [t.id, t.name])),
    templateMap: new Map((templatesRes ?? []).map((t) => [t.id, t])),
    journeyMap: new Map((journeysRes ?? []).map((j) => [j.appointment_id, j])),
  };
}

// ---------------------------------------------------------------------------
// Stage 5: completed_form_submissions per appointment
//
// Two queries merged by submission_id:
//   (1) form_assignments (status='completed', has submission_id) — covers
//       deliver_form workflow actions.
//   (2) form_submissions filtered by intake-package journey's configured
//       form_ids — covers intake-package submissions, which write directly
//       to form_submissions without a form_assignments row.
// completed_at precedence:
//   - assignment rows → form_assignments.completed_at
//   - intake-package rows → journey.forms_completed[form_id] ??
//       form_submissions.created_at
//
// Filtering query 2 on the journey's configured form_ids (not on
// forms_completed) is intentional: forms_completed is the per-form
// completion timestamp JSONB, which may be missing for historical rows.
// form_ids is the stable configured list; the JSONB drives only the
// completed_at fallback.
// ---------------------------------------------------------------------------

async function buildCompletedSubmissions(
  locationApptIds: string[],
  journeyMap: Map<string, JourneyRow>
): Promise<Map<string, CompletedFormSubmission[]>> {
  const completedSubsByAppt = new Map<string, CompletedFormSubmission[]>();
  if (locationApptIds.length === 0) return completedSubsByAppt;

  const [completedAssignmentsRes, intakeSubmissionsRes] = await Promise.all([
    db
      .select({
        submission_id: formAssignments.submissionId,
        form_id: formAssignments.formId,
        completed_at: formAssignments.completedAt,
        appointment_id: formAssignments.appointmentId,
      })
      .from(formAssignments)
      .where(
        and(
          inArray(formAssignments.appointmentId, locationApptIds),
          eq(formAssignments.status, "completed"),
          isNotNull(formAssignments.submissionId)
        )
      ),
    // For intake-package submissions, scope to journey-configured form IDs
    // for each appointment that has a journey row.
    (async () => {
      const journeyAppts = [...journeyMap.values()].filter(
        (j) => Array.isArray(j.form_ids) && j.form_ids.length > 0,
      );
      if (journeyAppts.length === 0) return [] as Array<{ id: string; form_id: string; appointment_id: string; created_at: string }>;
      // (appointment_id, form_id) pairs as an OR of ANDs. Build the pair
      // predicate as a SQL row-tuple IN list — clean and indexable.
      const pairs = journeyAppts.flatMap((j) =>
        (j.form_ids as string[]).map((fid) => sql`(${j.appointment_id}, ${fid})`),
      );
      return db
        .select({
          id: formSubmissions.id,
          form_id: formSubmissions.formId,
          appointment_id: formSubmissions.appointmentId,
          created_at: formSubmissions.createdAt,
        })
        .from(formSubmissions)
        .where(sql`(${formSubmissions.appointmentId}, ${formSubmissions.formId}) IN (${sql.join(pairs, sql`, `)})`);
    })(),
  ]);

  // Form names for the rows above: assignment form_ids plus journey-configured
  // form_ids (intake submissions are scoped to the latter by construction).
  const nameFormIds = new Set<string>();
  for (const row of completedAssignmentsRes ?? []) {
    if (row.form_id) nameFormIds.add(row.form_id);
  }
  for (const j of journeyMap.values()) {
    if (Array.isArray(j.form_ids)) {
      for (const fid of j.form_ids as string[]) {
        if (fid) nameFormIds.add(fid);
      }
    }
  }
  const formNameMap = new Map<string, string>();
  if (nameFormIds.size > 0) {
    const forms = await db
      .select({ id: formsT.id, name: formsT.name })
      .from(formsT)
      .where(inArray(formsT.id, [...nameFormIds]));
    for (const f of forms ?? []) formNameMap.set(f.id, f.name);
  }

  const assignmentSubmissionIds = new Set<string>();

  for (const row of completedAssignmentsRes ?? []) {
    if (!row.submission_id || !row.appointment_id) continue;
    assignmentSubmissionIds.add(row.submission_id);
    const list = completedSubsByAppt.get(row.appointment_id) ?? [];
    list.push({
      submission_id: row.submission_id,
      form_id: row.form_id,
      form_name: formNameMap.get(row.form_id) ?? "Form",
      completed_at: row.completed_at ?? "",
      source: "assignment",
    });
    completedSubsByAppt.set(row.appointment_id, list);
  }

  for (const row of intakeSubmissionsRes ?? []) {
    // Skip if the same submission was already added via the assignment path
    // (defensive — intake-package submissions don't have assignment rows by
    // design, but the union by submission_id keeps us safe).
    if (assignmentSubmissionIds.has(row.id)) continue;
    if (!row.appointment_id || !row.form_id) continue;
    const journey = journeyMap.get(row.appointment_id);
    const formsCompleted = (journey?.forms_completed as Record<string, string> | null | undefined) ?? null;
    const completedAt = formsCompleted?.[row.form_id] ?? row.created_at;
    const list = completedSubsByAppt.get(row.appointment_id) ?? [];
    list.push({
      submission_id: row.id,
      form_id: row.form_id,
      form_name: formNameMap.get(row.form_id) ?? "Form",
      completed_at: completedAt,
      source: "intake_package",
    });
    completedSubsByAppt.set(row.appointment_id, list);
  }

  return completedSubsByAppt;
}

// ---------------------------------------------------------------------------
// Stage 6: pure grouping of enriched actions into per-appointment rows
// ---------------------------------------------------------------------------

type GroupedAppointment = {
  appointment_id: string;
  scheduled_at: string | null;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  clinician_name: string | null;
  primary_phone: string | null;
  room_id: string | null;
  room_name: string | null;
  appointment_type_id: string | null;
  appointment_type_name: string | null;
  terminal_type: string | null;
  total_actions: number;
  completed_actions: number;
  outstanding_actions: number;
  priority: ReadinessPriority;
  package_status: string | null;
  intake_journey_token: string | null;
  package_total_items: number;
  package_completed_items: number;
  pathway_name: string | null;
  session_ended_at: string | null;
  actions: ReadinessAppointment["actions"];
  outstanding_forms: ReadinessAppointment["outstanding_forms"];
  completed_form_submissions: CompletedFormSubmission[];
};

function buildReadinessAppointments(params: {
  appointmentsData: AppointmentRow[];
  enrichedActions: EnrichedWorkflowAction[];
  lookups: AppointmentLookups;
  templateIdsByAppointment: Map<string, string>;
  completedSubsByAppt: Map<string, CompletedFormSubmission[]>;
}): GroupedAppointment[] {
  const {
    appointmentsData,
    enrichedActions,
    lookups,
    templateIdsByAppointment,
    completedSubsByAppt,
  } = params;
  const { patientMap, clinicianMap, phoneMap, roomMap, typeMap, templateMap, journeyMap } = lookups;

  const appointmentMap = new Map(appointmentsData.map((a) => [a.id, a]));
  const grouped = new Map<string, GroupedAppointment>();

  for (const action of enrichedActions) {
    const appt = appointmentMap.get(action.appointment_id);
    if (!appt) continue;

    if (!grouped.has(appt.id)) {
      const patient = appt.patient_id ? patientMap.get(appt.patient_id) : null;
      const firstName = patient?.first_name ?? (appt.phone_number ? appt.phone_number : "Unknown");
      const lastName = patient?.last_name ?? "";
      const phone = appt.patient_id
        ? phoneMap.get(appt.patient_id) ?? appt.phone_number ?? null
        : appt.phone_number ?? null;

      const templateId = templateIdsByAppointment.get(appt.id);
      const template = templateId ? templateMap.get(templateId) : null;
      const journey = journeyMap.get(appt.id);
      const { totalItems, completedItems } = computePackageProgress(journey);

      grouped.set(appt.id, {
        appointment_id: appt.id,
        scheduled_at: appt.scheduled_at,
        patient_id: appt.patient_id ?? "",
        patient_first_name: firstName,
        patient_last_name: lastName,
        clinician_name: appt.clinician_id ? clinicianMap.get(appt.clinician_id) ?? null : null,
        primary_phone: phone,
        room_id: appt.room_id ?? null,
        room_name: appt.room_id ? roomMap.get(appt.room_id) ?? null : null,
        appointment_type_id: appt.appointment_type_id ?? null,
        appointment_type_name: appt.appointment_type_id ? typeMap.get(appt.appointment_type_id) ?? null : null,
        terminal_type: template?.terminal_type ?? null,
        total_actions: 0,
        completed_actions: 0,
        outstanding_actions: 0,
        priority: "in_progress",
        package_status: journey?.status ?? null,
        intake_journey_token: journey?.journey_token ?? null,
        package_total_items: totalItems,
        package_completed_items: completedItems,
        pathway_name: null,
        session_ended_at: null,
        actions: [],
        outstanding_forms: [],
        completed_form_submissions: completedSubsByAppt.get(appt.id) ?? [],
      });
    }

    const group = grouped.get(appt.id)!;
    const isTerminalStatus = TERMINAL_STATUSES.includes(action.status);

    group.total_actions++;
    if (isTerminalStatus) {
      group.completed_actions++;
    } else {
      group.outstanding_actions++;
    }

    // Post-appointment rollups: first pathway / session end seen wins.
    if (!group.pathway_name && action.pathway_name) {
      group.pathway_name = action.pathway_name;
    }
    if (!group.session_ended_at && action.session_ended_at) {
      group.session_ended_at = action.session_ended_at;
    }

    group.actions.push(action);
  }

  return [...grouped.values()];
}

function computePackageProgress(
  journey:
    | {
        includes_card_capture: boolean;
        includes_consent: boolean;
        form_ids: unknown;
        card_captured_at: string | null;
        consent_completed_at: string | null;
        forms_completed: unknown;
      }
    | undefined
): { totalItems: number; completedItems: number } {
  if (!journey) return { totalItems: 0, completedItems: 0 };

  let total = 1;
  let completed = 1;

  if (journey.includes_card_capture) {
    total++;
    if (journey.card_captured_at) completed++;
  }
  if (journey.includes_consent) {
    total++;
    if (journey.consent_completed_at) completed++;
  }

  const formCount = Array.isArray(journey.form_ids) ? journey.form_ids.length : 0;
  total += formCount;

  const formsCompleted = (journey.forms_completed as Record<string, string> | null) ?? {};
  completed += Object.keys(formsCompleted).length;

  return { totalItems: total, completedItems: completed };
}
