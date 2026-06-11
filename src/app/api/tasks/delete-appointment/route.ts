import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  intakePackageJourneys,
  appointmentWorkflowRuns,
  appointmentActions,
  sessions as sessionsT,
  sessionParticipants,
  appointments as appointmentsT,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * POST /api/tasks/delete-appointment
 *
 * Deletes an appointment and its associated workflow runs and actions.
 * Used from the Readiness Dashboard patient detail panel.
 */
export async function POST(request: NextRequest) {
  try {
    const { appointment_id } = await request.json();

    if (!appointment_id) {
      return NextResponse.json({ error: "appointment_id required" }, { status: 400 });
    }

    const access = await requireStaffCanAccessAppointment(appointment_id);
    if (!access.ok) {
      return denyResponse(access);
    }

    // Delete intake_package_journeys for this appointment
    await db
      .delete(intakePackageJourneys)
      .where(eq(intakePackageJourneys.appointmentId, appointment_id));

    // Delete appointment_actions (via workflow runs)
    const runs = await db
      .select({ id: appointmentWorkflowRuns.id })
      .from(appointmentWorkflowRuns)
      .where(eq(appointmentWorkflowRuns.appointmentId, appointment_id));

    if (runs.length > 0) {
      const runIds = runs.map((r) => r.id);
      await db
        .delete(appointmentActions)
        .where(inArray(appointmentActions.workflowRunId, runIds));

      await db
        .delete(appointmentWorkflowRuns)
        .where(eq(appointmentWorkflowRuns.appointmentId, appointment_id));
    }

    // Delete any session_participants and sessions linked to this appointment
    const sessions = await db
      .select({ id: sessionsT.id })
      .from(sessionsT)
      .where(eq(sessionsT.appointmentId, appointment_id));

    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);
      await db
        .delete(sessionParticipants)
        .where(inArray(sessionParticipants.sessionId, sessionIds));

      await db
        .delete(sessionsT)
        .where(eq(sessionsT.appointmentId, appointment_id));
    }

    // Delete the appointment itself
    await db.delete(appointmentsT).where(eq(appointmentsT.id, appointment_id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[delete-appointment] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
