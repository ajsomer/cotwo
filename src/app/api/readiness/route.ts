import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Terminal statuses — actions in these states are "done"
const TERMINAL_STATUSES = ["completed", "captured", "verified", "skipped", "failed"];

// GET /api/readiness?location_id=xxx
// Returns appointments with outstanding workflow actions for the readiness dashboard.
// Generalised from the original forms-only query to show all workflow action states.
// Falls back to form_assignments if no workflow runs exist for an appointment.
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");

  if (!locationId) {
    return NextResponse.json({ error: "location_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    // Fetch active workflow runs for appointments at this location
    const { data: runs } = await supabase
      .from("appointment_workflow_runs")
      .select("id, appointment_id, workflow_template_id, direction, status")
      .eq("status", "active")
      .eq("direction", "pre_appointment");

    const runsByAppointment = new Map<string, string[]>();
    for (const run of runs ?? []) {
      const list = runsByAppointment.get(run.appointment_id) ?? [];
      list.push(run.id);
      runsByAppointment.set(run.appointment_id, list);
    }

    if (runsByAppointment.size === 0) {
      // Fall back to legacy form_assignments query
      return await legacyFormAssignmentsQuery(supabase, locationId);
    }

    // Filter to appointments at this location
    const appointmentIds = [...runsByAppointment.keys()];
    const { data: appointmentsData } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patient_id, clinician_id, location_id")
      .in("id", appointmentIds)
      .eq("location_id", locationId);

    if (!appointmentsData || appointmentsData.length === 0) {
      return await legacyFormAssignmentsQuery(supabase, locationId);
    }

    const locationApptIds = appointmentsData.map((a) => a.id);
    const appointmentMap = new Map(appointmentsData.map((a) => [a.id, a]));

    // Fetch all actions for these runs
    const runIds = locationApptIds.flatMap((id) => runsByAppointment.get(id) ?? []);
    const { data: actions } = await supabase
      .from("appointment_actions")
      .select("id, appointment_id, action_block_id, workflow_run_id, status, scheduled_for, fired_at, error_message")
      .in("workflow_run_id", runIds);

    // Fetch action block details
    const blockIds = [...new Set((actions ?? []).map((a) => a.action_block_id))];
    const { data: blocks } = await supabase
      .from("workflow_action_blocks")
      .select("id, action_type, config, form_id, offset_minutes, offset_direction")
      .in("id", blockIds);

    const blockMap = new Map((blocks ?? []).map((b) => [b.id, b]));

    // Fetch enrichment data in parallel
    const patientIds = [...new Set(appointmentsData.map((a) => a.patient_id).filter(Boolean))];
    const clinicianIds = [...new Set(appointmentsData.map((a) => a.clinician_id).filter(Boolean))];
    const formIds = [...new Set((blocks ?? []).map((b) => b.form_id).filter(Boolean))];

    const [patientsRes, cliniciansRes, phonesRes, formsRes] = await Promise.all([
      patientIds.length > 0
        ? supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
        : Promise.resolve({ data: [] }),
      clinicianIds.length > 0
        ? supabase.from("users").select("id, full_name").in("id", clinicianIds)
        : Promise.resolve({ data: [] }),
      patientIds.length > 0
        ? supabase.from("patient_phone_numbers").select("patient_id, phone_number").in("patient_id", patientIds).eq("is_primary", true)
        : Promise.resolve({ data: [] }),
      formIds.length > 0
        ? supabase.from("forms").select("id, name").in("id", formIds)
        : Promise.resolve({ data: [] }),
    ]);

    const patientMap = new Map((patientsRes.data ?? []).map((p) => [p.id, p]));
    const clinicianMap = new Map((cliniciansRes.data ?? []).map((c) => [c.id, c.full_name]));
    const phoneMap = new Map((phonesRes.data ?? []).map((p) => [p.patient_id, p.phone_number]));
    const formMap = new Map((formsRes.data ?? []).map((f) => [f.id, f.name]));

    // Group actions by appointment
    const grouped = new Map<string, {
      appointment_id: string;
      scheduled_at: string;
      patient_id: string;
      patient_first_name: string;
      patient_last_name: string;
      clinician_name: string | null;
      primary_phone: string | null;
      total_actions: number;
      completed_actions: number;
      outstanding_actions: number;
      actions: {
        action_id: string;
        action_type: string;
        action_label: string;
        status: string;
        scheduled_for: string;
        fired_at: string | null;
        error_message: string | null;
        form_name: string | null;
        offset_minutes: number;
        offset_direction: string;
      }[];
      // Legacy compat: outstanding_forms for the UI during transition
      outstanding_forms: {
        assignment_id: string;
        form_name: string;
        status: string;
        sent_at: string | null;
        created_at: string;
      }[];
    }>();

    for (const action of actions ?? []) {
      const appt = appointmentMap.get(action.appointment_id);
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
          total_actions: 0,
          completed_actions: 0,
          outstanding_actions: 0,
          actions: [],
          outstanding_forms: [],
        });
      }

      const group = grouped.get(appt.id)!;
      const block = blockMap.get(action.action_block_id);
      const isTerminal = TERMINAL_STATUSES.includes(action.status);

      group.total_actions++;
      if (isTerminal) {
        group.completed_actions++;
      } else {
        group.outstanding_actions++;
      }

      group.actions.push({
        action_id: action.id,
        action_type: block?.action_type ?? "unknown",
        action_label: getActionLabel(block?.action_type ?? "unknown", formMap.get(block?.form_id ?? "")),
        status: action.status,
        scheduled_for: action.scheduled_for,
        fired_at: action.fired_at,
        error_message: action.error_message,
        form_name: block?.form_id ? formMap.get(block.form_id) ?? null : null,
        offset_minutes: block?.offset_minutes ?? 0,
        offset_direction: block?.offset_direction ?? "before",
      });
    }

    // Filter out appointments where all actions are terminal (fully complete)
    const result = [...grouped.values()]
      .filter((g) => g.outstanding_actions > 0)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

    return NextResponse.json({ appointments: result });
  } catch (err) {
    console.error("[Readiness] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Legacy fallback: query form_assignments directly (for orgs without workflows) */
async function legacyFormAssignmentsQuery(
  supabase: ReturnType<typeof createServiceClient>,
  locationId: string
) {
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
  const locationAssignments = assignments.filter(
    (a) => a.appointment_id && appointmentMap.has(a.appointment_id)
  );

  if (locationAssignments.length === 0) {
    return NextResponse.json({ appointments: [] });
  }

  const patientIds = [...new Set(locationAssignments.map((a) => a.patient_id))];
  const clinicianIds = [...new Set(appointmentsData.map((a) => a.clinician_id).filter(Boolean))];
  const formIds = [...new Set(locationAssignments.map((a) => a.form_id))];

  const [patientsRes, cliniciansRes, phonesRes, formsRes] = await Promise.all([
    supabase.from("patients").select("id, first_name, last_name").in("id", patientIds),
    clinicianIds.length > 0
      ? supabase.from("users").select("id, full_name").in("id", clinicianIds)
      : Promise.resolve({ data: [] }),
    supabase.from("patient_phone_numbers").select("patient_id, phone_number").in("patient_id", patientIds).eq("is_primary", true),
    supabase.from("forms").select("id, name").in("id", formIds),
  ]);

  const patientMap = new Map((patientsRes.data ?? []).map((p) => [p.id, p]));
  const clinicianMap = new Map((cliniciansRes.data ?? []).map((c) => [c.id, c.full_name]));
  const phoneMap = new Map((phonesRes.data ?? []).map((p) => [p.patient_id, p.phone_number]));
  const formMap = new Map((formsRes.data ?? []).map((f) => [f.id, f.name]));

  const grouped = new Map<string, {
    appointment_id: string;
    scheduled_at: string;
    patient_id: string;
    patient_first_name: string;
    patient_last_name: string;
    clinician_name: string | null;
    primary_phone: string | null;
    total_actions: number;
    completed_actions: number;
    outstanding_actions: number;
    actions: never[];
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
        total_actions: 0,
        completed_actions: 0,
        outstanding_actions: 0,
        actions: [],
        outstanding_forms: [],
      });
    }

    const group = grouped.get(appt.id)!;
    group.total_actions++;
    group.outstanding_actions++;
    group.outstanding_forms.push({
      assignment_id: fa.id,
      form_name: formMap.get(fa.form_id) ?? "Unknown form",
      status: fa.status,
      sent_at: fa.sent_at,
      created_at: fa.created_at,
    });
  }

  const result = [...grouped.values()].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  );

  return NextResponse.json({ appointments: result });
}

function getActionLabel(actionType: string, formName?: string): string {
  switch (actionType) {
    case "deliver_form":
      return formName ? `Send form: ${formName}` : "Send form";
    case "send_reminder":
      return "Send reminder SMS";
    case "send_sms":
      return "Send SMS";
    case "capture_card":
      return "Capture card on file";
    case "verify_contact":
      return "Verify contact details";
    case "send_file":
      return "Send file";
    case "send_rebooking_nudge":
      return "Send rebooking nudge";
    default:
      return actionType;
  }
}
