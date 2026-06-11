import { NextRequest, NextResponse } from "next/server";
import { transitionStandaloneSubmission } from "@/lib/forms/standalone-review";

/**
 * POST /api/forms/standalone/submissions/[id]/review
 *
 * Mark a standalone submission as reviewed. State machine lives in
 * src/lib/forms/standalone-review.ts (shared with the archive endpoint):
 *   pending   → reviewed  (allowed, stamps reviewer)
 *   reviewed  → reviewed  (idempotent no-op, returns 200 without re-stamping)
 *   archived  → reviewed  (disallowed, 409)
 *   entry_flow row        (disallowed, 409 — those rows have review_status NULL)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return transitionStandaloneSubmission(id, "reviewed");
}
