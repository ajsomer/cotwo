import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getReadinessPriority,
  sortByPriority,
  type ReadinessPriority,
} from "@/lib/readiness/derived-state";

// Terminal statuses — actions in these states are "done"
const TERMINAL_STATUSES = ["completed", "captured", "verified", "skipped", "failed", "transcribed"];

// Recently completed retention window: 7 days
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// GET /api/readiness?location_id=xxx&direction=pre_appointment|post_appointment
// Returns appointments with workflow actions for the readiness dashboard,
// enriched with priority derivation, room/type names, and mode counts.
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");
  const direction = request.nextUrl.searchParams.get("direction") ?? "pre_appointment";

  if (!locationId) {
    return NextResponse.json({ error: "location_id required" }, { status: 400 });
  }

  if (direction !== "pre_appointment" && direction !== "post_appointment") {
    return NextResponse.json({ error: "direction must be pre_appointment or post_appointment" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();

    // Fetch active workflow runs for the requested direction
    const { data: runs } = await supabase
      .from("appointment_workflow_runs")
      .select("id, appointment_id, workflow_template_id, direction, status")
      .eq("status", "active")
      .eq("direction", direction);

    const runsByAppointment = new Map<string, string[]>();
    const templateIdsByAppointment = new Map<string, string>();
    for (const run of runs ?? []) {
      const list = runsByAppointment.get(run.appointment_id) ?? [];
      list.push(run.id);
      runsByAppointment.set(run.appointment_id, list);
      templateIdsByAppointment.set(run.appointment_id, run.workflow_template_id);
    }

    // Count for the opposite direction (for toggle badges)
    const oppositeDirection = direction === "pre_appointment" ? "post_appointment" : "pre_appointment";
    const { count: oppositeCount } = await supabase
      .from("appointment_workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("direction", oppositeDirection);

    const counts = {
      pre: direction === "pre_appointment" ? runsByAppointment.size : (oppositeCount ?? 0),
      post: direction === "post_appointment" ? runsByAppointment.size : (oppositeCount ?? 0),
    };

    if (runsByAppointment.size === 0) {
      return NextResponse.json({ appointments: [], counts });
    }

    // Filter to appointments at this location
    const appointmentIds = [...runsByAppointment.keys()];
    const { data: appointmentsData } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patient_id, clinician_id, location_id, phone_number, room_id, appointment_type_id")
      .in("id", appointmentIds)
      .eq("location_id", locationId);

    if (!appointmentsData || appointmentsData.length === 0) {
      return NextResponse.json({ appointments: [], counts });
    }

    const locationApptIds = appointmentsData.map((a) => a.id);
    const appointmentMap = new Map(appointmentsData.map((a) => [a.id, a]));

    // Fetch all actions for these runs
    const runIds = locationApptIds.flatMap((id) => runsByAppointment.get(id) ?? []);
    const { data: actions } = await supabase
      .from("appointment_actions")
      .select("id, appointment_id, action_block_id, workflow_run_id, status, scheduled_for, fired_at, error_message, updated_at")
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
    const roomIds = [...new Set(appointmentsData.map((a) => a.room_id).filter(Boolean))];
    const typeIds = [...new Set(appointmentsData.map((a) => a.appointment_type_id).filter(Boolean))];
    const templateIds = [...new Set([...templateIdsByAppointment.values()])];

    const [patientsRes, cliniciansRes, phonesRes, formsRes, roomsRes, typesRes, templatesRes, journeysRes] = await Promise.all([
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
      roomIds.length > 0
        ? supabase.from("rooms").select("id, name").in("id", roomIds)
        : Promise.resolve({ data: [] }),
      typeIds.length > 0
        ? supabase.from("appointment_types").select("id, name").in("id", typeIds)
        : Promise.resolve({ data: [] }),
      // Workflow template thresholds for priority derivation
      templateIds.length > 0
        ? supabase.from("workflow_templates").select("id, terminal_type, at_risk_after_days, overdue_after_days").in("id", templateIds)
        : Promise.resolve({ data: [] }),
      // Intake package journeys for package status column
      locationApptIds.length > 0
        ? supabase.from("intake_package_journeys").select("appointment_id, status, form_ids, forms_completed, includes_card_capture, card_captured_at, includes_consent, consent_completed_at, created_at, completed_at").in("appointment_id", locationApptIds)
        : Promise.resolve({ data: [] }),
    ]);

    const patientMap = new Map((patientsRes.data ?? []).map((p) => [p.id, p]));
    const clinicianMap = new Map((cliniciansRes.data ?? []).map((c) => [c.id, c.full_name]));
    const phoneMap = new Map((phonesRes.data ?? []).map((p) => [p.patient_id, p.phone_number]));
    const formMap = new Map((formsRes.data ?? []).map((f) => [f.id, f.name]));
    const roomMap = new Map((roomsRes.data ?? []).map((r) => [r.id, r.name]));
    const typeMap = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]));
    const templateMap = new Map((templatesRes.data ?? []).map((t) => [t.id, t]));
    const journeyMap = new Map((journeysRes.data ?? []).map((j) => [j.appointment_id, j]));

    // Group actions by appointment
    type GroupedAppointment = {
      appointment_id: string;
      scheduled_at: string | null;
      patient_id: string;
      patient_first_name: string;
      patient_last_name: string;
      clinician_name: string | null;
      primary_phone: string | null;
      room_name: string | null;
      appointment_type_name: string | null;
      terminal_type: string | null;
      total_actions: number;
      completed_actions: number;
      outstanding_actions: number;
      priority: ReadinessPriority;
      // Intake package progress
      package_status: string | null; // 'in_progress' | 'completed' | null (no journey yet)
      package_total_items: number;
      package_completed_items: number;
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
        updated_at: string | null;
      }[];
      outstanding_forms: {
        assignment_id: string;
        form_name: string;
        status: string;
        sent_at: string | null;
        created_at: string;
      }[];
    };

    const grouped = new Map<string, GroupedAppointment>();

    for (const action of actions ?? []) {
      const appt = appointmentMap.get(action.appointment_id);
      if (!appt) continue;

      if (!grouped.has(appt.id)) {
        const patient = appt.patient_id ? patientMap.get(appt.patient_id) : null;
        const firstName = patient?.first_name ?? (appt.phone_number ? appt.phone_number : "Unknown");
        const lastName = patient?.last_name ?? "";
        const phone = appt.patient_id
          ? phoneMap.get(appt.patient_id) ?? appt.phone_number ?? null
          : appt.phone_number ?? null;

        const templateId = templateIdsByAppointment.get(appt.id);
        const template = templateId ? templateMap.get(templateId) : null;
        const journey = journeyMap.get(appt.id);
        const { totalItems, completedItems } = computePackageProgress(journey);

        grouped.set(appt.id, {
          appointment_id: appt.id,
          scheduled_at: appt.scheduled_at,
          patient_id: appt.patient_id ?? "",
          patient_first_name: firstName,
          patient_last_name: lastName,
          clinician_name: appt.clinician_id ? clinicianMap.get(appt.clinician_id) ?? null : null,
          primary_phone: phone,
          room_name: appt.room_id ? roomMap.get(appt.room_id) ?? null : null,
          appointment_type_name: appt.appointment_type_id ? typeMap.get(appt.appointment_type_id) ?? null : null,
          terminal_type: template?.terminal_type ?? null,
          total_actions: 0,
          completed_actions: 0,
          outstanding_actions: 0,
          priority: "in_progress", // computed below
          package_status: journey?.status ?? null,
          package_total_items: totalItems,
          package_completed_items: completedItems,
          actions: [],
          outstanding_forms: [],
        });
      }

      const group = grouped.get(appt.id)!;
      const block = blockMap.get(action.action_block_id);
      const isTerminalStatus = TERMINAL_STATUSES.includes(action.status);

      group.total_actions++;
      if (isTerminalStatus) {
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
        updated_at: action.updated_at ?? null,
      });
    }

    // Compute priority for each appointment and filter
    const result: GroupedAppointment[] = [];
    for (const appt of grouped.values()) {
      appt.priority = getReadinessPriority(appt as Parameters<typeof getReadinessPriority>[0], now);

      if (appt.priority === "recently_completed") {
        // Only include if the most recent action's updated_at is within 7 days
        const mostRecentUpdate = getMostRecentActionUpdate(appt.actions);
        if (mostRecentUpdate && now.getTime() - mostRecentUpdate > RETENTION_MS) {
          continue; // beyond retention window
        }
      }

      result.push(appt);
    }

    // Sort by priority hierarchy
    const sorted = sortByPriority(result as Parameters<typeof sortByPriority>[0], now);

    return NextResponse.json({ appointments: sorted, counts });
  } catch (err) {
    console.error("[Readiness] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Get the most recent updated_at timestamp across actions. */
function getMostRecentActionUpdate(
  actions: { updated_at?: string | null; fired_at?: string | null; scheduled_for?: string }[]
): number | null {
  let latest = 0;
  for (const action of actions) {
    const ts = action.updated_at ?? action.fired_at ?? action.scheduled_for;
    if (ts) {
      const t = new Date(ts).getTime();
      if (t > latest) latest = t;
    }
  }
  return latest || null;
}

/** Compute intake package progress from a journey row. */
function computePackageProgress(
  journey: {
    includes_card_capture: boolean;
    includes_consent: boolean;
    form_ids: string[];
    card_captured_at: string | null;
    consent_completed_at: string | null;
    forms_completed: Record<string, string> | null;
  } | undefined
): { totalItems: number; completedItems: number } {
  if (!journey) return { totalItems: 0, completedItems: 0 };

  // Contact creation is always item 1
  let total = 1;
  let completed = 1; // contact creation is done once the journey exists (OTP verified or in progress)

  if (journey.includes_card_capture) {
    total++;
    if (journey.card_captured_at) completed++;
  }
  if (journey.includes_consent) {
    total++;
    if (journey.consent_completed_at) completed++;
  }

  const formCount = journey.form_ids?.length ?? 0;
  total += formCount;

  const formsCompleted = journey.forms_completed ?? {};
  completed += Object.keys(formsCompleted).length;

  return { totalItems: total, completedItems: completed };
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
    case "intake_package":
      return "Intake package";
    case "intake_reminder":
      return "Intake reminder";
    case "add_to_runsheet":
      return "Add to run sheet";
    default:
      return actionType;
  }
}
