import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointmentActions, workflowActionBlocks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { broadcastReadinessChange } from "@/lib/realtime/broadcast";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * Shared handler for the two "mark as transcribed" endpoints
 * (`/api/tasks/mark-transcribed` for deliver_form actions,
 * `/api/tasks/mark-intake-transcribed` for intake_package actions).
 *
 * Both flip a completed appointment_action to 'transcribed' after the
 * receptionist has copied its contents into the clinic's PMS. The only
 * differences are the expected action type (defence-in-depth: a misuse of
 * one endpoint can't flip the other kind of action) and the wrong-type
 * error copy, so they're parameters here.
 *
 * Body: { action_id: string }.
 */
export async function markActionTranscribed(
  request: NextRequest,
  options: {
    /** The action_type this endpoint is allowed to transcribe. */
    expectedActionType: "deliver_form" | "intake_package";
    /** 400 copy when the action is a different type (kept per-endpoint). */
    wrongTypeMessage: string;
    /** Console tag, e.g. "mark-transcribed". */
    logTag: string;
  },
): Promise<NextResponse> {
  try {
    const { action_id } = await request.json();

    if (!action_id) {
      return NextResponse.json({ error: "action_id required" }, { status: 400 });
    }

    // Action + its block's type in one round trip. Left join so a missing
    // block still surfaces as the wrong-type 400 below, not a 404.
    const [action] = await db
      .select({
        id: appointmentActions.id,
        status: appointmentActions.status,
        appointment_id: appointmentActions.appointmentId,
        action_type: workflowActionBlocks.actionType,
      })
      .from(appointmentActions)
      .leftJoin(
        workflowActionBlocks,
        eq(workflowActionBlocks.id, appointmentActions.actionBlockId),
      )
      .where(eq(appointmentActions.id, action_id))
      .limit(1);

    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    // Authorize via the action's appointment before any mutation.
    if (!action.appointment_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const access = await requireStaffCanAccessAppointment(action.appointment_id);
    if (!access.ok) {
      return denyResponse(access);
    }

    if (action.status !== "completed") {
      return NextResponse.json(
        { error: `Action status is '${action.status}', expected 'completed'` },
        { status: 400 },
      );
    }

    if (action.action_type !== options.expectedActionType) {
      return NextResponse.json(
        { error: options.wrongTypeMessage },
        { status: 400 },
      );
    }

    await db
      .update(appointmentActions)
      .set({ status: "transcribed" })
      .where(eq(appointmentActions.id, action_id));

    // Notify the readiness dashboard at this appointment's location — the
    // gate already resolved location_id, so no extra appointment lookup.
    await broadcastReadinessChange(access.locationId, "action_resolved", {
      appointment_id: action.appointment_id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[${options.logTag}] Error:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
