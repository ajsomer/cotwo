import { NextRequest, NextResponse } from "next/server";
import { transitionStandaloneSubmission } from "@/lib/forms/standalone-review";

/**
 * POST /api/forms/standalone/submissions/[id]/archive
 *
 * Archive a standalone submission. State machine lives in
 * src/lib/forms/standalone-review.ts (shared with the review endpoint):
 *   pending   → archived  (allowed)
 *   reviewed  → archived  (allowed)
 *   archived  → archived  (idempotent no-op)
 *   entry_flow row        (disallowed, 409)
 *
 * Archive is terminal — once archived a submission can't transition back.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return transitionStandaloneSubmission(id, "archived");
}
