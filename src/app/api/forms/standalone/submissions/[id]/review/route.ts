import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formSubmissions, forms as formsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { assertStaffCanAccessSubmission } from "@/lib/auth/staff-access";
import { broadcastOrgSubmissionChange } from "@/lib/realtime/broadcast";

/**
 * POST /api/forms/standalone/submissions/[id]/review
 *
 * Mark a standalone submission as reviewed. State machine (see spec):
 *   pending   → reviewed  (allowed, stamps reviewer)
 *   reviewed  → reviewed  (idempotent no-op, returns 200 without re-stamping)
 *   archived  → reviewed  (disallowed, 409)
 *   entry_flow row        (disallowed, 409 — those rows have review_status NULL)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const access = await assertStaffCanAccessSubmission(id);
  if (!access.ok) {
    return NextResponse.json({ error: "Not found" }, { status: access.status });
  }

  const [submission] = await db
    .select({
      id: formSubmissions.id,
      form_id: formSubmissions.formId,
      submission_source: formSubmissions.submissionSource,
      review_status: formSubmissions.reviewStatus,
      form_org_id: formsT.orgId,
    })
    .from(formSubmissions)
    .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, id));

  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (submission.submission_source === "entry_flow") {
    return NextResponse.json(
      { error: "Cannot review entry-flow submissions" },
      { status: 409 },
    );
  }

  // Idempotent no-op for already-reviewed.
  if (submission.review_status === "reviewed") {
    return NextResponse.json({ ok: true, review_status: "reviewed" });
  }
  // Archived is terminal.
  if (submission.review_status === "archived") {
    return NextResponse.json(
      { error: "Submission is archived; cannot move back to reviewed" },
      { status: 409 },
    );
  }
  if (submission.review_status !== "pending") {
    return NextResponse.json(
      { error: `Cannot transition from ${submission.review_status}` },
      { status: 409 },
    );
  }

  try {
    await db
      .update(formSubmissions)
      .set({
        reviewStatus: "reviewed",
        reviewedAt: new Date().toISOString(),
        reviewedBy: access.userId,
      })
      .where(eq(formSubmissions.id, id));
  } catch (updateError) {
    console.error("[standalone/review] update error:", updateError);
    return NextResponse.json(
      { error: "Failed to update review status" },
      { status: 500 },
    );
  }

  if (submission.form_org_id) {
    await broadcastOrgSubmissionChange(submission.form_org_id, "submission_reviewed", {
      submission_id: id,
    });
  }

  return NextResponse.json({ ok: true, review_status: "reviewed" });
}
