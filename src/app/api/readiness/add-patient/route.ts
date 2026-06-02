import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scheduleWorkflowForAppointment } from "@/lib/workflows/scanner";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { normalisePhone } from "@/lib/phone/normalise";

/**
 * POST /api/readiness/add-patient
 *
 * Creates a patient (or matches existing) and an appointment, then kicks off
 * the workflow engine. Used by the Readiness Dashboard's "+ Add patient" flow.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      first_name,
      last_name,
      dob,
      mobile,
      appointment_type_id,
      room_id,
      scheduled_at,
      org_id,
      location_id,
      confirm_existing,
    } = body;

    if (
      !first_name ||
      !last_name ||
      !dob ||
      !mobile ||
      !appointment_type_id ||
      !org_id ||
      !location_id ||
      !room_id ||
      !scheduled_at
    ) {
      return NextResponse.json(
        {
          error:
            "Required fields: first_name, last_name, dob, mobile, appointment_type_id, org_id, location_id, room_id, scheduled_at",
        },
        { status: 400 }
      );
    }

    // Normalise phone to E.164 (basic Australian mobile normalisation)
    const normalised = normalisePhone(mobile);
    if (!normalised) {
      return NextResponse.json({ error: "Invalid mobile number" }, { status: 400 });
    }

    const access = await requireStaffLocationAccess(location_id);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: access.status },
      );
    }

    const supabase = createServiceClient();

    // Check for existing patient by phone + DOB + org
    const { data: existingPatients } = await supabase
      .from("patient_phone_numbers")
      .select("patient_id, patients!inner(id, first_name, last_name, date_of_birth, org_id)")
      .eq("phone_number", normalised);

    const matchingPatient = (existingPatients ?? []).find((row) => {
      const patient = row.patients as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        date_of_birth: string;
        org_id: string;
      };
      return patient.org_id === org_id && patient.date_of_birth === dob;
    });

    if (matchingPatient && !confirm_existing) {
      const patient = matchingPatient.patients as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        date_of_birth: string;
      };
      return NextResponse.json({
        existing_patient: true,
        patient: {
          id: patient.id,
          first_name: patient.first_name,
          last_name: patient.last_name,
          date_of_birth: patient.date_of_birth,
        },
      });
    }

    let patientId: string;

    if (matchingPatient) {
      // Use existing patient
      patientId = matchingPatient.patient_id;
    } else {
      // Create new patient
      const { data: newPatient, error: patientError } = await supabase
        .from("patients")
        .insert({
          org_id,
          first_name,
          last_name,
          date_of_birth: dob,
        })
        .select("id")
        .single();

      if (patientError || !newPatient) {
        return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
      }

      patientId = newPatient.id;

      // Create phone number record
      const { error: phoneError } = await supabase
        .from("patient_phone_numbers")
        .insert({
          patient_id: patientId,
          phone_number: normalised,
          is_primary: true,
        });

      if (phoneError) {
        console.error("[add-patient] Failed to create phone:", phoneError);
      }
    }

    // Create appointment
    const { data: appointment, error: apptError } = await supabase
      .from("appointments")
      .insert({
        org_id,
        location_id,
        patient_id: patientId,
        appointment_type_id,
        room_id,
        scheduled_at,
        clinician_id: null,
        phone_number: normalised,
        status: "scheduled",
      })
      .select("id")
      .single();

    if (apptError || !appointment) {
      console.error("[add-patient] Failed to create appointment:", apptError);
      return NextResponse.json({ error: "Failed to create appointment" }, { status: 500 });
    }

    // Schedule workflow for the appointment
    try {
      await scheduleWorkflowForAppointment(
        appointment.id,
        appointment_type_id,
        scheduled_at
      );
    } catch (wfError) {
      // Workflow scheduling failure is non-fatal — the appointment exists,
      // the receptionist can still see it. Log and continue.
      console.error("[add-patient] Workflow scheduling failed:", wfError);
    }

    // Pull back any actions that fired synchronously during scheduling so
    // the client can surface the stubbed SMS in the browser console. Easier
    // than tailing the server terminal during demos.
    const fired = await collectFiredActions(supabase, appointment.id);

    return NextResponse.json({
      appointment_id: appointment.id,
      patient_id: patientId,
      fired_actions: fired,
    });
  } catch (err) {
    console.error("[add-patient] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface FiredAction {
  action_type: string;
  status: string;
  result: Record<string, unknown> | null;
  fired_at: string | null;
}

async function collectFiredActions(
  supabase: ReturnType<typeof createServiceClient>,
  appointmentId: string
): Promise<FiredAction[]> {
  const { data: actions } = await supabase
    .from("appointment_actions")
    .select("id, action_block_id, status, result, fired_at")
    .eq("appointment_id", appointmentId)
    .not("fired_at", "is", null);

  if (!actions || actions.length === 0) return [];

  const blockIds = actions.map((a) => a.action_block_id);
  const { data: blocks } = await supabase
    .from("workflow_action_blocks")
    .select("id, action_type")
    .in("id", blockIds);
  const typeById = new Map((blocks ?? []).map((b) => [b.id, b.action_type]));

  return actions.map((a) => ({
    action_type: typeById.get(a.action_block_id) ?? "unknown",
    status: a.status,
    result: a.result as Record<string, unknown> | null,
    fired_at: a.fired_at,
  }));
}
