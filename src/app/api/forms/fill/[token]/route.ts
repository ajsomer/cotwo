import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  formAssignments,
  forms as formsT,
  patients as patientsT,
  organisations,
  formSubmissions,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/forms/fill/[token] — resolve assignment for patient form fill
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const [assignment] = await db
      .select({
        id: formAssignments.id,
        form_id: formAssignments.formId,
        patient_id: formAssignments.patientId,
        schema_snapshot: formAssignments.schemaSnapshot,
        status: formAssignments.status,
        completed_at: formAssignments.completedAt,
      })
      .from(formAssignments)
      .where(eq(formAssignments.token, token));

    if (!assignment) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (assignment.status === "completed") {
      return NextResponse.json(
        { error: "This form has already been submitted", completed: true },
        { status: 410 }
      );
    }

    // Get form name
    const [form] = await db
      .select({ name: formsT.name, org_id: formsT.orgId })
      .from(formsT)
      .where(eq(formsT.id, assignment.form_id));

    // Get patient name
    const [patient] = await db
      .select({ first_name: patientsT.firstName })
      .from(patientsT)
      .where(eq(patientsT.id, assignment.patient_id));

    // Get org branding
    let org: { name: string; logo_url: string | null } | null = null;
    if (form?.org_id) {
      const [orgData] = await db
        .select({ name: organisations.name, logo_url: organisations.logoUrl })
        .from(organisations)
        .where(eq(organisations.id, form.org_id));
      org = orgData ?? null;
    }

    // Transition status: pending/sent → opened
    if (assignment.status === "pending" || assignment.status === "sent") {
      await db
        .update(formAssignments)
        .set({ status: "opened", openedAt: new Date().toISOString() })
        .where(eq(formAssignments.id, assignment.id));
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
    const [assignment] = await db
      .select({
        id: formAssignments.id,
        form_id: formAssignments.formId,
        patient_id: formAssignments.patientId,
        appointment_id: formAssignments.appointmentId,
        status: formAssignments.status,
      })
      .from(formAssignments)
      .where(eq(formAssignments.token, token));

    if (!assignment) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (assignment.status === "completed") {
      return NextResponse.json(
        { error: "This form has already been submitted" },
        { status: 410 }
      );
    }

    // Create submission
    let submission;
    try {
      [submission] = await db
        .insert(formSubmissions)
        .values({
          formId: assignment.form_id,
          patientId: assignment.patient_id,
          appointmentId: assignment.appointment_id,
          responses,
        })
        .returning({ id: formSubmissions.id });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Internal server error" },
        { status: 500 }
      );
    }

    // Update assignment to completed
    await db
      .update(formAssignments)
      .set({
        status: "completed",
        completedAt: new Date().toISOString(),
        submissionId: submission.id,
      })
      .where(eq(formAssignments.id, assignment.id));

    return NextResponse.json({ success: true, submission_id: submission.id });
  } catch (err) {
    console.error("[Forms] POST fill/[token] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
