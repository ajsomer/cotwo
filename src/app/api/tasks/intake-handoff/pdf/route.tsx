import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
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
  organisations,
} from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";
import {
  normaliseQuestions,
  type SchemaRoot,
} from "@/lib/forms/format-answer-pdf";
import {
  IntakePackagePdf,
  intakePackagePdfFilename,
  type IntakePackageFormSection,
} from "@/lib/forms/submission-pdf-document";

/**
 * GET /api/tasks/intake-handoff/pdf?appointment_id=X
 *
 * Renders the whole intake package (every configured form + a card-on-file /
 * consent summary) as a single inline PDF. Mirrors the data resolution of
 * /api/tasks/intake-handoff and reuses the shared PDF document module.
 *
 * Staff-only; org-scoped. requireStaffCanAccessAppointment performs the auth
 * gate, so no separate authentication call is needed.
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointment_id");

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

    // Resolve the intake_package action + its block config (form list, card,
    // consent), same as the inline-review route.
    const actionRows = await db
      .select({
        id: appointmentActions.id,
        status: appointmentActions.status,
        action_block_id: appointmentActions.actionBlockId,
        completed_at: appointmentActions.completedAt,
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
      (a) => blockMap.get(a.action_block_id)?.action_type === "intake_package",
    );

    if (!intakeAction) {
      return NextResponse.json(
        { error: "No intake_package action found for appointment" },
        { status: 404 },
      );
    }

    const intakeBlock = blockMap.get(intakeAction.action_block_id);
    const blockConfig = (intakeBlock?.config ?? {}) as {
      includes_card_capture?: boolean;
      includes_consent?: boolean;
      form_ids?: string[];
    };

    const [journey] = await db
      .select({
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

    // Patient + org (for the PDF header). Prefer the journey's verified patient.
    const patientId = journey?.patient_id ?? appointment.patient_id ?? null;
    let patientName = "Patient";
    let patientDob: string | null = null;
    let orgName: string | null = null;
    let orgLogoUrl: string | null = null;
    if (patientId) {
      const [patient] = await db
        .select({
          first_name: patientsT.firstName,
          last_name: patientsT.lastName,
          date_of_birth: patientsT.dateOfBirth,
          org_id: patientsT.orgId,
        })
        .from(patientsT)
        .where(eq(patientsT.id, patientId))
        .limit(1);
      if (patient) {
        patientName = `${patient.first_name} ${patient.last_name}`;
        patientDob = patient.date_of_birth ?? null;
        if (patient.org_id) {
          const [org] = await db
            .select({ name: organisations.name, logo_url: organisations.logoUrl })
            .from(organisations)
            .where(eq(organisations.id, patient.org_id))
            .limit(1);
          orgName = org?.name ?? null;
          orgLogoUrl = org?.logo_url ?? null;
        }
      }
    }

    // Forms — load schema + this appointment's submission for each configured
    // form, then normalise to PDF questions. Forms without a submission still
    // render (with an empty-state note) rather than being dropped.
    const formSections: IntakePackageFormSection[] = [];
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
              inArray(formSubmissions.formId, formIds),
            ),
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
        if (!submissionByFormId.has(sub.form_id)) submissionByFormId.set(sub.form_id, sub);
      }

      for (const formId of formIds) {
        const form = formMap.get(formId);
        const submission = submissionByFormId.get(formId);
        const schema = (form?.schema as SchemaRoot | null | undefined) ?? null;
        const responses = (submission?.responses as Record<string, unknown>) ?? {};
        const questions = submission ? normaliseQuestions(schema, responses) : [];
        formSections.push({
          formId,
          formName: form?.name ?? "Form",
          submissionId: submission?.id ?? null,
          submittedAt: submission?.created_at ?? formsCompleted[formId] ?? null,
          questions,
        });
      }
    }

    // Card on file — brand / last four / captured timestamp only.
    let card: { brand: string; last_four: string; captured_at: string } | null = null;
    if (includesCardCapture && patientId) {
      const [pm] = await db
        .select({
          card_brand: paymentMethods.cardBrand,
          card_last_four: paymentMethods.cardLastFour,
          created_at: paymentMethods.createdAt,
        })
        .from(paymentMethods)
        .where(eq(paymentMethods.patientId, patientId))
        .orderBy(desc(paymentMethods.createdAt))
        .limit(1);
      const capturedAt = journey?.card_captured_at ?? pm?.created_at ?? null;
      if (pm) {
        card = { brand: pm.card_brand, last_four: pm.card_last_four, captured_at: capturedAt! };
      } else if (journey?.card_captured_at) {
        card = { brand: "Card", last_four: "", captured_at: journey.card_captured_at };
      }
    }

    const consentCompletedAt =
      journey?.consent_completed_at ??
      (includesConsent && intakeAction.status === "completed"
        ? intakeAction.completed_at
        : null);
    const consent =
      includesConsent && consentCompletedAt ? { completed_at: consentCompletedAt } : null;

    const completedAt =
      intakeAction.completed_at ??
      journey?.completed_at ??
      appointment.scheduled_at ??
      new Date(0).toISOString();

    const buffer = await renderToBuffer(
      <IntakePackagePdf
        patientName={patientName}
        patientDob={patientDob}
        orgName={orgName}
        orgLogoUrl={orgLogoUrl}
        completedAt={completedAt}
        forms={formSections}
        card={card}
        consent={consent}
      />,
    );

    return new Response(buffer as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${intakePackagePdfFilename(patientName, completedAt)}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    console.error("[intake-handoff-pdf] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
