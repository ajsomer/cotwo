import { NextRequest, NextResponse } from "next/server";
import { markActionTranscribed } from "@/lib/workflows/mark-transcribed";

/**
 * POST /api/tasks/mark-transcribed
 *
 * Marks a deliver_form action as transcribed after the receptionist has copied
 * the form data into the clinic's PMS. Only valid for deliver_form actions in
 * 'completed' status. Shared machinery: src/lib/workflows/mark-transcribed.ts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return markActionTranscribed(request, {
    expectedActionType: "deliver_form",
    wrongTypeMessage: "Only deliver_form actions can be marked as transcribed",
    logTag: "mark-transcribed",
  });
}
