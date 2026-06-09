import { db } from "@/lib/db";
import {
  typeWorkflowLinks,
  workflowActionBlocks,
  appointmentWorkflowRuns,
  appointmentActions,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { executeScheduledActions } from "./engine";

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
  // 1. Look up pre-workflow link
  const [link] = await db
    .select({ workflow_template_id: typeWorkflowLinks.workflowTemplateId })
    .from(typeWorkflowLinks)
    .where(
      and(
        eq(typeWorkflowLinks.appointmentTypeId, appointmentTypeId),
        eq(typeWorkflowLinks.direction, "pre_appointment")
      )
    )
    .limit(1);

  if (!link) {
    return;
  }

  // 2. Fetch action blocks
  const blocks = await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
      offset_minutes: workflowActionBlocks.offsetMinutes,
      offset_direction: workflowActionBlocks.offsetDirection,
      parent_action_block_id: workflowActionBlocks.parentActionBlockId,
      config: workflowActionBlocks.config,
    })
    .from(workflowActionBlocks)
    .where(eq(workflowActionBlocks.templateId, link.workflow_template_id))
    .orderBy(asc(workflowActionBlocks.sortOrder));

  if (blocks.length === 0) {
    return;
  }

  // 3. Create workflow run
  let run: { id: string } | undefined;
  try {
    [run] = await db
      .insert(appointmentWorkflowRuns)
      .values({
        appointmentId,
        workflowTemplateId: link.workflow_template_id,
        direction: "pre_appointment",
        status: "active",
      })
      .returning({ id: appointmentWorkflowRuns.id });
  } catch (runError) {
    console.error(
      `[WORKFLOW SCANNER] Failed to create workflow run for appointment ${appointmentId}:`,
      (runError as Error)?.message
    );
    return;
  }

  if (!run) {
    console.error(
      `[WORKFLOW SCANNER] Failed to create workflow run for appointment ${appointmentId}: no row returned`
    );
    return;
  }

  // 4. Compute scheduled_for for each block
  const now = Date.now();
  const apptTime = scheduledAt ? new Date(scheduledAt).getTime() : null;

  // Find the intake_package block's scheduled_for (it's always "now")
  const intakePackageScheduledFor = now;

  const actionRows: Array<{
    appointmentId: string;
    actionBlockId: string;
    workflowRunId: string;
    status: "scheduled" | "dropped";
    scheduledFor: string;
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
          appointmentId,
          actionBlockId: block.id,
          workflowRunId: run.id,
          status: "dropped",
          scheduledFor: new Date(now).toISOString(),
        });
        continue;
      }
      scheduledFor = apptTime;
    } else {
      // Legacy action types: offset from appointment time (or now if no appointment time)
      const anchor = apptTime ?? now;
      scheduledFor = anchor - block.offset_minutes * 60 * 1000;
    }

    // 5. Drop actions that fall after appointment time (for run_sheet workflows).
    //    Exempt add_to_runsheet (fires AT appointment time) and intake_package
    //    (fires "now" — sending intake is always valid even for an imminent or
    //    just-synced appointment; only future-dated reminders are dropped late).
    if (
      apptTime &&
      block.action_type !== "add_to_runsheet" &&
      block.action_type !== "intake_package" &&
      scheduledFor > apptTime
    ) {
      actionRows.push({
        appointmentId,
        actionBlockId: block.id,
        workflowRunId: run.id,
        status: "dropped",
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      continue;
    }

    actionRows.push({
      appointmentId,
      actionBlockId: block.id,
      workflowRunId: run.id,
      status: "scheduled",
      scheduledFor: new Date(scheduledFor).toISOString(),
    });
  }

  // 6. Insert all action rows
  if (actionRows.length > 0) {
    try {
      await db.insert(appointmentActions).values(actionRows);
    } catch (actionsError) {
      console.error(
        `[WORKFLOW SCANNER] Failed to create actions for run ${run.id}:`,
        (actionsError as Error).message
      );
      return;
    }
  }

  // Fire immediately-due actions (e.g. intake_package) synchronously so the
  // patient gets their SMS the moment the clinic adds them, without waiting
  // for the daily-scan cron. Future-dated actions (reminders, add_to_runsheet
  // the morning of the appointment) remain queued for the cron.
  try {
    await executeScheduledActions({ appointmentId });
  } catch (err) {
    console.error(
      `[WORKFLOW SCANNER] Immediate execution failed for appointment ${appointmentId}:`,
      err
    );
  }
}
