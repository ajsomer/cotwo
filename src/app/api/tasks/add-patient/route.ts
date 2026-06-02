import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  patientPhoneNumbers,
  patients as patientsT,
  appointments as appointmentsT,
  appointmentActions,
  workflowActionBlocks,
} from "@/lib/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { scheduleWorkflowForAppointment } from "@/lib/workflows/scanner";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { normalisePhone } from "@/lib/phone/normalise";

/**
 * POST /api/tasks/add-patient
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

    // Check for existing patient by phone + DOB + org
    const existingPatients = await db
      .select({
        patient_id: patientPhoneNumbers.patientId,
        id: patientsT.id,
        first_name: patientsT.firstName,
        last_name: patientsT.lastName,
        date_of_birth: patientsT.dateOfBirth,
        org_id: patientsT.orgId,
      })
      .from(patientPhoneNumbers)
      .innerJoin(patientsT, eq(patientsT.id, patientPhoneNumbers.patientId))
      .where(eq(patientPhoneNumbers.phoneNumber, normalised));

    const matchingPatient = existingPatients.find(
      (row) => row.org_id === org_id && row.date_of_birth === dob,
    );

    if (matchingPatient && !confirm_existing) {
      return NextResponse.json({
        existing_patient: true,
        patient: {
          id: matchingPatient.id,
          first_name: matchingPatient.first_name,
          last_name: matchingPatient.last_name,
          date_of_birth: matchingPatient.date_of_birth,
        },
      });
    }

    let patientId: string;

    if (matchingPatient) {
      // Use existing patient
      patientId = matchingPatient.patient_id;
    } else {
      // Create new patient
      let newPatient: { id: string } | undefined;
      try {
        [newPatient] = await db
          .insert(patientsT)
          .values({
            orgId: org_id,
            firstName: first_name,
            lastName: last_name,
            dateOfBirth: dob,
          })
          .returning({ id: patientsT.id });
      } catch (patientError) {
        console.error("[add-patient] Failed to create patient:", patientError);
      }

      if (!newPatient) {
        return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
      }

      patientId = newPatient.id;

      // Create phone number record
      try {
        await db.insert(patientPhoneNumbers).values({
          patientId,
          phoneNumber: normalised,
          isPrimary: true,
        });
      } catch (phoneError) {
        console.error("[add-patient] Failed to create phone:", phoneError);
      }
    }

    // Create appointment
    let appointment: { id: string } | undefined;
    try {
      [appointment] = await db
        .insert(appointmentsT)
        .values({
          orgId: org_id,
          locationId: location_id,
          patientId,
          appointmentTypeId: appointment_type_id,
          roomId: room_id,
          scheduledAt: scheduled_at,
          clinicianId: null,
          phoneNumber: normalised,
          status: "scheduled",
        })
        .returning({ id: appointmentsT.id });
    } catch (apptError) {
      console.error("[add-patient] Failed to create appointment:", apptError);
    }

    if (!appointment) {
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
    const fired = await collectFiredActions(appointment.id);

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
  appointmentId: string
): Promise<FiredAction[]> {
  const actions = await db
    .select({
      id: appointmentActions.id,
      action_block_id: appointmentActions.actionBlockId,
      status: appointmentActions.status,
      result: appointmentActions.result,
      fired_at: appointmentActions.firedAt,
    })
    .from(appointmentActions)
    .where(
      and(
        eq(appointmentActions.appointmentId, appointmentId),
        isNotNull(appointmentActions.firedAt)
      )
    );

  if (actions.length === 0) return [];

  const blockIds = [...new Set(actions.map((a) => a.action_block_id))];
  const blocks = blockIds.length === 0 ? [] : await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
    })
    .from(workflowActionBlocks)
    .where(inArray(workflowActionBlocks.id, blockIds));
  const typeById = new Map(blocks.map((b) => [b.id, b.action_type]));

  return actions.map((a) => ({
    action_type: typeById.get(a.action_block_id) ?? "unknown",
    status: a.status,
    result: a.result as Record<string, unknown> | null,
    fired_at: a.fired_at,
  }));
}
