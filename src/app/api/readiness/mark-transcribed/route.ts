import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

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
      .select("id, status, action_block_id")
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[mark-transcribed] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
