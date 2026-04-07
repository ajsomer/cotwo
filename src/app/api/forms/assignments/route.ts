import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/forms/assignments?form_id=xxx
export async function GET(request: NextRequest) {
  const formId = request.nextUrl.searchParams.get("form_id");

  if (!formId) {
    return NextResponse.json({ error: "form_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data: assignments, error } = await supabase
      .from("form_assignments")
      .select("*")
      .eq("form_id", formId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich with patient names and appointment times
    const patientIds = [...new Set((assignments ?? []).map((a) => a.patient_id))];
    const appointmentIds = [...new Set((assignments ?? []).map((a) => a.appointment_id).filter(Boolean))];

    let patientMap: Record<string, { first_name: string; last_name: string }> = {};
    let appointmentMap: Record<string, { scheduled_at: string }> = {};

    if (patientIds.length > 0) {
      const { data: patients } = await supabase
        .from("patients")
        .select("id, first_name, last_name")
        .in("id", patientIds);

      if (patients) {
        patientMap = Object.fromEntries(patients.map((p) => [p.id, { first_name: p.first_name, last_name: p.last_name }]));
      }
    }

    if (appointmentIds.length > 0) {
      const { data: appointments } = await supabase
        .from("appointments")
        .select("id, scheduled_at")
        .in("id", appointmentIds);

      if (appointments) {
        appointmentMap = Object.fromEntries(appointments.map((a) => [a.id, { scheduled_at: a.scheduled_at }]));
      }
    }

    const enriched = (assignments ?? []).map((a) => ({
      ...a,
      patient_first_name: patientMap[a.patient_id]?.first_name ?? null,
      patient_last_name: patientMap[a.patient_id]?.last_name ?? null,
      scheduled_at: a.appointment_id ? appointmentMap[a.appointment_id]?.scheduled_at ?? null : null,
    }));

    return NextResponse.json({ assignments: enriched });
  } catch (err) {
    console.error("[Forms] GET assignments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/forms/assignments
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { form_id, patient_id, appointment_id } = body;

  if (!form_id || !patient_id) {
    return NextResponse.json(
      { error: "form_id and patient_id are required" },
      { status: 400 }
    );
  }

  try {
    const supabase = createServiceClient();

    // Fetch the form to snapshot its schema
    const { data: form, error: formError } = await supabase
      .from("forms")
      .select("schema, status")
      .eq("id", form_id)
      .single();

    if (formError || !form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (form.status !== "published") {
      return NextResponse.json(
        { error: "Form must be published before assigning" },
        { status: 400 }
      );
    }

    const { data: assignment, error } = await supabase
      .from("form_assignments")
      .insert({
        form_id,
        patient_id,
        appointment_id: appointment_id ?? null,
        schema_snapshot: form.schema,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    console.error("[Forms] POST assignment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
