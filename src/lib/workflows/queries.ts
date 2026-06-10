import { db } from "@/lib/db";
import { appointmentActions, workflowActionBlocks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { ActionType } from "@/lib/workflows/types";

export interface AppointmentActionOfType {
  id: string;
  status: string;
  action_block_id: string;
  completed_at: string | null;
  /** The owning block's config jsonb (intake_package composition, etc.). */
  block_config: Record<string, unknown> | null;
}

/**
 * All of an appointment's actions whose block is of the given action type,
 * in one joined query.
 *
 * Replaces the recurring two-round-trip pattern "select appointment_actions
 * by appointment_id → select workflow_action_blocks by ids → filter by
 * action_type in JS" (intake handoff panel, intake complete-item, PMS session
 * gate). For the multi-appointment dashboards (readiness, workflow-actions
 * fetcher, engine claim path) that need ALL types, keep their bulk
 * actions+blocks reads — this helper is for the single-appointment,
 * single-type lookups.
 */
export async function findAppointmentActionsByType(
  appointmentId: string,
  actionType: ActionType,
): Promise<AppointmentActionOfType[]> {
  const rows = await db
    .select({
      id: appointmentActions.id,
      status: appointmentActions.status,
      action_block_id: appointmentActions.actionBlockId,
      completed_at: appointmentActions.completedAt,
      block_config: workflowActionBlocks.config,
    })
    .from(appointmentActions)
    .innerJoin(
      workflowActionBlocks,
      eq(workflowActionBlocks.id, appointmentActions.actionBlockId),
    )
    .where(
      and(
        eq(appointmentActions.appointmentId, appointmentId),
        eq(workflowActionBlocks.actionType, actionType),
      ),
    );

  return rows.map((r) => ({
    ...r,
    block_config: (r.block_config ?? null) as Record<string, unknown> | null,
  }));
}
