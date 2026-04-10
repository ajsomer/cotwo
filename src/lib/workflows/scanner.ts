import { createServiceClient } from "@/lib/supabase/service";

/**
 * Schedule a pre-appointment workflow for a newly created appointment.
 *
 * Called when an appointment is created with a type that has a linked
 * pre-workflow (from add-patient panel, PMS webhook, or daily scan).
 *
 * Algorithm:
 * 1. Look up the pre-workflow template via type_workflow_links
 * 2. Fetch all action blocks for that template
 * 3. Create an appointment_workflow_runs row
 * 4. For each action block, compute scheduled_for:
 *    - intake_package: fires immediately (now)
 *    - intake_reminder: parent intake_package's scheduled_for + offset_days
 *      (deterministic at instantiation, not based on fired_at)
 *    - add_to_runsheet: appointment.scheduled_at (offset 0)
 *    - legacy blocks: appointment.scheduled_at - offset_minutes (or now if null)
 * 5. For run_sheet workflows: drop any action whose scheduled_for falls
 *    after appointment.scheduled_at (mark as 'dropped')
 * 6. Insert action rows
 */
export async function scheduleWorkflowForAppointment(
  appointmentId: string,
  appointmentTypeId: string,
  scheduledAt: string | null
): Promise<void> {
  const supabase = createServiceClient();

  // 1. Look up pre-workflow link
  const { data: link } = await supabase
    .from("type_workflow_links")
    .select("workflow_template_id")
    .eq("appointment_type_id", appointmentTypeId)
    .eq("direction", "pre_appointment")
    .maybeSingle();

  if (!link) {
    return;
  }

  // 2. Fetch action blocks
  const { data: blocks } = await supabase
    .from("workflow_action_blocks")
    .select("id, action_type, offset_minutes, offset_direction, parent_action_block_id, config")
    .eq("template_id", link.workflow_template_id)
    .order("sort_order");

  if (!blocks || blocks.length === 0) {
    console.log(
      `[WORKFLOW SCANNER] Template ${link.workflow_template_id} has no action blocks. Skipping.`
    );
    return;
  }

  // 3. Create workflow run
  const { data: run, error: runError } = await supabase
    .from("appointment_workflow_runs")
    .insert({
      appointment_id: appointmentId,
      workflow_template_id: link.workflow_template_id,
      direction: "pre_appointment",
      status: "active",
    })
    .select("id")
    .single();

  if (runError || !run) {
    console.error(
      `[WORKFLOW SCANNER] Failed to create workflow run for appointment ${appointmentId}:`,
      runError?.message
    );
    return;
  }

  // 4. Compute scheduled_for for each block
  const now = Date.now();
  const apptTime = scheduledAt ? new Date(scheduledAt).getTime() : null;

  // Find the intake_package block's scheduled_for (it's always "now")
  const intakePackageScheduledFor = now;

  const actionRows: Array<{
    appointment_id: string;
    action_block_id: string;
    workflow_run_id: string;
    status: string;
    scheduled_for: string;
  }> = [];

  for (const block of blocks) {
    let scheduledFor: number;

    if (block.action_type === "intake_package") {
      // Fires immediately
      scheduledFor = now;
    } else if (block.action_type === "intake_reminder") {
      // Offset from the intake_package's scheduled_for (deterministic at instantiation)
      const config = block.config as { offset_days?: number } | null;
      const offsetDays = config?.offset_days ?? (block.offset_minutes / (60 * 24));
      scheduledFor = intakePackageScheduledFor + offsetDays * 24 * 60 * 60 * 1000;
    } else if (block.action_type === "add_to_runsheet") {
      // Fires at appointment time
      if (!apptTime) {
        // collection_only workflow shouldn't have add_to_runsheet, but guard anyway
        console.warn(
          `[WORKFLOW SCANNER] add_to_runsheet block on appointment with no scheduled_at. Dropping.`
        );
        actionRows.push({
          appointment_id: appointmentId,
          action_block_id: block.id,
          workflow_run_id: run.id,
          status: "dropped",
          scheduled_for: new Date(now).toISOString(),
        });
        continue;
      }
      scheduledFor = apptTime;
    } else {
      // Legacy action types: offset from appointment time (or now if no appointment time)
      const anchor = apptTime ?? now;
      scheduledFor = anchor - block.offset_minutes * 60 * 1000;
    }

    // 5. Drop actions that fall after appointment time (for run_sheet workflows)
    if (apptTime && block.action_type !== "add_to_runsheet" && scheduledFor > apptTime) {
      console.log(
        `[WORKFLOW SCANNER] Action block ${block.id} (${block.action_type}) scheduled after appointment. Dropping.`
      );
      actionRows.push({
        appointment_id: appointmentId,
        action_block_id: block.id,
        workflow_run_id: run.id,
        status: "dropped",
        scheduled_for: new Date(scheduledFor).toISOString(),
      });
      continue;
    }

    actionRows.push({
      appointment_id: appointmentId,
      action_block_id: block.id,
      workflow_run_id: run.id,
      status: "scheduled",
      scheduled_for: new Date(scheduledFor).toISOString(),
    });
  }

  // 6. Insert all action rows
  if (actionRows.length > 0) {
    const { error: actionsError } = await supabase
      .from("appointment_actions")
      .insert(actionRows);

    if (actionsError) {
      console.error(
        `[WORKFLOW SCANNER] Failed to create actions for run ${run.id}:`,
        actionsError.message
      );
      return;
    }
  }

  const scheduled = actionRows.filter((a) => a.status === "scheduled").length;
  const dropped = actionRows.filter((a) => a.status === "dropped").length;
  console.log(
    `[WORKFLOW SCANNER] Scheduled ${scheduled} actions (${dropped} dropped) for appointment ${appointmentId} (run ${run.id})`
  );
}
