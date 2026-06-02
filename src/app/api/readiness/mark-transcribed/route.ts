import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { broadcastReadinessChange } from "@/lib/realtime/broadcast";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";

/**
 * POST /api/readiness/mark-transcribed
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

    const supabase = createServiceClient();

    // Verify action exists, is deliver_form, and is in completed status
    const { data: action, error: fetchError } = await supabase
      .from("appointment_actions")
      .select("id, status, action_block_id, appointment_id")
      .eq("id", action_id)
      .single();

    if (fetchError || !action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    // Authorize via the action's appointment before any mutation.
    if (!action.appointment_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const access = await requireStaffCanAccessAppointment(
      supabase,
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
    const { data: block } = await supabase
      .from("workflow_action_blocks")
      .select("action_type")
      .eq("id", action.action_block_id)
      .single();

    if (!block || block.action_type !== "deliver_form") {
      return NextResponse.json(
        { error: "Only deliver_form actions can be marked as transcribed" },
        { status: 400 }
      );
    }

    // Update status to transcribed
    const { error: updateError } = await supabase
      .from("appointment_actions")
      .update({ status: "transcribed" })
      .eq("id", action_id);

    if (updateError) {
      console.error("[mark-transcribed] Update error:", updateError);
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
    console.error("[mark-transcribed] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
