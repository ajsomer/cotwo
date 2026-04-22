import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractFieldsFromSchema } from "@/lib/forms/extract-fields";

/**
 * GET /api/readiness/intake-handoff?appointment_id=X
 *
 * Returns everything the intake-package handoff panel needs in one shot:
 * the action's completion timestamp, every form's responses (flattened),
 * card on file, and consent status.
 *
 * The intake_package appointment_actions row is the source of truth for
 * "is this complete / transcribed". The intake_package_journeys row is
 * preferred for item configuration (which forms, did the patient capture
 * a card, did they sign consent) but the route falls back gracefully to
 * the action's config + form_submissions / payment_methods if the journey
 * is missing.
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointment_id");

  if (!appointmentId) {
    return NextResponse.json({ error: "appointment_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data: appointment, error: apptErr } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patient_id")
      .eq("id", appointmentId)
      .maybeSingle();

    if (apptErr || !appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    // Find the intake_package appointment_action — the source of truth for
    // completion / transcribed state.
    const { data: actionRows } = await supabase
      .from("appointment_actions")
      .select("id, status, action_block_id, completed_at, updated_at")
      .eq("appointment_id", appointmentId);

    const blockIds = (actionRows ?? []).map((a) => a.action_block_id);
    const { data: blocks } = blockIds.length
      ? await supabase
          .from("workflow_action_blocks")
          .select("id, action_type, config")
          .in("id", blockIds)
      : { data: [] as Array<{ id: string; action_type: string; config: unknown }> };

    const blockMap = new Map((blocks ?? []).map((b) => [b.id, b]));
    const intakeAction = (actionRows ?? []).find(
      (a) => blockMap.get(a.action_block_id)?.action_type === "intake_package"
    );

    if (!intakeAction) {
      return NextResponse.json(
        { error: "No intake_package action found for appointment" },
        { status: 404 }
      );
    }

    const intakeBlock = blockMap.get(intakeAction.action_block_id);
    const blockConfig = (intakeBlock?.config ?? {}) as {
      includes_card_capture?: boolean;
      includes_consent?: boolean;
      form_ids?: string[];
    };

    // Journey is preferred but optional — we'll fall back to block config.
    const { data: journey } = await supabase
      .from("intake_package_journeys")
      .select(
        "id, patient_id, form_ids, includes_card_capture, includes_consent, card_captured_at, consent_completed_at, forms_completed, completed_at"
      )
      .eq("appointment_id", appointmentId)
      .maybeSingle();

    const includesCardCapture =
      journey?.includes_card_capture ?? blockConfig.includes_card_capture ?? false;
    const includesConsent =
      journey?.includes_consent ?? blockConfig.includes_consent ?? false;
    const formIds: string[] =
      ((journey?.form_ids ?? blockConfig.form_ids) as string[] | undefined) ?? [];
    const formsCompleted = (journey?.forms_completed ?? {}) as Record<string, string>;

    // Patient name. Prefer the journey's verified patient (multi-contact aware),
    // fall back to the appointment patient.
    const patientId = journey?.patient_id ?? appointment.patient_id ?? null;
    let patientFirstName = "Unknown";
    let patientLastName = "";
    if (patientId) {
      const { data: patient } = await supabase
        .from("patients")
        .select("first_name, last_name")
        .eq("id", patientId)
        .maybeSingle();
      if (patient) {
        patientFirstName = patient.first_name;
        patientLastName = patient.last_name;
      }
    }

    // Forms — load each configured form's schema + the patient's submission
    // for this appointment, and flatten to label/value rows.
    let forms: Array<{
      form_id: string;
      form_name: string;
      submitted_at: string | null;
      fields: Array<{ label: string; value: string }>;
    }> = [];

    if (formIds.length > 0) {
      const [{ data: formRows }, { data: submissions }] = await Promise.all([
        supabase.from("forms").select("id, name, schema").in("id", formIds),
        supabase
          .from("form_submissions")
          .select("id, form_id, responses, created_at")
          .eq("appointment_id", appointmentId)
          .in("form_id", formIds)
          .order("created_at", { ascending: false }),
      ]);

      type SubmissionRow = {
        id: string;
        form_id: string;
        responses: unknown;
        created_at: string;
      };
      const formMap = new Map((formRows ?? []).map((f) => [f.id, f]));
      const submissionByFormId = new Map<string, SubmissionRow>();
      for (const sub of (submissions ?? []) as SubmissionRow[]) {
        if (!submissionByFormId.has(sub.form_id)) {
          submissionByFormId.set(sub.form_id, sub);
        }
      }

      forms = formIds.map((formId) => {
        const form = formMap.get(formId);
        const submission = submissionByFormId.get(formId);
        const submittedAt = submission?.created_at ?? formsCompleted[formId] ?? null;
        const fields =
          form?.schema && submission?.responses
            ? extractFieldsFromSchema(
                form.schema as Record<string, unknown>,
                submission.responses as Record<string, unknown>
              )
            : [];
        return {
          form_id: formId,
          form_name: form?.name ?? "Form",
          submitted_at: submittedAt,
          fields,
        };
      });
    }

    // Card on file. Prefer journey.card_captured_at; otherwise fall back to
    // the most recent payment method on the patient.
    let card: { brand: string; last_four: string; captured_at: string } | null = null;
    if (includesCardCapture && patientId) {
      const { data: paymentMethods } = await supabase
        .from("payment_methods")
        .select("card_brand, card_last_four, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1);
      const pm = paymentMethods?.[0];
      const capturedAt = journey?.card_captured_at ?? pm?.created_at ?? null;
      if (pm) {
        card = {
          brand: pm.card_brand,
          last_four: pm.card_last_four,
          captured_at: capturedAt!,
        };
      } else if (journey?.card_captured_at) {
        card = {
          brand: "Card",
          last_four: "",
          captured_at: journey.card_captured_at,
        };
      }
    }

    const consentCompletedAt =
      journey?.consent_completed_at ??
      (includesConsent && intakeAction.status === "completed"
        ? intakeAction.completed_at
        : null);
    const consent =
      includesConsent && consentCompletedAt
        ? { completed_at: consentCompletedAt }
        : null;

    return NextResponse.json({
      appointment: {
        id: appointment.id,
        scheduled_at: appointment.scheduled_at,
        patient_first_name: patientFirstName,
        patient_last_name: patientLastName,
      },
      action: {
        id: intakeAction.id,
        status: intakeAction.status,
        completed_at: intakeAction.completed_at,
      },
      forms,
      card,
      consent,
    });
  } catch (err) {
    console.error("[intake-handoff] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
