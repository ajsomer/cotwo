import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/forms/fill/[token] — resolve assignment for patient form fill
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const supabase = createServiceClient();

    const { data: assignment, error } = await supabase
      .from("form_assignments")
      .select("id, form_id, patient_id, schema_snapshot, status, completed_at")
      .eq("token", token)
      .single();

    if (error || !assignment) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (assignment.status === "completed") {
      return NextResponse.json(
        { error: "This form has already been submitted", completed: true },
        { status: 410 }
      );
    }

    // Get form name
    const { data: form } = await supabase
      .from("forms")
      .select("name, org_id")
      .eq("id", assignment.form_id)
      .single();

    // Get patient name
    const { data: patient } = await supabase
      .from("patients")
      .select("first_name")
      .eq("id", assignment.patient_id)
      .single();

    // Get org branding
    let org = null;
    if (form?.org_id) {
      const { data: orgData } = await supabase
        .from("organisations")
        .select("name, logo_url")
        .eq("id", form.org_id)
        .single();
      org = orgData;
    }

    // Transition status: pending/sent → opened
    if (assignment.status === "pending" || assignment.status === "sent") {
      await supabase
        .from("form_assignments")
        .update({ status: "opened", opened_at: new Date().toISOString() })
        .eq("id", assignment.id);
    }

    return NextResponse.json({
      assignment_id: assignment.id,
      form: {
        name: form?.name ?? "Form",
        schema: assignment.schema_snapshot,
      },
      patient: {
        first_name: patient?.first_name ?? null,
      },
      org: org ? { name: org.name, logo_url: org.logo_url } : null,
    });
  } catch (err) {
    console.error("[Forms] GET fill/[token] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/forms/fill/[token] — submit form responses
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const { responses } = body;

  if (!responses) {
    return NextResponse.json({ error: "responses required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data: assignment, error: assignError } = await supabase
      .from("form_assignments")
      .select("id, form_id, patient_id, appointment_id, status")
      .eq("token", token)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (assignment.status === "completed") {
      return NextResponse.json(
        { error: "This form has already been submitted" },
        { status: 410 }
      );
    }

    // Create submission
    const { data: submission, error: subError } = await supabase
      .from("form_submissions")
      .insert({
        form_id: assignment.form_id,
        patient_id: assignment.patient_id,
        appointment_id: assignment.appointment_id,
        responses,
      })
      .select("id")
      .single();

    if (subError) {
      return NextResponse.json({ error: subError.message }, { status: 500 });
    }

    // Update assignment to completed
    await supabase
      .from("form_assignments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        submission_id: submission.id,
      })
      .eq("id", assignment.id);

    console.log(`[Forms] Submission ${submission.id} created for assignment ${assignment.id}`);

    return NextResponse.json({ success: true, submission_id: submission.id });
  } catch (err) {
    console.error("[Forms] POST fill/[token] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
