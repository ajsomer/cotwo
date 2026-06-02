import { db } from "@/lib/db";
import {
  appointmentActions,
  workflowActionBlocks,
  appointments as appointmentsT,
  patients as patientsT,
  patientPhoneNumbers,
  organisations as organisationsT,
  users as usersT,
  sessions as sessionsT,
  appointmentWorkflowRuns,
} from "@/lib/db/schema";
import { and, eq, inArray, lte, notInArray } from "drizzle-orm";
import type { PreconditionConfig, ActionType } from "./types";
import { evaluatePrecondition } from "./preconditions";
import { executeHandler } from "./handlers";

interface ScanResult {
  fired: number;
  skipped: number;
  failed: number;
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
    })
    .from(appointmentsT)
    .where(inArray(appointmentsT.id, appointmentIds));

  const apptMap = new Map(appointments.map((a) => [a.id, a]));

  // Fetch patient details
  const patientIds = [...new Set(
    appointments.map((a) => a.patient_id).filter((x): x is string => !!x)
  )];

  const patientMap = new Map<string, { first_name: string; phone_number: string }>();
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
        phone_number: phoneMap.get(p.id) ?? "",
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
      await db
        .update(appointmentActions)
        .set({
          status: "failed",
          firedAt: new Date().toISOString(),
          errorMessage: "Missing action block or appointment data",
        })
        .where(eq(appointmentActions.id, action.id));
      result.failed++;
      continue;
    }

    const patientId = appt.patient_id;
    if (!patientId) {
      await db
        .update(appointmentActions)
        .set({
          status: "failed",
          firedAt: new Date().toISOString(),
          errorMessage: "No patient linked to appointment",
        })
        .where(eq(appointmentActions.id, action.id));
      result.failed++;
      continue;
    }

    const patient = patientMap.get(patientId);
    const isTaskAction = block.action_type === "task";

    // Task actions don't need a phone number (staff-facing, no SMS sent)
    if (!isTaskAction && !patient?.phone_number) {
      await db
        .update(appointmentActions)
        .set({
          status: "failed",
          firedAt: new Date().toISOString(),
          errorMessage: "No phone number on file for patient",
        })
        .where(eq(appointmentActions.id, action.id));
      result.failed++;
      continue;
    }

    // 2a: Evaluate precondition
    const precondition = block.precondition as PreconditionConfig;
    const shouldFire = await evaluatePrecondition(
      precondition,
      action.appointment_id,
      patientId
    );

    if (!shouldFire) {
      await db
        .update(appointmentActions)
        .set({
          status: "skipped",
          firedAt: new Date().toISOString(),
        })
        .where(eq(appointmentActions.id, action.id));
      result.skipped++;
      continue;
    }

    // 2b: Execute handler
    // For post-appointment actions, read config from the action's snapshot
    // (config snapshot discipline). For pre-appointment, read from the block.
    const actionConfig = action.session_id
      ? ((action as Record<string, unknown>).config as Record<string, unknown>) ?? (block.config as Record<string, unknown>) ?? {}
      : (block.config as Record<string, unknown>) ?? {};

    const sessionData = action.session_id
      ? sessionMap.get(action.session_id)
      : null;

    const handlerResult = await executeHandler(
      block.action_type as ActionType,
      {
        actionId: action.id,
        appointmentId: action.appointment_id,
        patientId,
        patientFirstName: patient?.first_name ?? "",
        phoneNumber: patient?.phone_number ?? "",
        scheduledAt: appt.scheduled_at ?? null,
        clinicName: orgNameMap.get(appt.org_id) ?? "the clinic",
        clinicianName: appt.clinician_id
          ? clinicianNameMap.get(appt.clinician_id) ?? null
          : null,
        formId: (action as Record<string, unknown>).form_id as string | null ?? block.form_id,
        config: actionConfig,
        parentActionBlockId: block.parent_action_block_id ?? null,
        sessionId: action.session_id ?? null,
        sessionEndedAt: sessionData?.session_ended_at ?? null,
      }
    );

    if (handlerResult.status === "failed") {
      console.error(
        `[WORKFLOW ENGINE] Action ${action.id} (${block.action_type}) failed: ${handlerResult.error}`
      );
      await db
        .update(appointmentActions)
        .set({
          status: "failed",
          firedAt: new Date().toISOString(),
          errorMessage: handlerResult.error,
        })
        .where(eq(appointmentActions.id, action.id));
      result.failed++;
    } else {
      await db
        .update(appointmentActions)
        .set({
          // Handler statuses are a superset of the DB enum (e.g. "fired");
          // write the value as-is, matching the prior Supabase behaviour.
          status: handlerResult.status as typeof appointmentActions.status.enumValues[number],
          firedAt: new Date().toISOString(),
          result: (handlerResult.resultData as Record<string, unknown>) ?? null,
        })
        .where(eq(appointmentActions.id, action.id));
      result.fired++;
    }
  }

  // Step 3: Check workflow run completion
  // Collect unique workflow run IDs from processed actions
  const runIds = [...new Set(
    actions.map((a) => a.workflow_run_id).filter((x): x is string => !!x)
  )];

  for (const runId of runIds) {
    const terminalStatuses: Array<typeof appointmentActions.status.enumValues[number]> = ["completed", "failed", "cancelled", "skipped", "dropped"];
    const remaining = await db
      .select({ id: appointmentActions.id })
      .from(appointmentActions)
      .where(
        and(
          eq(appointmentActions.workflowRunId, runId),
          notInArray(appointmentActions.status, terminalStatuses)
        )
      );

    if (remaining.length === 0) {
      await db
        .update(appointmentWorkflowRuns)
        .set({
          status: "complete",
          completedAt: new Date().toISOString(),
        })
        .where(eq(appointmentWorkflowRuns.id, runId));
    }
  }

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
 * Claims the action atomically (scheduled | firing → firing) so concurrent
 * scans don't double-fire. Skips precondition evaluation — the caller has
 * already decided this should fire now.
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

  const [block] = await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
      config: workflowActionBlocks.config,
      form_id: workflowActionBlocks.formId,
      parent_action_block_id: workflowActionBlocks.parentActionBlockId,
    })
    .from(workflowActionBlocks)
    .where(eq(workflowActionBlocks.id, claimed.action_block_id));
  if (!block) {
    await db
      .update(appointmentActions)
      .set({ status: "failed", firedAt: new Date().toISOString(), errorMessage: "missing block" })
      .where(eq(appointmentActions.id, actionId));
    return { status: "failed", error: "missing block" };
  }

  const [appt] = await db
    .select({
      id: appointmentsT.id,
      patient_id: appointmentsT.patientId,
      scheduled_at: appointmentsT.scheduledAt,
      clinician_id: appointmentsT.clinicianId,
      org_id: appointmentsT.orgId,
      phone_number: appointmentsT.phoneNumber,
    })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, claimed.appointment_id));
  if (!appt || !appt.patient_id) {
    await db
      .update(appointmentActions)
      .set({ status: "failed", firedAt: new Date().toISOString(), errorMessage: "missing appointment or patient" })
      .where(eq(appointmentActions.id, actionId));
    return { status: "failed", error: "missing appointment or patient" };
  }

  const [patient] = await db
    .select({ first_name: patientsT.firstName })
    .from(patientsT)
    .where(eq(patientsT.id, appt.patient_id));
  const [phone] = await db
    .select({ phone_number: patientPhoneNumbers.phoneNumber })
    .from(patientPhoneNumbers)
    .where(
      and(
        eq(patientPhoneNumbers.patientId, appt.patient_id),
        eq(patientPhoneNumbers.isPrimary, true)
      )
    )
    .limit(1);

  const org = appt.org_id
    ? (await db.select({ name: organisationsT.name }).from(organisationsT).where(eq(organisationsT.id, appt.org_id)))[0] ?? null
    : null;
  const clinician = appt.clinician_id
    ? (await db.select({ full_name: usersT.fullName }).from(usersT).where(eq(usersT.id, appt.clinician_id)))[0] ?? null
    : null;

  const sessionData = claimed.session_id
    ? (await db.select({ session_ended_at: sessionsT.sessionEndedAt }).from(sessionsT).where(eq(sessionsT.id, claimed.session_id)))[0] ?? null
    : null;

  const actionConfig = claimed.session_id
    ? ((claimed.config as Record<string, unknown>) ?? (block.config as Record<string, unknown>) ?? {})
    : ((block.config as Record<string, unknown>) ?? {});

  const handlerResult = await executeHandler(block.action_type as ActionType, {
    actionId: claimed.id,
    appointmentId: claimed.appointment_id,
    patientId: appt.patient_id,
    patientFirstName: patient?.first_name ?? "",
    phoneNumber: phone?.phone_number ?? appt.phone_number ?? "",
    scheduledAt: appt.scheduled_at ?? null,
    clinicName: org?.name ?? "the clinic",
    clinicianName: clinician?.full_name ?? null,
    formId: (claimed.form_id as string | null) ?? block.form_id,
    config: actionConfig,
    parentActionBlockId: block.parent_action_block_id ?? null,
    sessionId: claimed.session_id ?? null,
    sessionEndedAt: sessionData?.session_ended_at ?? null,
    suppressNotification: options.suppressNotification ?? false,
  });

  if (handlerResult.status === "failed") {
    await db
      .update(appointmentActions)
      .set({
        status: "failed",
        firedAt: new Date().toISOString(),
        errorMessage: handlerResult.error,
      })
      .where(eq(appointmentActions.id, actionId));
    return { status: "failed", error: handlerResult.error };
  }

  await db
    .update(appointmentActions)
    .set({
      // Handler statuses are a superset of the DB enum (e.g. "fired"); write
      // the value as-is, matching the prior Supabase behaviour.
      status: handlerResult.status as typeof appointmentActions.status.enumValues[number],
      firedAt: new Date().toISOString(),
      result: (handlerResult.resultData as Record<string, unknown>) ?? null,
    })
    .where(eq(appointmentActions.id, actionId));

  return {
    status: "fired",
    resultData: (handlerResult.resultData as Record<string, unknown>) ?? null,
  };
}
