import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
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
  const supabase = createServiceClient();
  const now = new Date();

  // Active runs for THIS location only — scoped via the appointment's
  // location (inner join). One query covers both directions; we partition in
  // memory. This is a correctness fix: previously runs/counts weren't
  // location-scoped, so the count badges leaked other locations' workflow
  // runs in multi-location orgs.
  const { data: allRuns } = await supabase
    .from("appointment_workflow_runs")
    .select(
      "id, appointment_id, workflow_template_id, direction, status, appointments!inner(location_id)"
    )
    .eq("status", "active")
    .eq("appointments.location_id", locationId);

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
  const { data: appointmentsData } = await supabase
    .from("appointments")
    .select("id, scheduled_at, patient_id, clinician_id, location_id, phone_number, room_id, appointment_type_id")
    .in("id", appointmentIds)
    .eq("location_id", locationId);

  if (!appointmentsData || appointmentsData.length === 0) {
    return { appointments: [], counts };
  }

  const locationApptIds = appointmentsData.map((a) => a.id);
  const appointmentMap = new Map(appointmentsData.map((a) => [a.id, a]));

  const runIds = locationApptIds.flatMap((id) => runsByAppointment.get(id) ?? []);
  const { data: actions } = await supabase
    .from("appointment_actions")
    .select("id, appointment_id, action_block_id, workflow_run_id, status, scheduled_for, fired_at, completed_at, error_message, updated_at, session_id, config, form_id, resolved_at, resolved_by, resolution_note")
    .in("workflow_run_id", runIds);

  const blockIds = [...new Set((actions ?? []).map((a) => a.action_block_id))];
  const { data: blocks } = await supabase
    .from("workflow_action_blocks")
    .select("id, action_type, config, form_id, offset_minutes, offset_direction")
    .in("id", blockIds);

  const blockMap = new Map((blocks ?? []).map((b) => [b.id, b]));

  const patientIds = [...new Set(appointmentsData.map((a) => a.patient_id).filter(Boolean))];
  const clinicianIds = [...new Set(appointmentsData.map((a) => a.clinician_id).filter(Boolean))];
  const formIds = [...new Set((blocks ?? []).map((b) => b.form_id).filter(Boolean))];
  const roomIds = [...new Set(appointmentsData.map((a) => a.room_id).filter(Boolean))];
  const typeIds = [...new Set(appointmentsData.map((a) => a.appointment_type_id).filter(Boolean))];
  const templateIds = [...new Set([...templateIdsByAppointment.values()])];

  const sessionIds = [...new Set((actions ?? []).map((a) => a.session_id).filter(Boolean))];
  const actionFormIds = [...new Set((actions ?? []).map((a) => a.form_id).filter(Boolean))];
  const allFormIds = [...new Set([...formIds, ...actionFormIds])];

  const [patientsRes, cliniciansRes, phonesRes, formsRes, roomsRes, typesRes, templatesRes, journeysRes, sessionsRes] = await Promise.all([
    patientIds.length > 0
      ? supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
      : Promise.resolve({ data: [] }),
    clinicianIds.length > 0
      ? supabase.from("users").select("id, full_name").in("id", clinicianIds)
      : Promise.resolve({ data: [] }),
    patientIds.length > 0
      ? supabase.from("patient_phone_numbers").select("patient_id, phone_number").in("patient_id", patientIds).eq("is_primary", true)
      : Promise.resolve({ data: [] }),
    allFormIds.length > 0
      ? supabase.from("forms").select("id, name").in("id", allFormIds)
      : Promise.resolve({ data: [] }),
    roomIds.length > 0
      ? supabase.from("rooms").select("id, name").in("id", roomIds)
      : Promise.resolve({ data: [] }),
    typeIds.length > 0
      ? supabase.from("appointment_types").select("id, name").in("id", typeIds)
      : Promise.resolve({ data: [] }),
    templateIds.length > 0
      ? supabase.from("workflow_templates").select("id, terminal_type, at_risk_after_days, overdue_after_days").in("id", templateIds)
      : Promise.resolve({ data: [] }),
    locationApptIds.length > 0
      ? supabase.from("intake_package_journeys").select("appointment_id, status, form_ids, forms_completed, includes_card_capture, card_captured_at, includes_consent, consent_completed_at, created_at, completed_at").in("appointment_id", locationApptIds)
      : Promise.resolve({ data: [] }),
    sessionIds.length > 0
      ? supabase.from("sessions").select("id, session_ended_at, outcome_pathway_id").in("id", sessionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const patientMap = new Map((patientsRes.data ?? []).map((p) => [p.id, p]));
  const clinicianMap = new Map((cliniciansRes.data ?? []).map((c) => [c.id, c.full_name]));
  const phoneMap = new Map((phonesRes.data ?? []).map((p) => [p.patient_id, p.phone_number]));
  const formMap = new Map((formsRes.data ?? []).map((f) => [f.id, f.name]));
  const roomMap = new Map((roomsRes.data ?? []).map((r) => [r.id, r.name]));
  const typeMap = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]));
  const templateMap = new Map((templatesRes.data ?? []).map((t) => [t.id, t]));
  const journeyMap = new Map((journeysRes.data ?? []).map((j) => [j.appointment_id, j]));
  const sessionMap = new Map((sessionsRes.data ?? []).map((s) => [s.id, s]));

  const pathwayIds = [...new Set(
    (sessionsRes.data ?? []).map((s) => s.outcome_pathway_id).filter(Boolean)
  )];
  const pathwayNameMap = new Map<string, string>();
  if (pathwayIds.length > 0) {
    const { data: pathways } = await supabase
      .from("outcome_pathways")
      .select("id, name")
      .in("id", pathwayIds);
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
  for (const j of journeysRes.data ?? []) {
    if (Array.isArray(j.form_ids)) {
      for (const fid of j.form_ids as string[]) {
        if (fid && !formMap.has(fid)) journeyFormIds.add(fid);
      }
    }
  }
  if (journeyFormIds.size > 0) {
    const { data: extraForms } = await supabase
      .from("forms")
      .select("id, name")
      .in("id", [...journeyFormIds]);
    for (const f of extraForms ?? []) formMap.set(f.id, f.name);
  }

  if (locationApptIds.length > 0) {
    const [completedAssignmentsRes, intakeSubmissionsRes] = await Promise.all([
      supabase
        .from("form_assignments")
        .select("submission_id, form_id, completed_at, appointment_id")
        .in("appointment_id", locationApptIds)
        .eq("status", "completed")
        .not("submission_id", "is", null),
      // For intake-package submissions, scope to journey-configured form IDs
      // for each appointment that has a journey row.
      (async () => {
        const journeyAppts = (journeysRes.data ?? []).filter(
          (j) => Array.isArray(j.form_ids) && j.form_ids.length > 0,
        );
        if (journeyAppts.length === 0) return { data: [] as Array<{ id: string; form_id: string; appointment_id: string; created_at: string }> };
        // We need (appointment_id, form_id) pairs; build a single OR predicate.
        const orFilters = journeyAppts.flatMap((j) =>
          (j.form_ids as string[]).map(
            (fid) => `and(appointment_id.eq.${j.appointment_id},form_id.eq.${fid})`,
          ),
        );
        return supabase
          .from("form_submissions")
          .select("id, form_id, appointment_id, created_at")
          .or(orFilters.join(","));
      })(),
    ]);

    const assignmentSubmissionIds = new Set<string>();

    for (const row of completedAssignmentsRes.data ?? []) {
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

    for (const row of intakeSubmissionsRes.data ?? []) {
      // Skip if the same submission was already added via the assignment path
      // (defensive — intake-package submissions don't have assignment rows by
      // design, but the union by submission_id keeps us safe).
      if (assignmentSubmissionIds.has(row.id)) continue;
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
    room_name: string | null;
    appointment_type_name: string | null;
    terminal_type: string | null;
    total_actions: number;
    completed_actions: number;
    outstanding_actions: number;
    priority: ReadinessPriority;
    package_status: string | null;
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
        room_name: appt.room_id ? roomMap.get(appt.room_id) ?? null : null,
        appointment_type_name: appt.appointment_type_id ? typeMap.get(appt.appointment_type_id) ?? null : null,
        terminal_type: template?.terminal_type ?? null,
        total_actions: 0,
        completed_actions: 0,
        outstanding_actions: 0,
        priority: "in_progress",
        package_status: journey?.status ?? null,
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
      ? getPostActionLabel(block?.action_type ?? "unknown", actionConfig, formName)
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
        forms_completed: Record<string, string> | null;
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

  const formsCompleted = journey.forms_completed ?? {};
  completed += Object.keys(formsCompleted).length;

  return { totalItems: total, completedItems: completed };
}
