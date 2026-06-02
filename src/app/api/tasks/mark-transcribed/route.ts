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

/**
 * POST /api/tasks/mark-transcribed
 *
 * Marks a deliver_form action as transcribed after the receptionist has copied
 * the form data into the clinic's PMS. Only valid for deliver_form actions in
 * 'completed' status.
 */
export async function POST(request: NextRequest) {
  try {
    const { action_id } = await request.json();

    if (!action_id) {
      return NextResponse.json({ error: "action_id required" }, { status: 400 });
    }

    // Verify action exists, is deliver_form, and is in completed status
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
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status },
      );
    }

    if (action.status !== "completed") {
      return NextResponse.json(
        { error: `Action status is '${action.status}', expected 'completed'` },
        { status: 400 }
      );
    }

    // Verify action type is deliver_form
    const [block] = await db
      .select({ action_type: workflowActionBlocks.actionType })
      .from(workflowActionBlocks)
      .where(eq(workflowActionBlocks.id, action.action_block_id))
      .limit(1);

    if (!block || block.action_type !== "deliver_form") {
      return NextResponse.json(
        { error: "Only deliver_form actions can be marked as transcribed" },
        { status: 400 }
      );
    }

    // Update status to transcribed
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
    console.error("[mark-transcribed] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
