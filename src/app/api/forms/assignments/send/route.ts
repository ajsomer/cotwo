import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  formAssignments,
  forms as formsT,
  patients as patientsT,
  patientPhoneNumbers,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSmsProvider } from "@/lib/sms";
import { getBaseUrl } from "@/lib/utils/url";
import { requireStaffCanAccessFormAssignment } from "@/lib/auth/staff-access";

// POST /api/forms/assignments/send
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { assignment_id } = body;

  if (!assignment_id) {
    return NextResponse.json(
      { error: "assignment_id is required" },
      { status: 400 }
    );
  }

  const access = await requireStaffCanAccessFormAssignment(
    assignment_id
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    // Fetch assignment with form name and patient details
    const [assignment] = await db
      .select({
        id: formAssignments.id,
        token: formAssignments.token,
        status: formAssignments.status,
        patient_id: formAssignments.patientId,
        form_id: formAssignments.formId,
      })
      .from(formAssignments)
      .where(eq(formAssignments.id, assignment_id));

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    if (assignment.status === "completed") {
      return NextResponse.json(
        { error: "Assignment already completed" },
        { status: 400 }
      );
    }

    // Get form name
    const [form] = await db
      .select({ name: formsT.name })
      .from(formsT)
      .where(eq(formsT.id, assignment.form_id));

    // Get patient name and primary phone
    const [patient] = await db
      .select({
        first_name: patientsT.firstName,
        last_name: patientsT.lastName,
      })
      .from(patientsT)
      .where(eq(patientsT.id, assignment.patient_id));

    const [phoneRecord] = await db
      .select({ phone_number: patientPhoneNumbers.phoneNumber })
      .from(patientPhoneNumbers)
      .where(
        and(
          eq(patientPhoneNumbers.patientId, assignment.patient_id),
          eq(patientPhoneNumbers.isPrimary, true)
        )
      );

    if (!phoneRecord) {
      return NextResponse.json(
        { error: "No phone number on file for this patient" },
        { status: 400 }
      );
    }

    const formName = form?.name ?? "form";
    const patientName = patient?.first_name ?? "there";
    const url = `${getBaseUrl()}/form/${assignment.token}`;
    const message = `Hi ${patientName}, please complete your ${formName} form before your appointment: ${url}`;

    const sms = getSmsProvider();
    const result = await sms.sendNotification(phoneRecord.phone_number, message);

    if (!result.success) {
      console.error("[Forms] SMS send failed:", result.error);
      return NextResponse.json(
        { error: "Failed to send SMS" },
        { status: 500 }
      );
    }

    // Update assignment status (forward-only: don't downgrade from opened)
    const updates: Partial<typeof formAssignments.$inferInsert> = {
      sentAt: new Date().toISOString(),
    };
    if (assignment.status === "pending") {
      updates.status = "sent";
    }

    await db
      .update(formAssignments)
      .set(updates)
      .where(eq(formAssignments.id, assignment_id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Forms] Send SMS error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
