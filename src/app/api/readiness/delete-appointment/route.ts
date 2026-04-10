import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/readiness/delete-appointment
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

    const supabase = createServiceClient();

    // Delete intake_package_journeys for this appointment
    await supabase
      .from("intake_package_journeys")
      .delete()
      .eq("appointment_id", appointment_id);

    // Delete appointment_actions (via workflow runs)
    const { data: runs } = await supabase
      .from("appointment_workflow_runs")
      .select("id")
      .eq("appointment_id", appointment_id);

    if (runs && runs.length > 0) {
      const runIds = runs.map((r) => r.id);
      await supabase
        .from("appointment_actions")
        .delete()
        .in("workflow_run_id", runIds);

      await supabase
        .from("appointment_workflow_runs")
        .delete()
        .eq("appointment_id", appointment_id);
    }

    // Delete any session_participants and sessions linked to this appointment
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id")
      .eq("appointment_id", appointment_id);

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);
      await supabase
        .from("session_participants")
        .delete()
        .in("session_id", sessionIds);

      await supabase
        .from("sessions")
        .delete()
        .eq("appointment_id", appointment_id);
    }

    // Delete the appointment itself
    const { error } = await supabase
      .from("appointments")
      .delete()
      .eq("id", appointment_id);

    if (error) {
      console.error("[delete-appointment] Error:", error);
      return NextResponse.json({ error: "Failed to delete appointment" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[delete-appointment] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
