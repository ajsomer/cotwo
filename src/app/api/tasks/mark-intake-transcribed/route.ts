import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointmentActions,
  workflowActionBlocks,
  appointments as appointmentsT,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { broadcastReadinessChange } from "@/lib/realtime/broadcast";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * POST /api/tasks/mark-intake-transcribed
 *
 * Marks an intake_package appointment_action as transcribed after the
 * receptionist or practice manager has copied the package contents (forms,
 * card, consent) into the clinic's PMS. Mirrors the legacy deliver_form
 * mark-transcribed path: source of truth is appointment_actions.status.
 *
 * Independent of any other scheduled action — does NOT cancel or skip
 * add_to_runsheet etc.
 *
 * Body: { action_id: string } — id of the intake_package appointment_actions row.
 */
export async function POST(request: NextRequest) {
  try {
    const { action_id } = await request.json();

    if (!action_id) {
      return NextResponse.json({ error: "action_id required" }, { status: 400 });
    }

    const [action] = await db
      .select({
        id: appointmentActions.id,
        status: appointmentActions.status,
        action_block_id: appointmentActions.actionBlockId,
        appointment_id: appointmentActions.appointmentId,
      })
      .from(appointmentActions)
      .where(eq(appointmentActions.id, action_id))
      .limit(1);

    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    // Authorize via the action's appointment before any mutation.
    if (!action.appointment_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const access = await requireStaffCanAccessAppointment(
      action.appointment_id,
    );
    if (!access.ok) {
      return denyResponse(access);
    }

    if (action.status !== "completed") {
      return NextResponse.json(
        { error: `Action status is '${action.status}', expected 'completed'` },
        { status: 400 }
      );
    }

    // Verify the action is an intake_package (defence-in-depth — the panel
    // only opens for intake_package actions but a misuse of the endpoint
    // shouldn't be able to flip an unrelated action).
    const [block] = await db
      .select({ action_type: workflowActionBlocks.actionType })
      .from(workflowActionBlocks)
      .where(eq(workflowActionBlocks.id, action.action_block_id))
      .limit(1);

    if (!block || block.action_type !== "intake_package") {
      return NextResponse.json(
        { error: "Only intake_package actions can be marked transcribed via this endpoint" },
        { status: 400 }
      );
    }

    await db
      .update(appointmentActions)
      .set({ status: "transcribed" })
      .where(eq(appointmentActions.id, action_id));

    // Notify the readiness dashboard at this appointment's location.
    if (action.appointment_id) {
      const [appt] = await db
        .select({ location_id: appointmentsT.locationId })
        .from(appointmentsT)
        .where(eq(appointmentsT.id, action.appointment_id))
        .limit(1);
      if (appt?.location_id) {
        await broadcastReadinessChange(appt.location_id, "action_resolved", {
          appointment_id: action.appointment_id,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[mark-intake-transcribed] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
