import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  formAssignments,
  forms as formsT,
  patients as patientsT,
  appointments as appointmentsT,
} from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import {
  requireStaffCanAccessForm,
  assertPatientInOrg,
  assertAppointmentInOrg,
} from "@/lib/auth/staff-access";
import { denyResponse, parseJsonBody } from "@/lib/api/route-helpers";

// GET /api/forms/assignments?form_id=xxx
export async function GET(request: NextRequest) {
  const formId = request.nextUrl.searchParams.get("form_id");

  if (!formId) {
    return NextResponse.json({ error: "form_id required" }, { status: 400 });
  }

  const access = await requireStaffCanAccessForm(formId);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
    const assignments = await db
      .select({
        id: formAssignments.id,
        form_id: formAssignments.formId,
        appointment_id: formAssignments.appointmentId,
        patient_id: formAssignments.patientId,
        token: formAssignments.token,
        schema_snapshot: formAssignments.schemaSnapshot,
        status: formAssignments.status,
        sent_at: formAssignments.sentAt,
        opened_at: formAssignments.openedAt,
        completed_at: formAssignments.completedAt,
        submission_id: formAssignments.submissionId,
        created_at: formAssignments.createdAt,
        updated_at: formAssignments.updatedAt,
      })
      .from(formAssignments)
      .where(eq(formAssignments.formId, formId))
      .orderBy(desc(formAssignments.createdAt));

    // Enrich with patient names and appointment times
    const patientIds = [...new Set(assignments.map((a) => a.patient_id))];
    const appointmentIds = [
      ...new Set(
        assignments
          .map((a) => a.appointment_id)
          .filter((x): x is string => !!x)
      ),
    ];

    let patientMap: Record<string, { first_name: string; last_name: string }> = {};
    let appointmentMap: Record<string, { scheduled_at: string | null }> = {};

    if (patientIds.length > 0) {
      const patients = await db
        .select({
          id: patientsT.id,
          first_name: patientsT.firstName,
          last_name: patientsT.lastName,
        })
        .from(patientsT)
        .where(inArray(patientsT.id, patientIds));

      patientMap = Object.fromEntries(patients.map((p) => [p.id, { first_name: p.first_name, last_name: p.last_name }]));
    }

    if (appointmentIds.length > 0) {
      const appointments = await db
        .select({
          id: appointmentsT.id,
          scheduled_at: appointmentsT.scheduledAt,
        })
        .from(appointmentsT)
        .where(inArray(appointmentsT.id, appointmentIds));

      appointmentMap = Object.fromEntries(appointments.map((a) => [a.id, { scheduled_at: a.scheduled_at }]));
    }

    const enriched = assignments.map((a) => ({
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
  const parsed = await parseJsonBody<{
    form_id?: string;
    patient_id?: string;
    appointment_id?: string | null;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { form_id, patient_id, appointment_id } = parsed.body;

  if (!form_id || !patient_id) {
    return NextResponse.json(
      { error: "form_id and patient_id are required" },
      { status: 400 }
    );
  }

  const access = await requireStaffCanAccessForm(form_id);
  if (!access.ok) {
    return denyResponse(access);
  }

  // The form is org-gated above, but patient_id / appointment_id are
  // caller-supplied — prove they belong to the same org before the
  // service-role insert, or this could create a cross-org assignment.
  if (!(await assertPatientInOrg(patient_id, access.orgId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    appointment_id &&
    !(await assertAppointmentInOrg(appointment_id, access.orgId))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // Fetch the form to snapshot its schema
    const [form] = await db
      .select({ schema: formsT.schema, status: formsT.status })
      .from(formsT)
      .where(eq(formsT.id, form_id));

    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (form.status !== "published") {
      return NextResponse.json(
        { error: "Form must be published before assigning" },
        { status: 400 }
      );
    }

    const [assignment] = await db
      .insert(formAssignments)
      .values({
        formId: form_id,
        patientId: patient_id,
        appointmentId: appointment_id ?? null,
        schemaSnapshot: form.schema,
        status: "pending",
      })
      .returning({
        id: formAssignments.id,
        form_id: formAssignments.formId,
        appointment_id: formAssignments.appointmentId,
        patient_id: formAssignments.patientId,
        token: formAssignments.token,
        schema_snapshot: formAssignments.schemaSnapshot,
        status: formAssignments.status,
        sent_at: formAssignments.sentAt,
        opened_at: formAssignments.openedAt,
        completed_at: formAssignments.completedAt,
        submission_id: formAssignments.submissionId,
        created_at: formAssignments.createdAt,
        updated_at: formAssignments.updatedAt,
      });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    console.error("[Forms] POST assignment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
