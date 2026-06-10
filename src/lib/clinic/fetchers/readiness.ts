import { cache } from "react";
import { db } from "@/lib/db";
import {
  appointmentWorkflowRuns,
  appointments as appointmentsT,
  appointmentActions,
  workflowActionBlocks,
  patients as patientsT,
  users as usersT,
  patientPhoneNumbers,
  forms as formsT,
  rooms as roomsT,
  appointmentTypes,
  workflowTemplates,
  intakePackageJourneys,
  sessions as sessionsT,
  outcomePathways,
  formAssignments,
  formSubmissions,
} from "@/lib/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  getReadinessPriority,
  sortByPriority,
  type ReadinessPriority,
} from "@/lib/readiness/derived-state";
import { getPostActionLabel } from "@/lib/workflows/types";
import { getActionLabel } from "./workflow-actions";
import type {
  CompletedFormSubmission,
  ReadinessAppointment,
  ReadinessCounts,
} from "@/stores/clinic-store";

const TERMINAL_STATUSES = ["completed", "captured", "verified", "skipped", "failed", "transcribed"];
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type ReadinessDirection = "pre_appointment" | "post_appointment";

export interface ReadinessSlice {
  appointments: ReadinessAppointment[];
  counts: ReadinessCounts;
}

export const fetchReadinessSlice = cache(async (
  locationId: string,
  direction: ReadinessDirection
): Promise<ReadinessSlice> => {
  const now = new Date();

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
  let oppositeApptCount = 0;
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
  oppositeApptCount = oppositeAppointments.size;

  // Counts are per-appointment (an appointment with N runs counts once),
  // matching runsByAppointment.size for the active direction.
  const counts: ReadinessCounts = {
    pre: direction === "pre_appointment" ? runsByAppointment.size : oppositeApptCount,
    post: direction === "post_appointment" ? runsByAppointment.size : oppositeApptCount,
  };

  if (runsByAppointment.size === 0) {
    return { appointments: [], counts };
  }

  const appointmentIds = [...runsByAppointment.keys()];
  const appointmentsData = await db
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

  if (!appointmentsData || appointmentsData.length === 0) {
    return { appointments: [], counts };
  }

  const locationApptIds = appointmentsData.map((a) => a.id);
  const appointmentMap = new Map(appointmentsData.map((a) => [a.id, a]));

  const runIds = locationApptIds.flatMap((id) => runsByAppointment.get(id) ?? []);
  const actions = runIds.length === 0 ? [] : await db
    .select({
      id: appointmentActions.id,
      appointment_id: appointmentActions.appointmentId,
      action_block_id: appointmentActions.actionBlockId,
      workflow_run_id: appointmentActions.workflowRunId,
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

  const blockIds = [...new Set((actions ?? []).map((a) => a.action_block_id))].filter(Boolean) as string[];
  const blocks = blockIds.length === 0 ? [] : await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
      config: workflowActionBlocks.config,
      form_id: workflowActionBlocks.formId,
      offset_minutes: workflowActionBlocks.offsetMinutes,
      offset_direction: workflowActionBlocks.offsetDirection,
    })
    .from(workflowActionBlocks)
    .where(inArray(workflowActionBlocks.id, blockIds));

  const blockMap = new Map((blocks ?? []).map((b) => [b.id, b]));

  const nonNull = (x: string | null): x is string => !!x;
  const patientIds = [...new Set(appointmentsData.map((a) => a.patient_id).filter(nonNull))];
  const clinicianIds = [...new Set(appointmentsData.map((a) => a.clinician_id).filter(nonNull))];
  const formIds = [...new Set((blocks ?? []).map((b) => b.form_id).filter(nonNull))];
  const roomIds = [...new Set(appointmentsData.map((a) => a.room_id).filter(nonNull))];
  const typeIds = [...new Set(appointmentsData.map((a) => a.appointment_type_id).filter(nonNull))];
  const templateIds = [...new Set([...templateIdsByAppointment.values()])];

  const sessionIds = [...new Set((actions ?? []).map((a) => a.session_id).filter(nonNull))];
  const actionFormIds = [...new Set((actions ?? []).map((a) => a.form_id).filter(nonNull))];
  const allFormIds = [...new Set([...formIds, ...actionFormIds])];

  const [patientsRes, cliniciansRes, phonesRes, formsRes, roomsRes, typesRes, templatesRes, journeysRes, sessionsRes] = await Promise.all([
    patientIds.length > 0
      ? db.select({ id: patientsT.id, first_name: patientsT.firstName, last_name: patientsT.lastName }).from(patientsT).where(inArray(patientsT.id, patientIds))
      : Promise.resolve([]),
    clinicianIds.length > 0
      ? db.select({ id: usersT.id, full_name: usersT.fullName }).from(usersT).where(inArray(usersT.id, clinicianIds))
      : Promise.resolve([]),
    patientIds.length > 0
      ? db.select({ patient_id: patientPhoneNumbers.patientId, phone_number: patientPhoneNumbers.phoneNumber }).from(patientPhoneNumbers).where(and(inArray(patientPhoneNumbers.patientId, patientIds), eq(patientPhoneNumbers.isPrimary, true)))
      : Promise.resolve([]),
    allFormIds.length > 0
      ? db.select({ id: formsT.id, name: formsT.name }).from(formsT).where(inArray(formsT.id, allFormIds))
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
    sessionIds.length > 0
      ? db.select({ id: sessionsT.id, session_ended_at: sessionsT.sessionEndedAt, outcome_pathway_id: sessionsT.outcomePathwayId }).from(sessionsT).where(inArray(sessionsT.id, sessionIds))
      : Promise.resolve([]),
  ]);

  const patientMap = new Map((patientsRes ?? []).map((p) => [p.id, p]));
  const clinicianMap = new Map((cliniciansRes ?? []).map((c) => [c.id, c.full_name]));
  const phoneMap = new Map((phonesRes ?? []).map((p) => [p.patient_id, p.phone_number]));
  const formMap = new Map((formsRes ?? []).map((f) => [f.id, f.name]));
  const roomMap = new Map((roomsRes ?? []).map((r) => [r.id, r.name]));
  const typeMap = new Map((typesRes ?? []).map((t) => [t.id, t.name]));
  const templateMap = new Map((templatesRes ?? []).map((t) => [t.id, t]));
  const journeyMap = new Map((journeysRes ?? []).map((j) => [j.appointment_id, j]));
  const sessionMap = new Map((sessionsRes ?? []).map((s) => [s.id, s]));

  const pathwayIds = [...new Set(
    (sessionsRes ?? []).map((s) => s.outcome_pathway_id).filter(Boolean)
  )] as string[];
  const pathwayNameMap = new Map<string, string>();
  if (pathwayIds.length > 0) {
    const pathways = await db
      .select({ id: outcomePathways.id, name: outcomePathways.name })
      .from(outcomePathways)
      .where(inArray(outcomePathways.id, pathwayIds));
    for (const p of pathways ?? []) {
      pathwayNameMap.set(p.id, p.name);
    }
  }

  // ------------------------------------------------------------
  // completed_form_submissions per appointment
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
  // ------------------------------------------------------------
  const completedSubsByAppt = new Map<string, CompletedFormSubmission[]>();

  // Form names from the existing formMap cover assignment-block and action
  // form_ids, but intake-package submissions reference forms via the journey's
  // configured form_ids — those may not be in formMap. Top up the map with
  // any unseen IDs from journey rows before we render rows.
  const journeyFormIds = new Set<string>();
  for (const j of journeysRes ?? []) {
    if (Array.isArray(j.form_ids)) {
      for (const fid of j.form_ids as string[]) {
        if (fid && !formMap.has(fid)) journeyFormIds.add(fid);
      }
    }
  }
  if (journeyFormIds.size > 0) {
    const extraForms = await db
      .select({ id: formsT.id, name: formsT.name })
      .from(formsT)
      .where(inArray(formsT.id, [...journeyFormIds]));
    for (const f of extraForms ?? []) formMap.set(f.id, f.name);
  }

  if (locationApptIds.length > 0) {
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
        const journeyAppts = (journeysRes ?? []).filter(
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

    const assignmentSubmissionIds = new Set<string>();

    for (const row of completedAssignmentsRes ?? []) {
      if (!row.submission_id || !row.appointment_id) continue;
      assignmentSubmissionIds.add(row.submission_id);
      const list = completedSubsByAppt.get(row.appointment_id) ?? [];
      list.push({
        submission_id: row.submission_id,
        form_id: row.form_id,
        form_name: formMap.get(row.form_id) ?? "Form",
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
        form_name: formMap.get(row.form_id) ?? "Form",
        completed_at: completedAt,
        source: "intake_package",
      });
      completedSubsByAppt.set(row.appointment_id, list);
    }
  }

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

  const grouped = new Map<string, GroupedAppointment>();

  for (const action of actions ?? []) {
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
    const block = blockMap.get(action.action_block_id);
    const isTerminalStatus = TERMINAL_STATUSES.includes(action.status);

    group.total_actions++;
    if (isTerminalStatus) {
      group.completed_actions++;
    } else {
      group.outstanding_actions++;
    }

    const isPostAppointment = !!action.session_id;
    const actionConfig = isPostAppointment
      ? (action.config as Record<string, unknown>) ?? null
      : null;
    const actionFormId = isPostAppointment
      ? (action.form_id as string | null)
      : block?.form_id ?? null;
    const formName = actionFormId ? formMap.get(actionFormId) ?? null : null;

    let actionPathwayName: string | null = null;
    if (isPostAppointment && action.session_id) {
      const sess = sessionMap.get(action.session_id);
      if (sess) {
        if (sess.outcome_pathway_id) {
          actionPathwayName = pathwayNameMap.get(sess.outcome_pathway_id) ?? null;
        }
        if (!group.pathway_name && actionPathwayName) {
          group.pathway_name = actionPathwayName;
        }
        if (!group.session_ended_at && sess.session_ended_at) {
          group.session_ended_at = sess.session_ended_at;
        }
      }
    }

    const actionLabel = isPostAppointment
      ? getPostActionLabel(block?.action_type ?? "unknown", actionConfig, formName ?? undefined)
      : getActionLabel(block?.action_type ?? "unknown", formName ?? undefined);

    group.actions.push({
      action_id: action.id,
      action_type: block?.action_type ?? "unknown",
      action_label: actionLabel,
      status: action.status,
      scheduled_for: action.scheduled_for,
      fired_at: action.fired_at,
      completed_at: action.completed_at ?? null,
      error_message: action.error_message,
      form_name: formName,
      offset_minutes: block?.offset_minutes ?? 0,
      offset_direction: block?.offset_direction ?? "before",
      updated_at: action.updated_at ?? null,
      session_id: action.session_id ?? null,
      config: actionConfig,
      resolved_at: action.resolved_at ?? null,
      resolved_by: action.resolved_by ?? null,
      resolution_note: action.resolution_note ?? null,
      pathway_name: actionPathwayName,
    });
  }

  const result: GroupedAppointment[] = [];
  for (const appt of grouped.values()) {
    appt.priority = getReadinessPriority(appt as Parameters<typeof getReadinessPriority>[0], now);

    if (appt.priority === "recently_completed") {
      const mostRecentUpdate = getMostRecentActionUpdate(appt.actions);
      if (mostRecentUpdate && now.getTime() - mostRecentUpdate > RETENTION_MS) {
        continue;
      }
    }

    result.push(appt);
  }

  const sorted = sortByPriority(result as Parameters<typeof sortByPriority>[0], now);

  return { appointments: sorted as ReadinessAppointment[], counts };
});

function getMostRecentActionUpdate(
  actions: { updated_at?: string | null; fired_at?: string | null; scheduled_for?: string }[]
): number | null {
  let latest = 0;
  for (const action of actions) {
    const ts = action.updated_at ?? action.fired_at ?? action.scheduled_for;
    if (ts) {
      const t = new Date(ts).getTime();
      if (t > latest) latest = t;
    }
  }
  return latest || null;
}

function computePackageProgress(
  journey:
    | {
        includes_card_capture: boolean;
        includes_consent: boolean;
        form_ids: string[];
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

  const formCount = journey.form_ids?.length ?? 0;
  total += formCount;

  const formsCompleted = (journey.forms_completed as Record<string, string> | null) ?? {};
  completed += Object.keys(formsCompleted).length;

  return { totalItems: total, completedItems: completed };
}
