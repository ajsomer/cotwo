import { db } from "@/lib/db";
import {
  appointmentActions,
  workflowActionBlocks,
  appointments as appointmentsT,
  patients as patientsT,
  patientPhoneNumbers,
  organisations as organisationsT,
  locations as locationsT,
  users as usersT,
  sessions as sessionsT,
} from "@/lib/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { PreconditionConfig, ActionType } from "./types";
import { evaluatePrecondition } from "./preconditions";
import { executeHandler } from "./handlers";
import {
  buildHandlerContext,
  resolveActionPhone,
  type ClaimedActionData,
  type ActionBlockData,
  type AppointmentData,
  type ContextLookups,
} from "./context";
import { maybeCompleteWorkflowRuns } from "./run-completion";

const FALLBACK_TIMEZONE = "Australia/Sydney";

interface ScanResult {
  fired: number;
  skipped: number;
  failed: number;
}

type ActionOutcome =
  | { kind: "failed"; error: string }
  | { kind: "skipped" }
  | {
      kind: "succeeded";
      status: string;
      resultData: Record<string, unknown> | null;
    };

/** The success/failure write-back, shared by both execution paths. */
async function markActionOutcome(
  actionId: string,
  outcome: ActionOutcome
): Promise<void> {
  const firedAt = new Date().toISOString();
  if (outcome.kind === "failed") {
    await db
      .update(appointmentActions)
      .set({ status: "failed", firedAt, errorMessage: outcome.error })
      .where(eq(appointmentActions.id, actionId));
  } else if (outcome.kind === "skipped") {
    await db
      .update(appointmentActions)
      .set({ status: "skipped", firedAt })
      .where(eq(appointmentActions.id, actionId));
  } else {
    await db
      .update(appointmentActions)
      .set({
        // Handler statuses are a superset of the DB enum (e.g. "fired");
        // write the value as-is, matching the prior Supabase behaviour.
        status:
          outcome.status as (typeof appointmentActions.status.enumValues)[number],
        firedAt,
        result: outcome.resultData ?? null,
      })
      .where(eq(appointmentActions.id, actionId));
  }
}

interface BlockRow extends ActionBlockData {
  precondition?: unknown;
}

/**
 * Validate → (optionally) evaluate precondition → execute handler → write
 * outcome back. Shared by both execution paths; `evaluatePreconditions` is
 * explicit at the two call sites because the difference is intentional:
 * the batch scan honours preconditions, the manual fire-now path skips them
 * (the caller has already decided this should fire).
 */
async function executeClaimedAction(
  action: ClaimedActionData,
  block: BlockRow,
  appt: AppointmentData,
  lookups: ContextLookups,
  opts: { evaluatePreconditions: boolean; suppressNotification?: boolean }
): Promise<ActionOutcome> {
  const patientId = appt.patient_id;
  if (!patientId) {
    const outcome: ActionOutcome = {
      kind: "failed",
      error: "No patient linked to appointment",
    };
    await markActionOutcome(action.id, outcome);
    return outcome;
  }

  // Task actions don't need a phone number (staff-facing, no SMS sent).
  const isTaskAction = block.action_type === "task";
  if (!isTaskAction && !resolveActionPhone(lookups.primaryPhone, appt)) {
    const outcome: ActionOutcome = {
      kind: "failed",
      error: "No phone number on file for patient",
    };
    await markActionOutcome(action.id, outcome);
    return outcome;
  }

  if (opts.evaluatePreconditions) {
    const shouldFire = await evaluatePrecondition(
      block.precondition as PreconditionConfig,
      action.appointment_id,
      patientId
    );
    if (!shouldFire) {
      const outcome: ActionOutcome = { kind: "skipped" };
      await markActionOutcome(action.id, outcome);
      return outcome;
    }
  }

  const handlerResult = await executeHandler(
    block.action_type as ActionType,
    buildHandlerContext({
      action,
      block,
      appt,
      patientId,
      lookups,
      suppressNotification: opts.suppressNotification,
    })
  );

  if (handlerResult.status === "failed") {
    const outcome: ActionOutcome = {
      kind: "failed",
      error: handlerResult.error,
    };
    await markActionOutcome(action.id, outcome);
    return outcome;
  }

  const outcome: ActionOutcome = {
    kind: "succeeded",
    status: handlerResult.status,
    resultData: (handlerResult.resultData as Record<string, unknown>) ?? null,
  };
  await markActionOutcome(action.id, outcome);
  return outcome;
}

/**
 * Execute all scheduled workflow actions whose fire time has arrived.
 *
 * Algorithm:
 * 1. Claim: atomically update status from 'scheduled' to 'firing' for all
 *    due actions. This prevents double-firing if scans overlap.
 * 2. For each claimed action:
 *    a. Evaluate precondition. If false → mark 'skipped'.
 *    b. Execute handler. On success → mark with handler's returned status.
 *       On failure → mark 'failed' with error_message.
 * 3. Log counts.
 *
 * Idempotent: queries status='scheduled', transitions out immediately.
 * Already-processed actions are invisible to the query.
 *
 * When `appointmentId` is passed, scopes the claim to that single appointment
 * — used by `scheduleWorkflowForAppointment` to fire immediately-due actions
 * (e.g. intake_package) synchronously instead of waiting for the cron pass.
 */
export async function executeScheduledActions(
  options: { appointmentId?: string } = {}
): Promise<ScanResult> {
  const result: ScanResult = { fired: 0, skipped: 0, failed: 0 };

  // Step 1: Claim — atomically move scheduled → firing
  const claimWhere = and(
    eq(appointmentActions.status, "scheduled"),
    lte(appointmentActions.scheduledFor, new Date().toISOString()),
    options.appointmentId
      ? eq(appointmentActions.appointmentId, options.appointmentId)
      : undefined
  );

  let actions: Array<{
    id: string;
    appointment_id: string;
    action_block_id: string;
    workflow_run_id: string | null;
    scheduled_for: string;
    session_id: string | null;
    config: unknown;
    form_id: string | null;
  }>;
  try {
    actions = await db
      .update(appointmentActions)
      .set({ status: "firing" })
      .where(claimWhere)
      .returning({
        id: appointmentActions.id,
        appointment_id: appointmentActions.appointmentId,
        action_block_id: appointmentActions.actionBlockId,
        workflow_run_id: appointmentActions.workflowRunId,
        scheduled_for: appointmentActions.scheduledFor,
        session_id: appointmentActions.sessionId,
        config: appointmentActions.config,
        form_id: appointmentActions.formId,
      });
  } catch (claimError) {
    console.error("[WORKFLOW ENGINE] Claim failed:", (claimError as Error).message);
    return result;
  }

  if (actions.length === 0) return result;

  // Fetch action block details for all claimed actions
  const blockIds = [...new Set(actions.map((a) => a.action_block_id))];
  const blocks = blockIds.length === 0 ? [] : await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
      config: workflowActionBlocks.config,
      precondition: workflowActionBlocks.precondition,
      form_id: workflowActionBlocks.formId,
      parent_action_block_id: workflowActionBlocks.parentActionBlockId,
    })
    .from(workflowActionBlocks)
    .where(inArray(workflowActionBlocks.id, blockIds));

  const blockMap = new Map(blocks.map((b) => [b.id, b]));

  // Fetch appointment details for all claimed actions
  const appointmentIds = [...new Set(actions.map((a) => a.appointment_id))];
  const appointments = appointmentIds.length === 0 ? [] : await db
    .select({
      id: appointmentsT.id,
      patient_id: appointmentsT.patientId,
      scheduled_at: appointmentsT.scheduledAt,
      clinician_id: appointmentsT.clinicianId,
      org_id: appointmentsT.orgId,
      phone_number: appointmentsT.phoneNumber,
      location_id: appointmentsT.locationId,
    })
    .from(appointmentsT)
    .where(inArray(appointmentsT.id, appointmentIds));

  const apptMap = new Map(appointments.map((a) => [a.id, a]));

  // Fetch patient details
  const patientIds = [...new Set(
    appointments.map((a) => a.patient_id).filter((x): x is string => !!x)
  )];

  const patientMap = new Map<string, { first_name: string; phone_number: string | null }>();
  if (patientIds.length > 0) {
    const patients = await db
      .select({ id: patientsT.id, first_name: patientsT.firstName })
      .from(patientsT)
      .where(inArray(patientsT.id, patientIds));

    const phones = await db
      .select({ patient_id: patientPhoneNumbers.patientId, phone_number: patientPhoneNumbers.phoneNumber })
      .from(patientPhoneNumbers)
      .where(
        and(
          inArray(patientPhoneNumbers.patientId, patientIds),
          eq(patientPhoneNumbers.isPrimary, true)
        )
      );

    const phoneMap = new Map(phones.map((p) => [p.patient_id, p.phone_number]));

    for (const p of patients) {
      patientMap.set(p.id, {
        first_name: p.first_name,
        phone_number: phoneMap.get(p.id) ?? null,
      });
    }
  }

  // Fetch org names for clinic_name interpolation
  const orgIds = [...new Set(
    appointments.map((a) => a.org_id).filter((x): x is string => !!x)
  )];
  const orgNameMap = new Map<string, string>();
  if (orgIds.length > 0) {
    const orgs = await db
      .select({ id: organisationsT.id, name: organisationsT.name })
      .from(organisationsT)
      .where(inArray(organisationsT.id, orgIds));
    for (const o of orgs) {
      orgNameMap.set(o.id, o.name);
    }
  }

  // Fetch clinician names
  const clinicianIds = [...new Set(
    appointments.map((a) => a.clinician_id).filter((x): x is string => !!x)
  )];
  const clinicianNameMap = new Map<string, string>();
  if (clinicianIds.length > 0) {
    const clinicians = await db
      .select({ id: usersT.id, full_name: usersT.fullName })
      .from(usersT)
      .where(inArray(usersT.id, clinicianIds));
    for (const c of clinicians) {
      clinicianNameMap.set(c.id, c.full_name);
    }
  }

  // Fetch location timezones for merge-field time formatting
  const locationIds = [...new Set(
    appointments.map((a) => a.location_id).filter((x): x is string => !!x)
  )];
  const timezoneMap = new Map<string, string>();
  if (locationIds.length > 0) {
    const locationRows = await db
      .select({ id: locationsT.id, timezone: locationsT.timezone })
      .from(locationsT)
      .where(inArray(locationsT.id, locationIds));
    for (const l of locationRows) {
      timezoneMap.set(l.id, l.timezone);
    }
  }

  // Fetch session data for post-appointment actions
  const sessionIds = [...new Set(
    actions.map((a) => a.session_id).filter((x): x is string => !!x)
  )];
  const sessionMap = new Map<string, { session_ended_at: string | null }>();
  if (sessionIds.length > 0) {
    const sessions = await db
      .select({ id: sessionsT.id, session_ended_at: sessionsT.sessionEndedAt })
      .from(sessionsT)
      .where(inArray(sessionsT.id, sessionIds));
    for (const s of sessions) {
      sessionMap.set(s.id, { session_ended_at: s.session_ended_at });
    }
  }

  // Step 2: Process each claimed action
  for (const action of actions) {
    const block = blockMap.get(action.action_block_id);
    const appt = apptMap.get(action.appointment_id);

    if (!block || !appt) {
      console.error(
        `[WORKFLOW ENGINE] Missing block or appointment for action ${action.id}. Marking failed.`
      );
      await markActionOutcome(action.id, {
        kind: "failed",
        error: "Missing action block or appointment data",
      });
      result.failed++;
      continue;
    }

    const patient = appt.patient_id ? patientMap.get(appt.patient_id) : null;

    const outcome = await executeClaimedAction(
      action,
      block,
      appt,
      {
        patientFirstName: patient?.first_name ?? "",
        primaryPhone: patient?.phone_number ?? null,
        clinicName: orgNameMap.get(appt.org_id) ?? "the clinic",
        clinicianName: appt.clinician_id
          ? clinicianNameMap.get(appt.clinician_id) ?? null
          : null,
        timezone: appt.location_id
          ? timezoneMap.get(appt.location_id) ?? FALLBACK_TIMEZONE
          : FALLBACK_TIMEZONE,
        sessionEndedAt: action.session_id
          ? sessionMap.get(action.session_id)?.session_ended_at ?? null
          : null,
      },
      { evaluatePreconditions: true }
    );

    if (outcome.kind === "failed") {
      console.error(
        `[WORKFLOW ENGINE] Action ${action.id} (${block.action_type}) failed: ${outcome.error}`
      );
      result.failed++;
    } else if (outcome.kind === "skipped") {
      result.skipped++;
    } else {
      result.fired++;
    }
  }

  // Step 3: Check workflow run completion (one grouped query for the batch)
  await maybeCompleteWorkflowRuns(actions.map((a) => a.workflow_run_id));

  return result;
}

/**
 * Fire a single action right now, ignoring its `scheduled_for`. Used for
 * testing paths that want to skip ahead in a workflow — e.g. firing
 * `add_to_runsheet` immediately when the patient finishes their intake
 * package, so the end-to-end flow can be walked through in one sitting
 * without waiting for the real scheduled offset.
 *
 * Returns the handler's result (same shape as `executeHandler`) so the
 * caller can pull `session_id` / `entry_token` out for logging.
 *
 * Claims the action atomically (scheduled → firing) so concurrent scans
 * don't double-fire. Skips precondition evaluation — the caller has already
 * decided this should fire now (explicit `evaluatePreconditions: false`).
 */
export async function fireActionNow(
  actionId: string,
  options: { suppressNotification?: boolean } = {}
): Promise<
  | { status: "fired"; resultData: Record<string, unknown> | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }
> {
  // Atomic claim: only transition scheduled → firing. If another process
  // already claimed it, or it's already terminal, return skipped.
  const [claimed] = await db
    .update(appointmentActions)
    .set({ status: "firing" })
    .where(and(eq(appointmentActions.id, actionId), eq(appointmentActions.status, "scheduled")))
    .returning({
      id: appointmentActions.id,
      appointment_id: appointmentActions.appointmentId,
      action_block_id: appointmentActions.actionBlockId,
      session_id: appointmentActions.sessionId,
      config: appointmentActions.config,
      form_id: appointmentActions.formId,
    });

  if (!claimed) {
    return { status: "skipped", reason: "action not in scheduled state" };
  }

  const [[block], [appt]] = await Promise.all([
    db
      .select({
        id: workflowActionBlocks.id,
        action_type: workflowActionBlocks.actionType,
        config: workflowActionBlocks.config,
        form_id: workflowActionBlocks.formId,
        parent_action_block_id: workflowActionBlocks.parentActionBlockId,
      })
      .from(workflowActionBlocks)
      .where(eq(workflowActionBlocks.id, claimed.action_block_id)),
    db
      .select({
        id: appointmentsT.id,
        patient_id: appointmentsT.patientId,
        scheduled_at: appointmentsT.scheduledAt,
        clinician_id: appointmentsT.clinicianId,
        org_id: appointmentsT.orgId,
        phone_number: appointmentsT.phoneNumber,
        location_id: appointmentsT.locationId,
      })
      .from(appointmentsT)
      .where(eq(appointmentsT.id, claimed.appointment_id)),
  ]);

  if (!block || !appt) {
    const error = "Missing action block or appointment data";
    await markActionOutcome(actionId, { kind: "failed", error });
    return { status: "failed", error };
  }

  // The independent per-action lookups, in parallel.
  const [[patient], [phone], [org], [clinician], [sessionData], [location]] =
    await Promise.all([
      appt.patient_id
        ? db
            .select({ first_name: patientsT.firstName })
            .from(patientsT)
            .where(eq(patientsT.id, appt.patient_id))
        : Promise.resolve([undefined]),
      appt.patient_id
        ? db
            .select({ phone_number: patientPhoneNumbers.phoneNumber })
            .from(patientPhoneNumbers)
            .where(
              and(
                eq(patientPhoneNumbers.patientId, appt.patient_id),
                eq(patientPhoneNumbers.isPrimary, true)
              )
            )
            .limit(1)
        : Promise.resolve([undefined]),
      db
        .select({ name: organisationsT.name })
        .from(organisationsT)
        .where(eq(organisationsT.id, appt.org_id)),
      appt.clinician_id
        ? db
            .select({ full_name: usersT.fullName })
            .from(usersT)
            .where(eq(usersT.id, appt.clinician_id))
        : Promise.resolve([undefined]),
      claimed.session_id
        ? db
            .select({ session_ended_at: sessionsT.sessionEndedAt })
            .from(sessionsT)
            .where(eq(sessionsT.id, claimed.session_id))
        : Promise.resolve([undefined]),
      appt.location_id
        ? db
            .select({ timezone: locationsT.timezone })
            .from(locationsT)
            .where(eq(locationsT.id, appt.location_id))
        : Promise.resolve([undefined]),
    ]);

  const outcome = await executeClaimedAction(
    claimed,
    block,
    appt,
    {
      patientFirstName: patient?.first_name ?? "",
      primaryPhone: phone?.phone_number ?? null,
      clinicName: org?.name ?? "the clinic",
      clinicianName: clinician?.full_name ?? null,
      timezone: location?.timezone ?? FALLBACK_TIMEZONE,
      sessionEndedAt: sessionData?.session_ended_at ?? null,
    },
    {
      evaluatePreconditions: false,
      suppressNotification: options.suppressNotification ?? false,
    }
  );

  if (outcome.kind === "failed") {
    return { status: "failed", error: outcome.error };
  }
  if (outcome.kind === "skipped") {
    return { status: "skipped", reason: "precondition not met" };
  }
  return { status: "fired", resultData: outcome.resultData };
}
