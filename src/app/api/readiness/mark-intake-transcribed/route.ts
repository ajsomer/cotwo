import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { broadcastReadinessChange } from "@/lib/realtime/broadcast";

/**
 * POST /api/readiness/mark-intake-transcribed
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

    const supabase = createServiceClient();

    const { data: action, error: fetchError } = await supabase
      .from("appointment_actions")
      .select("id, status, action_block_id, appointment_id")
      .eq("id", action_id)
      .single();

    if (fetchError || !action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
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
    const { data: block } = await supabase
      .from("workflow_action_blocks")
      .select("action_type")
      .eq("id", action.action_block_id)
      .single();

    if (!block || block.action_type !== "intake_package") {
      return NextResponse.json(
        { error: "Only intake_package actions can be marked transcribed via this endpoint" },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("appointment_actions")
      .update({ status: "transcribed" })
      .eq("id", action_id);

    if (updateError) {
      console.error("[mark-intake-transcribed] Update error:", updateError);
      return NextResponse.json({ error: "Failed to update action status" }, { status: 500 });
    }

    // Notify the readiness dashboard at this appointment's location.
    if (action.appointment_id) {
      const { data: appt } = await supabase
        .from("appointments")
        .select("location_id")
        .eq("id", action.appointment_id)
        .maybeSingle();
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
