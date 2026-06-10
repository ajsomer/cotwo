import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  appointmentActions,
  workflowActionBlocks,
  intakePackageJourneys,
  patients as patientsT,
  forms as formsT,
  formSubmissions,
  paymentMethods,
} from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { extractFieldsFromSchema } from "@/lib/forms/extract-fields";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * GET /api/tasks/intake-handoff?appointment_id=X
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

  const access = await requireStaffCanAccessAppointment(appointmentId);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
    const [appointment] = await db
      .select({
        id: appointmentsT.id,
        scheduled_at: appointmentsT.scheduledAt,
        patient_id: appointmentsT.patientId,
      })
      .from(appointmentsT)
      .where(eq(appointmentsT.id, appointmentId))
      .limit(1);

    if (!appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    // Find the intake_package appointment_action — the source of truth for
    // completion / transcribed state.
    const actionRows = await db
      .select({
        id: appointmentActions.id,
        status: appointmentActions.status,
        action_block_id: appointmentActions.actionBlockId,
        completed_at: appointmentActions.completedAt,
        updated_at: appointmentActions.updatedAt,
      })
      .from(appointmentActions)
      .where(eq(appointmentActions.appointmentId, appointmentId));

    const blockIds = actionRows.map((a) => a.action_block_id);
    const blocks = blockIds.length === 0 ? [] : await db
      .select({
        id: workflowActionBlocks.id,
        action_type: workflowActionBlocks.actionType,
        config: workflowActionBlocks.config,
      })
      .from(workflowActionBlocks)
      .where(inArray(workflowActionBlocks.id, blockIds));

    const blockMap = new Map(blocks.map((b) => [b.id, b]));
    const intakeAction = actionRows.find(
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
    const [journey] = await db
      .select({
        id: intakePackageJourneys.id,
        patient_id: intakePackageJourneys.patientId,
        form_ids: intakePackageJourneys.formIds,
        includes_card_capture: intakePackageJourneys.includesCardCapture,
        includes_consent: intakePackageJourneys.includesConsent,
        card_captured_at: intakePackageJourneys.cardCapturedAt,
        consent_completed_at: intakePackageJourneys.consentCompletedAt,
        forms_completed: intakePackageJourneys.formsCompleted,
        completed_at: intakePackageJourneys.completedAt,
      })
      .from(intakePackageJourneys)
      .where(eq(intakePackageJourneys.appointmentId, appointmentId))
      .limit(1);

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
      const [patient] = await db
        .select({ first_name: patientsT.firstName, last_name: patientsT.lastName })
        .from(patientsT)
        .where(eq(patientsT.id, patientId))
        .limit(1);
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
      const [formRows, submissions] = await Promise.all([
        db
          .select({ id: formsT.id, name: formsT.name, schema: formsT.schema })
          .from(formsT)
          .where(inArray(formsT.id, formIds)),
        db
          .select({
            id: formSubmissions.id,
            form_id: formSubmissions.formId,
            responses: formSubmissions.responses,
            created_at: formSubmissions.createdAt,
          })
          .from(formSubmissions)
          .where(
            and(
              eq(formSubmissions.appointmentId, appointmentId),
              inArray(formSubmissions.formId, formIds)
            )
          )
          .orderBy(desc(formSubmissions.createdAt)),
      ]);

      type SubmissionRow = {
        id: string;
        form_id: string;
        responses: unknown;
        created_at: string;
      };
      const formMap = new Map(formRows.map((f) => [f.id, f]));
      const submissionByFormId = new Map<string, SubmissionRow>();
      for (const sub of submissions as SubmissionRow[]) {
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
      const paymentMethodRows = await db
        .select({
          card_brand: paymentMethods.cardBrand,
          card_last_four: paymentMethods.cardLastFour,
          created_at: paymentMethods.createdAt,
        })
        .from(paymentMethods)
        .where(eq(paymentMethods.patientId, patientId))
        .orderBy(desc(paymentMethods.createdAt))
        .limit(1);
      const pm = paymentMethodRows[0];
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
