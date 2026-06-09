"use server";

import { db } from "@/lib/db";
import {
  appointments as appointmentsT,
  appointmentActions,
  appointmentTypes as appointmentTypesT,
  appointmentWorkflowRuns,
  forms as formsT,
  formSubmissions,
  intakePackageJourneys,
  locations as locationsT,
  organisations as organisationsT,
  patients as patientsT,
  patientPhoneNumbers,
  paymentMethods,
  staffAssignments,
  typeWorkflowLinks,
  workflowActionBlocks,
} from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getAuthenticatedUserId } from "@/lib/auth/staff-access";

/**
 * Seeds the Tasks (Readiness) dashboard with pre-appointment intake demo data.
 *
 * This is the readiness-side counterpart to src/lib/runsheet/seed.ts. It is
 * deliberately self-contained: it uses its own dedicated patient/appointment
 * ID ranges (the `…41xx` / `…51xx` blocks below) so it never collides with the
 * run sheet demo seed (`…40xx` / `…50xx`). Either seed can run independently and
 * clearing one leaves the other untouched.
 *
 * It targets the org's pre-appointment "Initial consultation" workflow — the
 * default "Standard New Patient Intake" template — and the "New Patient Intake"
 * form. Both are generated/seeded per-org at runtime, so we resolve their real
 * IDs dynamically rather than hard-coding them.
 *
 * Two lifecycle states are produced (4 patients each):
 *   - in_progress:  intake_package action `sent`, patient still completing the
 *                   journey. All non-terminal actions are dated in the FUTURE so
 *                   the classifier keeps them in `in_progress` (a past scheduled
 *                   non-terminal action on a near appointment would slip to
 *                   `at_risk`/`overdue` — see src/lib/readiness/derived-state.ts).
 *   - form_completed_needs_transcription: intake_package action `completed`,
 *                   a finished intake_package_journeys row, a populated
 *                   form_submissions row, and a payment_methods row (the intake
 *                   package includes card capture), so the Review handoff panel
 *                   shows real data to transcribe.
 */

// Dedicated ID ranges (kept distinct from the run sheet seed's …40xx/…50xx).
const PATIENT_PREFIX = "00000000-0000-0000-0000-0000000041"; // …4101 – …4108
const PHONE_PREFIX = "00000000-0000-0000-0000-0000000b41"; //   …b4101 – …b4108
const APPT_PREFIX = "00000000-0000-0000-0000-0000000051"; //    …5101 – …5108
const PM_PREFIX = "00000000-0000-0000-0000-0000000c41"; //      …c4105 – …c4108

const pad2 = (n: number) => n.toString().padStart(2, "0");

interface SeededPatient {
  idx: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  /** Days from now the appointment is scheduled. */
  daysOut: number;
  state: "in_progress" | "form_completed";
  /** Submission responses (form_completed only), keyed by schema element name. */
  responses?: Record<string, unknown>;
  card?: { brand: string; lastFour: string; expiry: string };
}

// 4 in_progress + 4 form_completed. In_progress appointments sit >7 days out so
// no non-terminal action can fall inside the at_risk (7d) / overdue (24h) windows.
const PATIENTS: SeededPatient[] = [
  { idx: 1, firstName: "Hannah", lastName: "Nguyen", dateOfBirth: "1991-02-18", daysOut: 9, state: "in_progress" },
  { idx: 2, firstName: "Leo", lastName: "Fitzgerald", dateOfBirth: "1983-10-05", daysOut: 11, state: "in_progress" },
  { idx: 3, firstName: "Priya", lastName: "Sharma", dateOfBirth: "1996-06-27", daysOut: 12, state: "in_progress" },
  { idx: 4, firstName: "Tom", lastName: "Becker", dateOfBirth: "1978-12-11", daysOut: 14, state: "in_progress" },
  {
    idx: 5,
    firstName: "Grace",
    lastName: "O'Sullivan",
    dateOfBirth: "1989-04-09",
    daysOut: 3,
    state: "form_completed",
    card: { brand: "Visa", lastFour: "4242", expiry: "11/27" },
    // Keyed to the live "New Patient Intake" schema element names.
    responses: {
      __identity_first_name: "Grace",
      __identity_last_name: "O'Sullivan",
      __identity_date_of_birth: "1989-04-09",
      __identity_email: "grace.osullivan@example.com",
      mobilePhone: "+61412555905",
      gender: "Female",
      homeAddress: "12 Marine Parade, Bondi NSW 2026",
      emergencyContactName: "Daniel O'Sullivan",
      emergencyContactRelationship: "Partner",
      emergencyContactPhone: "+61412555901",
      medicareNumber: "2298 41827 1",
      medicareIRN: "1",
      medicareExpiry: "08/27",
      privateHealthFund: "Bupa",
      privateHealthMemberNumber: "BUP-4471028",
      hasConditions: true,
      conditionsDescription: "Asthma and generalised anxiety. Appendectomy in 2014.",
      currentMedications: "Ventolin 100mcg as needed; Sertraline 50mg daily.",
      allergies: "Penicillin (rash).",
      consentHealthInfo: true,
      consentPrivacyPolicy: true,
      patient_signature: "Grace O'Sullivan",
    },
  },
  {
    idx: 6,
    firstName: "Aaron",
    lastName: "Kelly",
    dateOfBirth: "1972-08-22",
    daysOut: 4,
    state: "form_completed",
    card: { brand: "Mastercard", lastFour: "5555", expiry: "06/26" },
    responses: {
      __identity_first_name: "Aaron",
      __identity_last_name: "Kelly",
      __identity_date_of_birth: "1972-08-22",
      __identity_email: "aaron.kelly@example.com",
      mobilePhone: "+61412555906",
      gender: "Male",
      homeAddress: "88 Rundle St, Adelaide SA 5000",
      emergencyContactName: "Megan Kelly",
      emergencyContactRelationship: "Child",
      emergencyContactPhone: "+61412555902",
      medicareNumber: "3145 27716 4",
      medicareIRN: "2",
      medicareExpiry: "04/26",
      privateHealthFund: "Medibank",
      privateHealthMemberNumber: "MED-8820145",
      hasConditions: true,
      conditionsDescription: "Type 2 diabetes managed with diet. High blood pressure.",
      currentMedications: "Metformin 500mg twice daily.",
      allergies: "None known.",
      consentHealthInfo: true,
      consentPrivacyPolicy: true,
      patient_signature: "Aaron Kelly",
    },
  },
  {
    idx: 7,
    firstName: "Isabella",
    lastName: "Romano",
    dateOfBirth: "2000-01-14",
    daysOut: 5,
    state: "form_completed",
    card: { brand: "Visa", lastFour: "1881", expiry: "09/28" },
    responses: {
      __identity_first_name: "Isabella",
      __identity_last_name: "Romano",
      __identity_date_of_birth: "2000-01-14",
      __identity_email: "isabella.romano@example.com",
      mobilePhone: "+61412555907",
      gender: "Female",
      homeAddress: "5/210 Lygon St, Carlton VIC 3053",
      emergencyContactName: "Sofia Romano",
      emergencyContactRelationship: "Parent",
      emergencyContactPhone: "+61412555903",
      medicareNumber: "4012 88321 9",
      medicareIRN: "1",
      medicareExpiry: "11/29",
      hasConditions: false,
      currentMedications: "None.",
      allergies: "Hayfever (seasonal).",
      consentHealthInfo: true,
      consentPrivacyPolicy: true,
      patient_signature: "Isabella Romano",
    },
  },
  {
    idx: 8,
    firstName: "Samuel",
    lastName: "Wright",
    dateOfBirth: "1965-05-30",
    daysOut: 6,
    state: "form_completed",
    card: { brand: "Amex", lastFour: "0005", expiry: "03/27" },
    responses: {
      __identity_first_name: "Samuel",
      __identity_last_name: "Wright",
      __identity_date_of_birth: "1965-05-30",
      __identity_email: "sam.wright@example.com",
      mobilePhone: "+61412555908",
      gender: "Male",
      homeAddress: "23 Hay St, Perth WA 6000",
      emergencyContactName: "Linda Wright",
      emergencyContactRelationship: "Partner",
      emergencyContactPhone: "+61412555904",
      medicareNumber: "5523 19044 7",
      medicareIRN: "3",
      medicareExpiry: "02/28",
      privateHealthFund: "HCF",
      privateHealthMemberNumber: "HCF-3390712",
      hasConditions: true,
      conditionsDescription:
        "Heart disease (coronary stent placed 2019), high blood pressure, chronic lower back pain.",
      currentMedications: "Atorvastatin 40mg nightly; Aspirin 100mg daily; Endone 5mg as needed.",
      allergies: "Codeine (nausea).",
      consentHealthInfo: true,
      consentPrivacyPolicy: true,
      patient_signature: "Samuel Wright",
    },
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

type ResolvedContext = {
  ORG_ID: string;
  LOCATION_ID: string;
  templateId: string;
  intakeBlock: { id: string; config: unknown; formId: string | null };
  blocks: Array<{
    id: string;
    action_type: string;
    offset_minutes: number;
    offset_direction: string;
    config: unknown;
    form_id: string | null;
  }>;
  intakeFormIds: string[];
  clinicianId: string;
  appointmentTypeId: string;
};

/**
 * Resolve the authenticated user's org/location and the real per-org IDs for the
 * Initial-consultation pre-appointment workflow + New Patient Intake form.
 * Returns a string error key when prerequisites are missing.
 */
async function resolveContext(): Promise<ResolvedContext | { error: string }> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { error: "Not authenticated" };

  const [assignment] = await db
    .select({
      location_id: staffAssignments.locationId,
      org_id: locationsT.orgId,
    })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!assignment) {
    return { error: "No staff assignment found. Complete clinic setup first." };
  }

  const ORG_ID = assignment.org_id;
  const LOCATION_ID = assignment.location_id;

  // Find an "Initial consultation"-style appointment type in this org that has a
  // linked pre-appointment workflow template. Joining through appointment_types
  // scopes the link to the org (type_workflow_links has no org_id of its own).
  const [link] = await db
    .select({
      template_id: typeWorkflowLinks.workflowTemplateId,
      appointment_type_id: typeWorkflowLinks.appointmentTypeId,
    })
    .from(typeWorkflowLinks)
    .innerJoin(appointmentTypesT, eq(typeWorkflowLinks.appointmentTypeId, appointmentTypesT.id))
    .where(
      and(
        eq(typeWorkflowLinks.direction, "pre_appointment"),
        eq(appointmentTypesT.orgId, ORG_ID)
      )
    )
    .limit(1);

  return finishResolve(ORG_ID, LOCATION_ID, userId, link?.template_id, link?.appointment_type_id);
}

async function finishResolve(
  ORG_ID: string,
  LOCATION_ID: string,
  userId: string,
  templateId: string | undefined,
  appointmentTypeId: string | undefined
): Promise<ResolvedContext | { error: string }> {
  if (!templateId || !appointmentTypeId) {
    return {
      error:
        "No pre-appointment workflow is linked to an appointment type for this clinic. Set up the Standard New Patient Intake workflow first.",
    };
  }

  const blocks = await db
    .select({
      id: workflowActionBlocks.id,
      action_type: workflowActionBlocks.actionType,
      offset_minutes: workflowActionBlocks.offsetMinutes,
      offset_direction: workflowActionBlocks.offsetDirection,
      config: workflowActionBlocks.config,
      form_id: workflowActionBlocks.formId,
    })
    .from(workflowActionBlocks)
    .where(eq(workflowActionBlocks.templateId, templateId))
    .orderBy(asc(workflowActionBlocks.sortOrder));

  const intakeBlock = blocks.find((b) => b.action_type === "intake_package");
  if (!intakeBlock) {
    return { error: "The linked workflow has no intake_package action block." };
  }

  // Form IDs live in the intake_package block config (form_ids[]).
  const cfg = (intakeBlock.config ?? {}) as { form_ids?: string[] };
  let intakeFormIds = Array.isArray(cfg.form_ids) ? cfg.form_ids.filter(Boolean) : [];

  // Fall back to resolving the "New Patient Intake" form by name within the org.
  if (intakeFormIds.length === 0) {
    const [form] = await db
      .select({ id: formsT.id })
      .from(formsT)
      .where(and(eq(formsT.orgId, ORG_ID), eq(formsT.name, "New Patient Intake")))
      .limit(1);
    if (form) intakeFormIds = [form.id];
  }

  if (intakeFormIds.length === 0) {
    return { error: "No intake form is configured on the workflow's intake_package block." };
  }

  // Find a clinician at the location for the appointment (fallback to the user).
  const [clinician] = await db
    .select({ user_id: staffAssignments.userId })
    .from(staffAssignments)
    .where(
      and(
        eq(staffAssignments.locationId, LOCATION_ID),
        inArray(staffAssignments.role, ["clinician", "clinic_owner"])
      )
    )
    .limit(1);

  return {
    ORG_ID,
    LOCATION_ID,
    templateId,
    appointmentTypeId,
    intakeBlock: { id: intakeBlock.id, config: intakeBlock.config, formId: intakeBlock.form_id },
    blocks: blocks.map((b) => ({
      id: b.id,
      action_type: b.action_type,
      offset_minutes: b.offset_minutes,
      offset_direction: b.offset_direction,
      config: b.config,
      form_id: b.form_id,
    })),
    intakeFormIds,
    clinicianId: clinician?.user_id ?? userId,
  };
}

/**
 * Compute scheduled_for for a block, mirroring scheduleWorkflowForAppointment,
 * but with one seed-specific deviation for in_progress rows: every non-terminal
 * action is anchored in the FUTURE so the readiness classifier keeps the
 * appointment in `in_progress` rather than `at_risk`/`overdue`.
 */
function scheduledForFor(
  block: ResolvedContext["blocks"][number],
  apptTime: number,
  now: number,
  state: "in_progress" | "form_completed"
): { scheduledFor: number; status: "scheduled" | "sent" | "completed" } {
  if (block.action_type === "intake_package") {
    if (state === "form_completed") {
      // Terminal (`completed`) status — past-dating is safe and reads as
      // "patient finished their intake two days ago".
      return { scheduledFor: now - 2 * DAY_MS, status: "completed" };
    }
    // in_progress: the package has been `sent` but the patient is still working
    // through it. This action is NON-TERMINAL, so it MUST be future-dated — a
    // past-dated non-terminal action older than 48h trips isOverdue() (and a
    // past-dated one on an appointment within 7 days trips isAtRisk()). See
    // src/lib/readiness/derived-state.ts. Future-dating keeps the row in
    // `in_progress`.
    return { scheduledFor: now + 2 * DAY_MS, status: "sent" };
  }

  if (block.action_type === "intake_reminder") {
    const cfg = (block.config ?? {}) as { offset_days?: number };
    const offsetDays = cfg.offset_days ?? block.offset_minutes / (60 * 24);
    // Reminder fires offset_days after the package went out → keep in the future.
    return { scheduledFor: now + Math.max(1, offsetDays) * DAY_MS, status: "scheduled" };
  }

  if (block.action_type === "add_to_runsheet") {
    return { scheduledFor: apptTime, status: "scheduled" };
  }

  // Legacy/offset actions (e.g. send_reminder): anchor relative to appointment
  // time. These are all in the future for our future-dated appointments.
  return { scheduledFor: apptTime - block.offset_minutes * 60 * 1000, status: "scheduled" };
}

/**
 * Ensure the intake form has a `patient_signature` signaturepad field so the
 * seeded signature renders in the review panel / PDF. Idempotent: appends the
 * field to the consent panel (or the last page) only if no signature element
 * exists yet. Scoped to the single form the seed resolves — other orgs' forms
 * are untouched.
 */
async function ensureSignatureField(formId: string): Promise<void> {
  const [form] = await db
    .select({ schema: formsT.schema })
    .from(formsT)
    .where(eq(formsT.id, formId))
    .limit(1);
  if (!form?.schema) return;

  const schema = form.schema as {
    pages?: Array<{ name?: string; elements?: Array<Record<string, unknown>> }>;
  };
  const pages = schema.pages;
  if (!Array.isArray(pages) || pages.length === 0) return;

  // Walk pages + nested panels to detect an existing signature element.
  const hasSignature = (els: Array<Record<string, unknown>> | undefined): boolean =>
    Array.isArray(els) &&
    els.some(
      (e) =>
        e.type === "signaturepad" ||
        e.name === "patient_signature" ||
        hasSignature(e.elements as Array<Record<string, unknown>> | undefined),
    );
  if (pages.some((p) => hasSignature(p.elements))) return;

  const signatureField = {
    type: "signaturepad",
    name: "patient_signature",
    title: "Patient signature",
    isRequired: true,
  };

  // Prefer the consent panel; fall back to the last page's elements.
  let placed = false;
  for (const page of pages) {
    for (const el of page.elements ?? []) {
      if (el.name === "panel_consent" && Array.isArray(el.elements)) {
        (el.elements as Array<Record<string, unknown>>).push(signatureField);
        placed = true;
        break;
      }
    }
    if (placed) break;
  }
  if (!placed) {
    const lastPage = pages[pages.length - 1];
    lastPage.elements = [...(lastPage.elements ?? []), signatureField];
  }

  await db.update(formsT).set({ schema }).where(eq(formsT.id, formId));
}

export async function seedTasksData() {
  const ctx = await resolveContext();
  if ("error" in ctx) return { success: false, error: ctx.error };

  const now = Date.now();

  try {
    // Clean any prior tasks-seed data first (idempotent re-seed).
    await clearTasksDataInternal(ctx.ORG_ID);

    // Make sure the intake form carries a signature field so the seeded
    // patient_signature value renders in the review panel.
    for (const formId of ctx.intakeFormIds) {
      await ensureSignatureField(formId);
    }

    // Patients + primary phones.
    await db
      .insert(patientsT)
      .values(
        PATIENTS.map((p) => ({
          id: `${PATIENT_PREFIX}${pad2(p.idx)}`,
          orgId: ctx.ORG_ID,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth,
        }))
      )
      .onConflictDoUpdate({ target: patientsT.id, set: { orgId: ctx.ORG_ID } });

    await db
      .insert(patientPhoneNumbers)
      .values(
        PATIENTS.map((p) => ({
          id: `${PHONE_PREFIX}${pad2(p.idx)}`,
          patientId: `${PATIENT_PREFIX}${pad2(p.idx)}`,
          phoneNumber: `+6141255590${p.idx}`,
          isPrimary: true,
        }))
      )
      .onConflictDoUpdate({ target: patientPhoneNumbers.id, set: { isPrimary: true } });

    for (const p of PATIENTS) {
      const patientId = `${PATIENT_PREFIX}${pad2(p.idx)}`;
      const apptId = `${APPT_PREFIX}${pad2(p.idx)}`;
      const apptTime = now + p.daysOut * DAY_MS;

      // Appointment.
      await db
        .insert(appointmentsT)
        .values({
          id: apptId,
          orgId: ctx.ORG_ID,
          patientId,
          clinicianId: ctx.clinicianId,
          appointmentTypeId: ctx.appointmentTypeId,
          locationId: ctx.LOCATION_ID,
          scheduledAt: new Date(apptTime).toISOString(),
          phoneNumber: `+6141255590${p.idx}`,
        })
        .onConflictDoUpdate({
          target: appointmentsT.id,
          set: { scheduledAt: new Date(apptTime).toISOString(), clinicianId: ctx.clinicianId },
        });

      // Workflow run (pre_appointment, active).
      const [run] = await db
        .insert(appointmentWorkflowRuns)
        .values({
          appointmentId: apptId,
          workflowTemplateId: ctx.templateId,
          direction: "pre_appointment",
          status: "active",
        })
        .returning({ id: appointmentWorkflowRuns.id });

      // Action rows — one per block, mirroring the real engine's config copy.
      for (const block of ctx.blocks) {
        const { scheduledFor, status } = scheduledForFor(block, apptTime, now, p.state);
        const isIntake = block.action_type === "intake_package";
        const completed = isIntake && p.state === "form_completed";

        await db.insert(appointmentActions).values({
          appointmentId: apptId,
          actionBlockId: block.id,
          workflowRunId: run.id,
          status,
          scheduledFor: new Date(scheduledFor).toISOString(),
          // The package was actually delivered ~2 days ago regardless of the
          // (possibly future) scheduled_for we use to keep in_progress rows out
          // of the overdue/at-risk windows.
          firedAt:
            isIntake && (status === "sent" || status === "completed")
              ? new Date(now - 2 * DAY_MS).toISOString()
              : null,
          completedAt: completed ? new Date(now - 1 * DAY_MS).toISOString() : null,
          config: block.config ?? null,
          formId: block.action_type === "intake_package" ? null : block.form_id,
        });
      }

      // Intake-package journey.
      const intakeCfg = (ctx.intakeBlock.config ?? {}) as {
        includes_card_capture?: boolean;
        includes_consent?: boolean;
      };
      const includesCard = intakeCfg.includes_card_capture ?? true;
      const includesConsent = intakeCfg.includes_consent ?? false;
      const completed = p.state === "form_completed";
      const formsCompleted: Record<string, string> = {};
      if (completed) {
        for (const fid of ctx.intakeFormIds) formsCompleted[fid] = new Date(now - 1 * DAY_MS).toISOString();
      }

      await db.insert(intakePackageJourneys).values({
        appointmentId: apptId,
        patientId,
        journeyToken: `seed-intake-${p.idx}-${apptId.slice(-4)}`,
        status: completed ? "completed" : "in_progress",
        includesCardCapture: includesCard,
        includesConsent: includesConsent,
        formIds: ctx.intakeFormIds,
        cardCapturedAt: completed && includesCard ? new Date(now - 1 * DAY_MS).toISOString() : null,
        consentCompletedAt:
          completed && includesConsent ? new Date(now - 1 * DAY_MS).toISOString() : null,
        formsCompleted,
        completedAt: completed ? new Date(now - 1 * DAY_MS).toISOString() : null,
      });

      // For completed patients: payment method + form submission(s).
      if (completed) {
        if (includesCard && p.card) {
          await db
            .insert(paymentMethods)
            .values({
              id: `${PM_PREFIX}${pad2(p.idx)}`,
              patientId,
              stripePaymentMethodId: `pm_seed_intake_${p.idx}`,
              cardLastFour: p.card.lastFour,
              cardBrand: p.card.brand,
              cardExpiry: p.card.expiry,
              isDefault: true,
              createdAt: new Date(now - 1 * DAY_MS).toISOString(),
            })
            .onConflictDoUpdate({ target: paymentMethods.id, set: { isDefault: true } });
        }

        // One submission per configured intake form. submission_source must be
        // 'entry_flow' with review_status null (DB CHECK constraint), which is
        // also the combination that allows an appointment_id to be set.
        for (const fid of ctx.intakeFormIds) {
          await db.insert(formSubmissions).values({
            formId: fid,
            patientId,
            appointmentId: apptId,
            responses: p.responses ?? {},
            submissionSource: "entry_flow",
            reviewStatus: null,
            createdAt: new Date(now - 1 * DAY_MS).toISOString(),
          });
        }
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[TASKS SEED] Failed:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Removes only the tasks-seed records, in FK-safe order. Appointments cascade
 * to workflow runs, actions, and journeys, but form_submissions
 * (appointment_id ON DELETE SET NULL) and payment_methods must be removed first
 * to avoid orphans.
 */
async function clearTasksDataInternal(orgId: string) {
  const patientIds = PATIENTS.map((p) => `${PATIENT_PREFIX}${pad2(p.idx)}`);
  const apptIds = PATIENTS.map((p) => `${APPT_PREFIX}${pad2(p.idx)}`);

  // Submissions first (would otherwise be orphaned: appointment_id SET NULL).
  await db.delete(formSubmissions).where(inArray(formSubmissions.appointmentId, apptIds));
  // Payment methods (cascade from patient, but delete explicitly for clarity).
  await db.delete(paymentMethods).where(inArray(paymentMethods.patientId, patientIds));
  // Journeys (cascade from appointment, but explicit for ordering safety).
  await db.delete(intakePackageJourneys).where(inArray(intakePackageJourneys.appointmentId, apptIds));
  // Appointments — cascades to appointment_workflow_runs + appointment_actions.
  await db.delete(appointmentsT).where(inArray(appointmentsT.id, apptIds));
  // Phones, then patients.
  await db.delete(patientPhoneNumbers).where(inArray(patientPhoneNumbers.patientId, patientIds));
  await db.delete(patientsT).where(and(eq(patientsT.orgId, orgId), inArray(patientsT.id, patientIds)));
}

export async function clearTasksData() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: "Not authenticated" };

  const [assignment] = await db
    .select({ org_id: locationsT.orgId })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!assignment) return { success: false, error: "No staff assignment found." };

  try {
    await clearTasksDataInternal(assignment.org_id);
    return { success: true };
  } catch (err) {
    console.error("[TASKS CLEAR] Failed:", err);
    return { success: false, error: String(err) };
  }
}
