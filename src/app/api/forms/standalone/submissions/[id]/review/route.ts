import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
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

  const supabase = createServiceClient();
  const access = await assertStaffCanAccessSubmission(supabase, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Not found" }, { status: access.status });
  }

  const { data: submission } = await supabase
    .from("form_submissions")
    .select("id, form_id, submission_source, review_status, forms!inner(org_id)")
    .eq("id", id)
    .single();

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

  const { error: updateError } = await supabase
    .from("form_submissions")
    .update({
      review_status: "reviewed",
      reviewed_at: new Date().toISOString(),
      reviewed_by: access.userId,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[standalone/review] update error:", updateError);
    return NextResponse.json(
      { error: "Failed to update review status" },
      { status: 500 },
    );
  }

  const form = Array.isArray(submission.forms)
    ? submission.forms[0]
    : submission.forms;
  if (form?.org_id) {
    await broadcastOrgSubmissionChange(form.org_id, "submission_reviewed", {
      submission_id: id,
    });
  }

  return NextResponse.json({ ok: true, review_status: "reviewed" });
}
