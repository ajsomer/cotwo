import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/readiness?location_id=xxx
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");

  if (!locationId) {
    return NextResponse.json({ error: "location_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    // Fetch outstanding form assignments for appointments at this location
    const { data: assignments, error } = await supabase
      .from("form_assignments")
      .select("id, form_id, patient_id, appointment_id, status, sent_at, created_at")
      .neq("status", "completed")
      .not("appointment_id", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ appointments: [] });
    }

    // Get the appointment IDs, then filter by location
    const appointmentIds = [...new Set(assignments.map((a) => a.appointment_id).filter(Boolean))];

    const { data: appointmentsData } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patient_id, clinician_id, location_id")
      .in("id", appointmentIds)
      .eq("location_id", locationId);

    if (!appointmentsData || appointmentsData.length === 0) {
      return NextResponse.json({ appointments: [] });
    }

    const appointmentMap = new Map(appointmentsData.map((a) => [a.id, a]));

    // Filter assignments to only those at this location
    const locationAssignments = assignments.filter(
      (a) => a.appointment_id && appointmentMap.has(a.appointment_id)
    );

    if (locationAssignments.length === 0) {
      return NextResponse.json({ appointments: [] });
    }

    // Get patient names, clinician names, phone numbers, and form names in parallel
    const patientIds = [...new Set(locationAssignments.map((a) => a.patient_id))];
    const clinicianIds = [...new Set(appointmentsData.map((a) => a.clinician_id).filter(Boolean))];
    const formIds = [...new Set(locationAssignments.map((a) => a.form_id))];

    const [patientsRes, cliniciansRes, phonesRes, formsRes] = await Promise.all([
      supabase.from("patients").select("id, first_name, last_name").in("id", patientIds),
      clinicianIds.length > 0
        ? supabase.from("users").select("id, full_name").in("id", clinicianIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("patient_phone_numbers")
        .select("patient_id, phone_number")
        .in("patient_id", patientIds)
        .eq("is_primary", true),
      supabase.from("forms").select("id, name").in("id", formIds),
    ]);

    const patientMap = new Map((patientsRes.data ?? []).map((p) => [p.id, p]));
    const clinicianMap = new Map((cliniciansRes.data ?? []).map((c) => [c.id, c.full_name]));
    const phoneMap = new Map((phonesRes.data ?? []).map((p) => [p.patient_id, p.phone_number]));
    const formMap = new Map((formsRes.data ?? []).map((f) => [f.id, f.name]));

    // Group assignments by appointment
    const grouped = new Map<string, {
      appointment_id: string;
      scheduled_at: string;
      patient_id: string;
      patient_first_name: string;
      patient_last_name: string;
      clinician_name: string | null;
      primary_phone: string | null;
      outstanding_forms: {
        assignment_id: string;
        form_name: string;
        status: string;
        sent_at: string | null;
        created_at: string;
      }[];
    }>();

    for (const fa of locationAssignments) {
      const appt = appointmentMap.get(fa.appointment_id!);
      if (!appt) continue;

      if (!grouped.has(appt.id)) {
        const patient = patientMap.get(appt.patient_id);
        grouped.set(appt.id, {
          appointment_id: appt.id,
          scheduled_at: appt.scheduled_at,
          patient_id: appt.patient_id,
          patient_first_name: patient?.first_name ?? "Unknown",
          patient_last_name: patient?.last_name ?? "",
          clinician_name: appt.clinician_id ? clinicianMap.get(appt.clinician_id) ?? null : null,
          primary_phone: phoneMap.get(appt.patient_id) ?? null,
          outstanding_forms: [],
        });
      }

      grouped.get(appt.id)!.outstanding_forms.push({
        assignment_id: fa.id,
        form_name: formMap.get(fa.form_id) ?? "Unknown form",
        status: fa.status,
        sent_at: fa.sent_at,
        created_at: fa.created_at,
      });
    }

    // Sort by scheduled_at
    const result = [...grouped.values()].sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    );

    return NextResponse.json({ appointments: result });
  } catch (err) {
    console.error("[Readiness] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
