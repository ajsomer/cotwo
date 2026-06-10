import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formSubmissions, forms as formsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { assertStaffCanAccessSubmission } from "@/lib/auth/staff-access";
import { broadcastOrgSubmissionChange } from "@/lib/realtime/broadcast";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * Shared state machine for the standalone-submission review endpoints
 * (`/api/forms/standalone/submissions/[id]/review` and `/[id]/archive`).
 *
 * One transition table, two routes:
 *   pending  → reviewed   (stamps reviewer)
 *   pending  → archived
 *   reviewed → archived
 *   X → X                 (idempotent no-op, 200 without re-stamping)
 *   archived → reviewed   (409 — archive is terminal)
 *   entry_flow rows       (409 — their review_status is NULL by design)
 */
const TRANSITIONS = {
  reviewed: {
    verb: "review",
    allowedFrom: ["pending"],
    // Per-state 409 copy that overrides the generic "Cannot transition" line.
    blockedCopy: {
      archived: "Submission is archived; cannot move back to reviewed",
    } as Record<string, string>,
    event: "submission_reviewed" as const,
    logTag: "standalone/review",
  },
  archived: {
    verb: "archive",
    allowedFrom: ["pending", "reviewed"],
    blockedCopy: {} as Record<string, string>,
    event: "submission_archived" as const,
    logTag: "standalone/archive",
  },
};

export async function transitionStandaloneSubmission(
  submissionId: string,
  target: "reviewed" | "archived",
): Promise<NextResponse> {
  const rules = TRANSITIONS[target];

  if (!submissionId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const access = await assertStaffCanAccessSubmission(submissionId);
  if (!access.ok) {
    return denyResponse(access);
  }

  const [submission] = await db
    .select({
      id: formSubmissions.id,
      submission_source: formSubmissions.submissionSource,
      review_status: formSubmissions.reviewStatus,
      form_org_id: formsT.orgId,
    })
    .from(formSubmissions)
    .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, submissionId));

  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (submission.submission_source === "entry_flow") {
    return NextResponse.json(
      { error: `Cannot ${rules.verb} entry-flow submissions` },
      { status: 409 },
    );
  }

  // Idempotent no-op when already at the target state.
  if (submission.review_status === target) {
    return NextResponse.json({ ok: true, review_status: target });
  }

  const current = submission.review_status ?? "";
  if (!rules.allowedFrom.includes(current)) {
    const copy =
      rules.blockedCopy[current] ??
      `Cannot transition from ${submission.review_status}`;
    return NextResponse.json({ error: copy }, { status: 409 });
  }

  try {
    await db
      .update(formSubmissions)
      .set({
        reviewStatus: target,
        reviewedAt: new Date().toISOString(),
        reviewedBy: access.userId,
      })
      .where(eq(formSubmissions.id, submissionId));
  } catch (updateError) {
    console.error(`[${rules.logTag}] update error:`, updateError);
    return NextResponse.json(
      { error: "Failed to update review status" },
      { status: 500 },
    );
  }

  if (submission.form_org_id) {
    await broadcastOrgSubmissionChange(submission.form_org_id, rules.event, {
      submission_id: submissionId,
    });
  }

  return NextResponse.json({ ok: true, review_status: target });
}
