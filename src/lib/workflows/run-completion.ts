import { db } from "@/lib/db";
import { appointmentActions, appointmentWorkflowRuns } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";

/**
 * Workflow-run completion — the single home for "is this run finished?".
 * Previously three hand-rolled copies (engine batch loop, resolveTask,
 * cancelAction), so adding an action status required three edits or runs
 * never closed.
 */

/**
 * Action statuses that count as "this action will never fire again".
 *
 * NOT the same set as the readiness dashboard's `TERMINAL_STATUSES`
 * (`src/lib/readiness/derived-state.ts`), which is a UI-display notion of
 * "nothing left to do" — it includes patient-completion states (`captured`,
 * `verified`, `transcribed`) and excludes `cancelled`/`dropped`. Don't merge
 * them without reconciling those semantics.
 */
export const TERMINAL_ACTION_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "skipped",
  "dropped",
] as const;

/**
 * Mark complete every given workflow run that has no non-terminal actions
 * remaining. One grouped query for the whole batch (the engine previously
 * looped a query per run). Null/undefined ids are tolerated and ignored.
 */
export async function maybeCompleteWorkflowRuns(
  runIds: Array<string | null | undefined>
): Promise<void> {
  const ids = [...new Set(runIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;

  const terminalList = sql.join(
    TERMINAL_ACTION_STATUSES.map((s) => sql`${s}`),
    sql`, `
  );
  const completable = await db
    .select({ runId: appointmentActions.workflowRunId })
    .from(appointmentActions)
    .where(inArray(appointmentActions.workflowRunId, ids))
    .groupBy(appointmentActions.workflowRunId)
    .having(
      sql`count(*) filter (where ${appointmentActions.status}::text not in (${terminalList})) = 0`
    );

  const completeIds = completable
    .map((r) => r.runId)
    .filter((x): x is string => !!x);
  if (completeIds.length === 0) return;

  await db
    .update(appointmentWorkflowRuns)
    .set({ status: "complete", completedAt: new Date().toISOString() })
    .where(inArray(appointmentWorkflowRuns.id, completeIds));
}
