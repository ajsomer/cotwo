import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formSubmissions, forms as formsT } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { extractFieldsFromSchema } from "@/lib/forms/extract-fields";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";

/**
 * GET /api/tasks/form-submission?appointment_id=xxx&form_name=yyy
 *
 * Fetches a form submission for the given appointment, returns the responses
 * mapped to field labels from the form schema.
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointment_id");
  const formName = request.nextUrl.searchParams.get("form_name");
  const submissionId = request.nextUrl.searchParams.get("submission_id");

  if (!appointmentId) {
    return NextResponse.json({ error: "appointment_id required" }, { status: 400 });
  }

  const access = await requireStaffCanAccessAppointment(appointmentId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status },
    );
  }

  try {
    if (submissionId) {
      const [exactSubmission] = await db
        .select({
          id: formSubmissions.id,
          form_id: formSubmissions.formId,
          responses: formSubmissions.responses,
          created_at: formSubmissions.createdAt,
          form_schema: formsT.schema,
        })
        .from(formSubmissions)
        .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
        .where(
          and(
            eq(formSubmissions.id, submissionId),
            eq(formSubmissions.appointmentId, appointmentId)
          )
        )
        .limit(1);

      if (exactSubmission && exactSubmission.form_schema) {
        const fields = extractFieldsFromSchema(
          exactSubmission.form_schema as Record<string, unknown>,
          exactSubmission.responses as Record<string, unknown>,
        );
        return NextResponse.json({
          submission_id: exactSubmission.id,
          fields,
          submitted_at: exactSubmission.created_at,
        });
      }
    }

    // Find form submissions for this appointment
    const submissions = await db
      .select({
        id: formSubmissions.id,
        form_id: formSubmissions.formId,
        responses: formSubmissions.responses,
        created_at: formSubmissions.createdAt,
      })
      .from(formSubmissions)
      .where(eq(formSubmissions.appointmentId, appointmentId))
      .orderBy(desc(formSubmissions.createdAt));

    if (submissions.length === 0) {
      return NextResponse.json({ fields: [], submitted_at: null });
    }

    // If form_name is provided, try to match the form by name
    let submission = submissions[0]; // default to most recent

    if (formName) {
      const formIds = [...new Set(submissions.map((s) => s.form_id))];
      const forms = formIds.length === 0 ? [] : await db
        .select({ id: formsT.id, name: formsT.name, schema: formsT.schema })
        .from(formsT)
        .where(inArray(formsT.id, formIds));

      const matchingForm = forms.find((f) => f.name === formName);
      if (matchingForm) {
        const matchingSub = submissions.find((s) => s.form_id === matchingForm.id);
        if (matchingSub) submission = matchingSub;
      }

      // Get form schema for field labels
      const form = matchingForm ?? forms[0];
      if (form?.schema) {
        const fields = extractFieldsFromSchema(
          form.schema as Record<string, unknown>,
          submission.responses as Record<string, unknown>
        );
        return NextResponse.json({
          submission_id: submission.id,
          fields,
          submitted_at: submission.created_at,
        });
      }
    }

    // Fallback: get form schema for the submission's form
    const [form] = await db
      .select({ schema: formsT.schema })
      .from(formsT)
      .where(eq(formsT.id, submission.form_id))
      .limit(1);

    if (form?.schema) {
      const fields = extractFieldsFromSchema(
        form.schema as Record<string, unknown>,
        submission.responses as Record<string, unknown>
      );
      return NextResponse.json({
        submission_id: submission.id,
        fields,
        submitted_at: submission.created_at,
      });
    }

    // Last resort: return responses as key-value pairs without labels
    const fields = Object.entries(submission.responses as Record<string, unknown>).map(
      ([key, value]) => ({
        label: key,
        value: String(value ?? ""),
      })
    );

    return NextResponse.json({
      submission_id: submission.id,
      fields,
      submitted_at: submission.created_at,
    });
  } catch (err) {
    console.error("[form-submission] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
