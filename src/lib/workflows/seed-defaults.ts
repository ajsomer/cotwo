import { db } from "@/lib/db";
import {
  forms as formsT,
  appointmentTypes as appointmentTypesT,
  workflowTemplates as workflowTemplatesT,
  workflowActionBlocks,
  typeWorkflowLinks,
  outcomePathways as outcomePathwaysT,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Seed default workflow templates, action blocks, type_workflow_links, and
 * outcome pathways for a new organisation. Called during clinic setup and
 * also available as a standalone function for existing orgs.
 *
 * Requires appointment types and published forms to already exist in the org.
 * If forms aren't found by name, form-dependent action blocks will have null
 * form_id — the action will fail at execution time but the workflow structure
 * is still correct and editable.
 */
export async function seedDefaultWorkflows(orgId: string): Promise<void> {
  // Look up existing published forms by name
  const orgForms = await db
    .select({ id: formsT.id, name: formsT.name })
    .from(formsT)
    .where(and(eq(formsT.orgId, orgId), eq(formsT.status, "published")));

  const formByName = new Map(orgForms.map((f) => [f.name, f.id]));
  const intakeFormId = formByName.get("New Patient Intake") ?? null;
  const k10FormId = formByName.get("Mental Health Assessment (K10)") ?? null;
  const satisfactionFormId = formByName.get("Patient Satisfaction Survey") ?? null;

  // Look up existing appointment types
  const types = await db
    .select({ id: appointmentTypesT.id, name: appointmentTypesT.name })
    .from(appointmentTypesT)
    .where(eq(appointmentTypesT.orgId, orgId));

  const typeByName = new Map(types.map((t) => [t.name, t.id]));

  // --- Pre-appointment workflow templates ---

  const preTemplates = [
    { name: "Standard New Patient Intake", typeNames: ["Initial Consultation"] },
    { name: "Returning Patient Quick Check", typeNames: ["Follow-up Consultation", "Review Appointment"] },
    { name: "Telehealth-specific Setup", typeNames: ["Telehealth Consultation"] },
    { name: "Minimal Reminder Only", typeNames: ["Brief Check-in"] },
  ];

  for (const tpl of preTemplates) {
    // Check if template already exists
    const [existing] = await db
      .select({ id: workflowTemplatesT.id })
      .from(workflowTemplatesT)
      .where(
        and(
          eq(workflowTemplatesT.orgId, orgId),
          eq(workflowTemplatesT.name, tpl.name),
          eq(workflowTemplatesT.direction, "pre_appointment")
        )
      )
      .limit(1);

    if (existing) continue; // Already seeded

    const [template] = await db
      .insert(workflowTemplatesT)
      .values({
        orgId,
        name: tpl.name,
        direction: "pre_appointment",
        status: "published",
        terminalType: "run_sheet",
      })
      .returning({ id: workflowTemplatesT.id });

    if (!template) continue;

    // Create action blocks based on template name.
    await seedPreActionBlocks(tpl.name, template.id, intakeFormId);

    // Link to matching appointment types
    for (const typeName of tpl.typeNames) {
      const typeId = typeByName.get(typeName);
      if (!typeId) continue;

      // Check if link already exists
      const [existingLink] = await db
        .select({ id: typeWorkflowLinks.id })
        .from(typeWorkflowLinks)
        .where(
          and(
            eq(typeWorkflowLinks.appointmentTypeId, typeId),
            eq(typeWorkflowLinks.direction, "pre_appointment")
          )
        )
        .limit(1);

      if (!existingLink) {
        await db.insert(typeWorkflowLinks).values({
          appointmentTypeId: typeId,
          workflowTemplateId: template.id,
          direction: "pre_appointment",
        });
      }
    }
  }

  // --- Post-appointment workflow templates + outcome pathways ---

  const postTemplates = [
    {
      name: "Discharge with Home Exercises",
      pathwayDescription: "Send exercise program, PROMs at 2 weeks, rebooking nudge at 30 days",
    },
    {
      name: "Continue Treatment",
      pathwayDescription: "Send summary and rebooking nudge in 7 days if no appointment booked",
    },
    {
      name: "Discharge Complete",
      pathwayDescription: "Send discharge summary and outcome measures at 2 weeks",
    },
  ];

  for (const tpl of postTemplates) {
    const [existing] = await db
      .select({ id: workflowTemplatesT.id })
      .from(workflowTemplatesT)
      .where(
        and(
          eq(workflowTemplatesT.orgId, orgId),
          eq(workflowTemplatesT.name, tpl.name),
          eq(workflowTemplatesT.direction, "post_appointment")
        )
      )
      .limit(1);

    if (existing) continue;

    const [template] = await db
      .insert(workflowTemplatesT)
      .values({
        orgId,
        name: tpl.name,
        direction: "post_appointment",
        status: "published",
      })
      .returning({ id: workflowTemplatesT.id });

    if (!template) continue;

    const blocks = getPostActionBlocks(tpl.name, template.id, satisfactionFormId, k10FormId);
    if (blocks.length > 0) {
      await db.insert(workflowActionBlocks).values(blocks);
    }

    // Create or update outcome pathway
    const [existingPathway] = await db
      .select({ id: outcomePathwaysT.id })
      .from(outcomePathwaysT)
      .where(and(eq(outcomePathwaysT.orgId, orgId), eq(outcomePathwaysT.name, tpl.name)))
      .limit(1);

    if (existingPathway) {
      await db
        .update(outcomePathwaysT)
        .set({ workflowTemplateId: template.id })
        .where(eq(outcomePathwaysT.id, existingPathway.id));
    } else {
      await db.insert(outcomePathwaysT).values({
        orgId,
        name: tpl.name,
        description: tpl.pathwayDescription,
        workflowTemplateId: template.id,
      });
    }
  }
}

/**
 * Seed pre-appointment action blocks using the intake-package model.
 *
 * For each template we emit:
 *   - One `intake_package` block (when the template captures forms/card/consent)
 *   - One `intake_reminder` per legacy form-completion nudge, parented to the
 *     intake_package block
 *   - `send_reminder` blocks for ordinary appointment reminders (no precondition)
 *   - One `add_to_runsheet` block per template (since all pre-templates are
 *     run_sheet terminal_type at seed time)
 *
 * The intake_package block is inserted first so its id can be referenced by
 * the intake_reminder children via `parent_action_block_id`.
 */
async function seedPreActionBlocks(
  templateName: string,
  templateId: string,
  intakeFormId: string | null
): Promise<void> {
  // Per-template spec: what the intake package contains + which reminders
  // nudge form completion + which reminders are plain appointment reminders.
  const plan = getPreTemplatePlan(templateName, intakeFormId);

  let intakePackageId: string | null = null;

  if (plan.intakePackage) {
    try {
      const [packageRow] = await db
        .insert(workflowActionBlocks)
        .values({
          templateId,
          actionType: "intake_package",
          offsetMinutes: 0,
          offsetDirection: "before",
          config: {
            includes_card_capture: plan.intakePackage.includes_card_capture,
            includes_consent: plan.intakePackage.includes_consent,
            form_ids: plan.intakePackage.form_ids,
          },
          sortOrder: 0,
        })
        .returning({ id: workflowActionBlocks.id });
      intakePackageId = packageRow?.id ?? null;
    } catch (error) {
      console.error(
        `[WORKFLOW SEED] Failed to insert intake_package block for template '${templateName}':`,
        error
      );
      return;
    }
  }

  // Children and siblings: intake_reminder, send_reminder, add_to_runsheet
  const children: Array<typeof workflowActionBlocks.$inferInsert> = [];

  for (const [i, reminder] of plan.intakeReminders.entries()) {
    if (!intakePackageId) continue;
    children.push({
      templateId,
      actionType: "intake_reminder",
      offsetMinutes: reminder.offset_days * 24 * 60,
      offsetDirection: "after",
      config: {
        offset_days: reminder.offset_days,
        message_body: reminder.message_body,
      },
      parentActionBlockId: intakePackageId,
      sortOrder: 10 + i,
    });
  }

  for (const [i, reminder] of plan.appointmentReminders.entries()) {
    children.push({
      templateId,
      actionType: "send_reminder",
      offsetMinutes: reminder.offset_minutes,
      offsetDirection: "before",
      config: { message: reminder.message },
      sortOrder: 50 + i,
    });
  }

  // Every pre-appointment run-sheet workflow needs an add_to_runsheet block.
  children.push({
    templateId,
    actionType: "add_to_runsheet",
    offsetMinutes: 0,
    offsetDirection: "before",
    config: {},
    sortOrder: 100,
  });

  if (children.length > 0) {
    try {
      await db.insert(workflowActionBlocks).values(children);
    } catch (error) {
      console.error(
        `[WORKFLOW SEED] Failed to insert child blocks for template '${templateName}':`,
        error
      );
    }
  }
}

interface IntakePackageSpec {
  includes_card_capture: boolean;
  includes_consent: boolean;
  form_ids: string[];
}

interface IntakeReminderSpec {
  offset_days: number;
  message_body: string;
}

interface AppointmentReminderSpec {
  offset_minutes: number;
  message: string;
}

interface PreTemplatePlan {
  intakePackage: IntakePackageSpec | null;
  intakeReminders: IntakeReminderSpec[];
  appointmentReminders: AppointmentReminderSpec[];
}

function getPreTemplatePlan(
  templateName: string,
  intakeFormId: string | null
): PreTemplatePlan {
  switch (templateName) {
    case "Standard New Patient Intake":
      // Legacy shape: deliver_form @ 14d, send_reminder(form_not_completed) @ 3d,
      // capture_card @ 2d, send_reminder @ 1d.
      // New shape: intake_package fires on workflow start, one intake_reminder
      // 11 days later (14d - 3d), plain appointment reminder at 1d before.
      return {
        intakePackage: {
          includes_card_capture: true,
          includes_consent: false,
          form_ids: intakeFormId ? [intakeFormId] : [],
        },
        intakeReminders: [
          {
            offset_days: 11,
            message_body:
              "Hi {patient_first_name}, just a reminder to finish your intake before your appointment with {clinic_name}. Tap here to continue: {link}",
          },
        ],
        appointmentReminders: [
          {
            offset_minutes: 1440,
            message:
              "Hi {first_name}, your appointment with {clinician_name} at {clinic_name} is tomorrow at {appointment_time}. See you then!",
          },
        ],
      };

    case "Returning Patient Quick Check":
      // Legacy: send_reminder @ 2d, capture_card @ 1d.
      // New shape: intake_package (card only, no forms), plain 2d reminder.
      return {
        intakePackage: {
          includes_card_capture: true,
          includes_consent: false,
          form_ids: [],
        },
        intakeReminders: [],
        appointmentReminders: [
          {
            offset_minutes: 2880,
            message:
              "Hi {first_name}, just a reminder about your appointment with {clinic_name} in 2 days at {appointment_time}.",
          },
        ],
      };

    case "Telehealth-specific Setup":
      // Legacy: verify_contact @ 7d, send_reminder @ 1d.
      // New shape: no intake package work (no form, no card). Ordinary 1d
      // appointment reminder only. verify_contact drops out — contact
      // verification happens inside the intake journey or entry flow.
      return {
        intakePackage: null,
        intakeReminders: [],
        appointmentReminders: [
          {
            offset_minutes: 1440,
            message:
              "Hi {first_name}, your telehealth appointment with {clinician_name} is tomorrow at {appointment_time}. Make sure you're in a quiet spot with good internet.",
          },
        ],
      };

    case "Minimal Reminder Only":
      return {
        intakePackage: null,
        intakeReminders: [],
        appointmentReminders: [
          {
            offset_minutes: 1440,
            message:
              "Hi {first_name}, quick reminder about your check-in with {clinic_name} tomorrow at {appointment_time}.",
          },
        ],
      };

    default:
      return {
        intakePackage: null,
        intakeReminders: [],
        appointmentReminders: [],
      };
  }
}

function getPostActionBlocks(
  templateName: string,
  templateId: string,
  satisfactionFormId: string | null,
  k10FormId: string | null
): Array<typeof workflowActionBlocks.$inferInsert> {
  switch (templateName) {
    case "Discharge with Home Exercises":
      return [
        { templateId, actionType: "send_sms", offsetMinutes: 0, offsetDirection: "after", config: { message: "Hi {first_name}, thanks for your appointment today with {clinician_name}. We'll send your exercise program shortly." }, precondition: null, sortOrder: 0 },
        { templateId, actionType: "send_file", offsetMinutes: 1440, offsetDirection: "after", config: { message: "Hi {first_name}, here's your home exercise program as discussed." }, precondition: null, sortOrder: 1 },
        { templateId, actionType: "deliver_form", offsetMinutes: 20160, offsetDirection: "after", formId: satisfactionFormId, config: {}, precondition: null, sortOrder: 2 },
        { templateId, actionType: "send_rebooking_nudge", offsetMinutes: 43200, offsetDirection: "after", config: { message: "Hi {first_name}, it's been a month since your last appointment with {clinic_name}. Would you like to book a follow-up?" }, precondition: { type: "no_future_appointment" }, sortOrder: 3 },
      ];
    case "Continue Treatment":
      return [
        { templateId, actionType: "send_sms", offsetMinutes: 0, offsetDirection: "after", config: { message: "Hi {first_name}, thanks for your appointment today. We'll be in touch about your next visit." }, precondition: null, sortOrder: 0 },
        { templateId, actionType: "send_rebooking_nudge", offsetMinutes: 10080, offsetDirection: "after", config: { message: "Hi {first_name}, time to book your next appointment with {clinic_name}." }, precondition: { type: "no_future_appointment" }, sortOrder: 1 },
      ];
    case "Discharge Complete":
      return [
        { templateId, actionType: "send_sms", offsetMinutes: 0, offsetDirection: "after", config: { message: "Hi {first_name}, your treatment with {clinic_name} is now complete. If you need anything in the future, don't hesitate to get in touch." }, precondition: null, sortOrder: 0 },
        { templateId, actionType: "deliver_form", offsetMinutes: 20160, offsetDirection: "after", formId: k10FormId, config: {}, precondition: null, sortOrder: 1 },
      ];
    default:
      return [];
  }
}
