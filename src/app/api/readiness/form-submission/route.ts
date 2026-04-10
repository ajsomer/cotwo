import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/readiness/form-submission?appointment_id=xxx&form_name=yyy
 *
 * Fetches a form submission for the given appointment, returns the responses
 * mapped to field labels from the form schema.
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointment_id");
  const formName = request.nextUrl.searchParams.get("form_name");

  if (!appointmentId) {
    return NextResponse.json({ error: "appointment_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    // Find form submissions for this appointment
    const { data: submissions } = await supabase
      .from("form_submissions")
      .select("id, form_id, responses, created_at")
      .eq("appointment_id", appointmentId)
      .order("created_at", { ascending: false });

    if (!submissions || submissions.length === 0) {
      return NextResponse.json({ fields: [], submitted_at: null });
    }

    // If form_name is provided, try to match the form by name
    let submission = submissions[0]; // default to most recent

    if (formName) {
      const formIds = [...new Set(submissions.map((s) => s.form_id))];
      const { data: forms } = await supabase
        .from("forms")
        .select("id, name, schema")
        .in("id", formIds);

      const matchingForm = forms?.find((f) => f.name === formName);
      if (matchingForm) {
        const matchingSub = submissions.find((s) => s.form_id === matchingForm.id);
        if (matchingSub) submission = matchingSub;
      }

      // Get form schema for field labels
      const form = matchingForm ?? forms?.[0];
      if (form?.schema) {
        const fields = extractFieldsFromSchema(form.schema, submission.responses);
        return NextResponse.json({
          fields,
          submitted_at: submission.created_at,
        });
      }
    }

    // Fallback: get form schema for the submission's form
    const { data: form } = await supabase
      .from("forms")
      .select("schema")
      .eq("id", submission.form_id)
      .single();

    if (form?.schema) {
      const fields = extractFieldsFromSchema(form.schema, submission.responses);
      return NextResponse.json({
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
      fields,
      submitted_at: submission.created_at,
    });
  } catch (err) {
    console.error("[form-submission] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Extract field labels and values from a SurveyJS-style schema and responses.
 */
function extractFieldsFromSchema(
  schema: Record<string, unknown>,
  responses: Record<string, unknown>
): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];

  // SurveyJS schema has pages -> elements -> name/title
  const pages = (schema as { pages?: Array<{ elements?: Array<{ name: string; title?: string }> }> }).pages;
  if (pages) {
    for (const page of pages) {
      for (const element of page.elements ?? []) {
        const value = responses[element.name];
        fields.push({
          label: element.title ?? element.name,
          value: formatValue(value),
        });
      }
    }
  }

  // If no pages, try flat elements
  if (fields.length === 0) {
    const elements = (schema as { elements?: Array<{ name: string; title?: string }> }).elements;
    if (elements) {
      for (const element of elements) {
        const value = responses[element.name];
        fields.push({
          label: element.title ?? element.name,
          value: formatValue(value),
        });
      }
    }
  }

  // Fallback: just use response keys
  if (fields.length === 0) {
    for (const [key, value] of Object.entries(responses)) {
      fields.push({ label: key, value: formatValue(value) });
    }
  }

  return fields;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}
