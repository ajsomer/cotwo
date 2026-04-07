import { createServiceClient } from "@/lib/supabase/service";

/**
 * Schedule a pre-appointment workflow for a newly created appointment.
 *
 * Called from createSessions() after an appointment is created with a type
 * that has a linked pre-workflow.
 *
 * Algorithm:
 * 1. Look up the pre-workflow template via type_workflow_links
 * 2. Fetch all action blocks for that template
 * 3. Create an appointment_workflow_runs row
 * 4. For each action block, create an appointment_actions row with
 *    scheduled_for calculated from appointment.scheduled_at - offset_minutes
 *
 * If scheduled_for is in the past, the action will fire on the next daily scan.
 */
export async function scheduleWorkflowForAppointment(
  appointmentId: string,
  appointmentTypeId: string,
  scheduledAt: string
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
    // No pre-workflow for this type — nothing to do
    return;
  }

  // 2. Fetch action blocks
  const { data: blocks } = await supabase
    .from("workflow_action_blocks")
    .select("id, offset_minutes")
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

  // 4. Create appointment_actions for each block
  const apptTime = new Date(scheduledAt).getTime();
  const actionRows = blocks.map((block) => ({
    appointment_id: appointmentId,
    action_block_id: block.id,
    workflow_run_id: run.id,
    status: "scheduled" as const,
    scheduled_for: new Date(
      apptTime - block.offset_minutes * 60 * 1000
    ).toISOString(),
  }));

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

  console.log(
    `[WORKFLOW SCANNER] Scheduled ${blocks.length} actions for appointment ${appointmentId} (run ${run.id})`
  );
}
