import { NextRequest, NextResponse } from "next/server";
import { markActionTranscribed } from "@/lib/workflows/mark-transcribed";

/**
 * POST /api/tasks/mark-intake-transcribed
 *
 * Marks an intake_package appointment_action as transcribed after the
 * receptionist or practice manager has copied the package contents (forms,
 * card, consent) into the clinic's PMS. Mirrors the deliver_form
 * mark-transcribed path: source of truth is appointment_actions.status.
 *
 * Independent of any other scheduled action — does NOT cancel or skip
 * add_to_runsheet etc. Shared machinery: src/lib/workflows/mark-transcribed.ts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return markActionTranscribed(request, {
    expectedActionType: "intake_package",
    wrongTypeMessage:
      "Only intake_package actions can be marked transcribed via this endpoint",
    logTag: "mark-intake-transcribed",
  });
}
