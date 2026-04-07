import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSmsProvider } from "@/lib/sms";
import { getBaseUrl } from "@/lib/utils/url";

// POST /api/forms/assignments/send
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { assignment_id } = body;

  if (!assignment_id) {
    return NextResponse.json(
      { error: "assignment_id is required" },
      { status: 400 }
    );
  }

  try {
    const supabase = createServiceClient();

    // Fetch assignment with form name and patient details
    const { data: assignment, error: assignError } = await supabase
      .from("form_assignments")
      .select("id, token, status, patient_id, form_id")
      .eq("id", assignment_id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    if (assignment.status === "completed") {
      return NextResponse.json(
        { error: "Assignment already completed" },
        { status: 400 }
      );
    }

    // Get form name
    const { data: form } = await supabase
      .from("forms")
      .select("name")
      .eq("id", assignment.form_id)
      .single();

    // Get patient name and primary phone
    const { data: patient } = await supabase
      .from("patients")
      .select("first_name, last_name")
      .eq("id", assignment.patient_id)
      .single();

    const { data: phoneRecord } = await supabase
      .from("patient_phone_numbers")
      .select("phone_number")
      .eq("patient_id", assignment.patient_id)
      .eq("is_primary", true)
      .single();

    if (!phoneRecord) {
      return NextResponse.json(
        { error: "No phone number on file for this patient" },
        { status: 400 }
      );
    }

    const formName = form?.name ?? "form";
    const patientName = patient?.first_name ?? "there";
    const url = `${getBaseUrl()}/form/${assignment.token}`;
    const message = `Hi ${patientName}, please complete your ${formName} form before your appointment: ${url}`;

    const sms = getSmsProvider();
    const result = await sms.sendNotification(phoneRecord.phone_number, message);

    if (!result.success) {
      console.error("[Forms] SMS send failed:", result.error);
      return NextResponse.json(
        { error: "Failed to send SMS" },
        { status: 500 }
      );
    }

    // Update assignment status (forward-only: don't downgrade from opened)
    const updates: Record<string, unknown> = { sent_at: new Date().toISOString() };
    if (assignment.status === "pending") {
      updates.status = "sent";
    }

    await supabase
      .from("form_assignments")
      .update(updates)
      .eq("id", assignment_id);

    console.log(`[Forms] SMS sent for assignment ${assignment_id} to ${phoneRecord.phone_number}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Forms] Send SMS error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
