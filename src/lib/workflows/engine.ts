import { createServiceClient } from "@/lib/supabase/service";
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
  const supabase = createServiceClient();
  const result: ScanResult = { fired: 0, skipped: 0, failed: 0 };

  console.log(
    options.appointmentId
      ? `[WORKFLOW ENGINE] Scan starting for appointment ${options.appointmentId}...`
      : "[WORKFLOW ENGINE] Scan starting..."
  );

  // Step 1: Claim — atomically move scheduled → firing
  let claimQuery = supabase
    .from("appointment_actions")
    .update({ status: "firing" })
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString());

  if (options.appointmentId) {
    claimQuery = claimQuery.eq("appointment_id", options.appointmentId);
  }

  const { data: claimed, error: claimError } = await claimQuery.select(
    "id, appointment_id, action_block_id, workflow_run_id, scheduled_for, session_id, config, form_id"
  );

  if (claimError) {
    console.error("[WORKFLOW ENGINE] Claim failed:", claimError.message);
    return result;
  }

  const actions = claimed ?? [];
  console.log(`[WORKFLOW ENGINE] Claimed ${actions.length} actions to process`);

  if (actions.length === 0) return result;

  // Fetch action block details for all claimed actions
  const blockIds = [...new Set(actions.map((a) => a.action_block_id))];
  const { data: blocks } = await supabase
    .from("workflow_action_blocks")
    .select("id, action_type, config, precondition, form_id, parent_action_block_id")
    .in("id", blockIds);

  const blockMap = new Map(
    (blocks ?? []).map((b) => [b.id, b])
  );

  // Fetch appointment details for all claimed actions
  const appointmentIds = [...new Set(actions.map((a) => a.appointment_id))];
  const { data: appointments } = await supabase
    .from("appointments")
    .select("id, patient_id, scheduled_at, clinician_id, org_id, phone_number")
    .in("id", appointmentIds);

  const apptMap = new Map(
    (appointments ?? []).map((a) => [a.id, a])
  );

  // Fetch patient details
  const patientIds = [...new Set(
    (appointments ?? []).map((a) => a.patient_id).filter(Boolean)
  )] as string[];

  const patientMap = new Map<string, { first_name: string; phone_number: string }>();
  if (patientIds.length > 0) {
    const { data: patients } = await supabase
      .from("patients")
      .select("id, first_name")
      .in("id", patientIds);

    const { data: phones } = await supabase
      .from("patient_phone_numbers")
      .select("patient_id, phone_number")
      .in("patient_id", patientIds)
      .eq("is_primary", true);

    const phoneMap = new Map(
      (phones ?? []).map((p) => [p.patient_id, p.phone_number])
    );

    for (const p of patients ?? []) {
      patientMap.set(p.id, {
        first_name: p.first_name,
        phone_number: phoneMap.get(p.id) ?? "",
      });
    }
  }

  // Fetch org names for clinic_name interpolation
  const orgIds = [...new Set(
    (appointments ?? []).map((a) => a.org_id).filter(Boolean)
  )];
  const orgNameMap = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await supabase
      .from("organisations")
      .select("id, name")
      .in("id", orgIds);
    for (const o of orgs ?? []) {
      orgNameMap.set(o.id, o.name);
    }
  }

  // Fetch clinician names
  const clinicianIds = [...new Set(
    (appointments ?? []).map((a) => a.clinician_id).filter(Boolean)
  )] as string[];
  const clinicianNameMap = new Map<string, string>();
  if (clinicianIds.length > 0) {
    const { data: clinicians } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", clinicianIds);
    for (const c of clinicians ?? []) {
      clinicianNameMap.set(c.id, c.full_name);
    }
  }

  // Fetch session data for post-appointment actions
  const sessionIds = [...new Set(
    actions.map((a) => a.session_id).filter(Boolean)
  )] as string[];
  const sessionMap = new Map<string, { session_ended_at: string | null }>();
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, session_ended_at")
      .in("id", sessionIds);
    for (const s of sessions ?? []) {
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
      await supabase
        .from("appointment_actions")
        .update({
          status: "failed",
          fired_at: new Date().toISOString(),
          error_message: "Missing action block or appointment data",
        })
        .eq("id", action.id);
      result.failed++;
      continue;
    }

    const patientId = appt.patient_id;
    if (!patientId) {
      console.log(
        `[WORKFLOW ENGINE] No patient on appointment ${appt.id} for action ${action.id}. Marking failed.`
      );
      await supabase
        .from("appointment_actions")
        .update({
          status: "failed",
          fired_at: new Date().toISOString(),
          error_message: "No patient linked to appointment",
        })
        .eq("id", action.id);
      result.failed++;
      continue;
    }

    const patient = patientMap.get(patientId);
    const isTaskAction = block.action_type === "task";

    // Task actions don't need a phone number (staff-facing, no SMS sent)
    if (!isTaskAction && !patient?.phone_number) {
      console.log(
        `[WORKFLOW ENGINE] No phone number for patient ${patientId} on action ${action.id}. Marking failed.`
      );
      await supabase
        .from("appointment_actions")
        .update({
          status: "failed",
          fired_at: new Date().toISOString(),
          error_message: "No phone number on file for patient",
        })
        .eq("id", action.id);
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
      console.log(
        `[WORKFLOW ENGINE] Precondition not met for action ${action.id} (${block.action_type}). Skipping.`
      );
      await supabase
        .from("appointment_actions")
        .update({
          status: "skipped",
          fired_at: new Date().toISOString(),
        })
        .eq("id", action.id);
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
      await supabase
        .from("appointment_actions")
        .update({
          status: "failed",
          fired_at: new Date().toISOString(),
          error_message: handlerResult.error,
        })
        .eq("id", action.id);
      result.failed++;
    } else {
      console.log(
        `[WORKFLOW ENGINE] Action ${action.id} (${block.action_type}) → ${handlerResult.status}`
      );
      await supabase
        .from("appointment_actions")
        .update({
          status: handlerResult.status,
          fired_at: new Date().toISOString(),
          result: (handlerResult.resultData as Record<string, unknown>) ?? null,
        })
        .eq("id", action.id);
      result.fired++;
    }
  }

  // Step 3: Check workflow run completion
  // Collect unique workflow run IDs from processed actions
  const runIds = [...new Set(
    actions.map((a) => a.workflow_run_id).filter(Boolean)
  )] as string[];

  for (const runId of runIds) {
    const terminalStatuses = ["completed", "failed", "cancelled", "skipped", "dropped"];
    const { data: remaining } = await supabase
      .from("appointment_actions")
      .select("id")
      .eq("workflow_run_id", runId)
      .not("status", "in", `(${terminalStatuses.join(",")})`);

    if (remaining && remaining.length === 0) {
      await supabase
        .from("appointment_workflow_runs")
        .update({
          status: "complete",
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      console.log(`[WORKFLOW ENGINE] Run ${runId} complete — all actions terminal`);
    }
  }

  console.log(
    `[WORKFLOW ENGINE] Scan complete. Fired: ${result.fired}, Skipped: ${result.skipped}, Failed: ${result.failed}`
  );

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
  actionId: string
): Promise<
  | { status: "fired"; resultData: Record<string, unknown> | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }
> {
  const supabase = createServiceClient();

  // Atomic claim: only transition scheduled → firing. If another process
  // already claimed it, or it's already terminal, return skipped.
  const { data: claimed } = await supabase
    .from("appointment_actions")
    .update({ status: "firing" })
    .eq("id", actionId)
    .eq("status", "scheduled")
    .select("id, appointment_id, action_block_id, session_id, config, form_id")
    .maybeSingle();

  if (!claimed) {
    return { status: "skipped", reason: "action not in scheduled state" };
  }

  const { data: block } = await supabase
    .from("workflow_action_blocks")
    .select("id, action_type, config, form_id, parent_action_block_id")
    .eq("id", claimed.action_block_id)
    .single();
  if (!block) {
    await supabase
      .from("appointment_actions")
      .update({ status: "failed", fired_at: new Date().toISOString(), error_message: "missing block" })
      .eq("id", actionId);
    return { status: "failed", error: "missing block" };
  }

  const { data: appt } = await supabase
    .from("appointments")
    .select("id, patient_id, scheduled_at, clinician_id, org_id, phone_number")
    .eq("id", claimed.appointment_id)
    .single();
  if (!appt || !appt.patient_id) {
    await supabase
      .from("appointment_actions")
      .update({ status: "failed", fired_at: new Date().toISOString(), error_message: "missing appointment or patient" })
      .eq("id", actionId);
    return { status: "failed", error: "missing appointment or patient" };
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("first_name")
    .eq("id", appt.patient_id)
    .single();
  const { data: phone } = await supabase
    .from("patient_phone_numbers")
    .select("phone_number")
    .eq("patient_id", appt.patient_id)
    .eq("is_primary", true)
    .maybeSingle();

  const { data: org } = appt.org_id
    ? await supabase.from("organisations").select("name").eq("id", appt.org_id).single()
    : { data: null };
  const { data: clinician } = appt.clinician_id
    ? await supabase.from("users").select("full_name").eq("id", appt.clinician_id).single()
    : { data: null };

  const sessionData = claimed.session_id
    ? (await supabase
        .from("sessions")
        .select("session_ended_at")
        .eq("id", claimed.session_id)
        .single()).data
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
  });

  if (handlerResult.status === "failed") {
    await supabase
      .from("appointment_actions")
      .update({
        status: "failed",
        fired_at: new Date().toISOString(),
        error_message: handlerResult.error,
      })
      .eq("id", actionId);
    return { status: "failed", error: handlerResult.error };
  }

  await supabase
    .from("appointment_actions")
    .update({
      status: handlerResult.status,
      fired_at: new Date().toISOString(),
      result: (handlerResult.resultData as Record<string, unknown>) ?? null,
    })
    .eq("id", actionId);

  return {
    status: "fired",
    resultData: (handlerResult.resultData as Record<string, unknown>) ?? null,
  };
}
