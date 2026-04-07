import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// POST /api/appointment-types/[id]/workflow
// Creates a new pre-appointment workflow template for this appointment type
// and links them via type_workflow_links.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appointmentTypeId } = await params;

  try {
    const supabase = createServiceClient();

    // Verify the appointment type exists and get its org
    const { data: apptType } = await supabase
      .from("appointment_types")
      .select("id, org_id, name")
      .eq("id", appointmentTypeId)
      .single();

    if (!apptType) {
      return NextResponse.json(
        { error: "Appointment type not found" },
        { status: 404 }
      );
    }

    // Check if a pre-workflow already exists (the partial unique index
    // enforces this at DB level too, but a clear error is better)
    const { data: existingLink } = await supabase
      .from("type_workflow_links")
      .select("id")
      .eq("appointment_type_id", appointmentTypeId)
      .eq("direction", "pre_appointment")
      .maybeSingle();

    if (existingLink) {
      return NextResponse.json(
        { error: "Appointment type already has a pre-appointment workflow" },
        { status: 409 }
      );
    }

    // Create the workflow template
    const { data: template, error: templateError } = await supabase
      .from("workflow_templates")
      .insert({
        org_id: apptType.org_id,
        name: `Pre-workflow: ${apptType.name}`,
        direction: "pre_appointment",
        status: "draft",
      })
      .select("*")
      .single();

    if (templateError) {
      return NextResponse.json(
        { error: templateError.message },
        { status: 500 }
      );
    }

    // Create the junction link
    const { error: linkError } = await supabase
      .from("type_workflow_links")
      .insert({
        appointment_type_id: appointmentTypeId,
        workflow_template_id: template.id,
        direction: "pre_appointment",
      });

    if (linkError) {
      // Clean up the template if link creation fails
      await supabase.from("workflow_templates").delete().eq("id", template.id);
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }

    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    console.error("[APPOINTMENT-TYPE-WORKFLOW] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointment-types/[id]/workflow
// Detaches the pre-appointment workflow from this appointment type.
// Deletes the type_workflow_links row. Does NOT delete the workflow template
// (it may be referenced by in-flight runs or reattached later).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appointmentTypeId } = await params;

  try {
    const supabase = createServiceClient();

    const { error } = await supabase
      .from("type_workflow_links")
      .delete()
      .eq("appointment_type_id", appointmentTypeId)
      .eq("direction", "pre_appointment");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[APPOINTMENT-TYPE-WORKFLOW] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
