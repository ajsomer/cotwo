import { createServiceClient } from "@/lib/supabase/service";

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
  const supabase = createServiceClient();

  // Look up existing published forms by name
  const { data: orgForms } = await supabase
    .from("forms")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("status", "published");

  const formByName = new Map((orgForms ?? []).map((f) => [f.name, f.id]));
  const intakeFormId = formByName.get("New Patient Intake") ?? null;
  const k10FormId = formByName.get("Mental Health Assessment (K10)") ?? null;
  const satisfactionFormId = formByName.get("Patient Satisfaction Survey") ?? null;

  // Look up existing appointment types
  const { data: types } = await supabase
    .from("appointment_types")
    .select("id, name")
    .eq("org_id", orgId);

  const typeByName = new Map((types ?? []).map((t) => [t.name, t.id]));

  // --- Pre-appointment workflow templates ---

  const preTemplates = [
    { name: "Standard New Patient Intake", typeNames: ["Initial Consultation"] },
    { name: "Returning Patient Quick Check", typeNames: ["Follow-up Consultation", "Review Appointment"] },
    { name: "Telehealth-specific Setup", typeNames: ["Telehealth Consultation"] },
    { name: "Minimal Reminder Only", typeNames: ["Brief Check-in"] },
  ];

  for (const tpl of preTemplates) {
    // Check if template already exists
    const { data: existing } = await supabase
      .from("workflow_templates")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", tpl.name)
      .eq("direction", "pre_appointment")
      .maybeSingle();

    if (existing) continue; // Already seeded

    const { data: template } = await supabase
      .from("workflow_templates")
      .insert({
        org_id: orgId,
        name: tpl.name,
        direction: "pre_appointment",
        status: "published",
        terminal_type: "run_sheet",
      })
      .select("id")
      .single();

    if (!template) continue;

    // Create action blocks based on template name.
    await seedPreActionBlocks(supabase, tpl.name, template.id, intakeFormId);

    // Link to matching appointment types
    for (const typeName of tpl.typeNames) {
      const typeId = typeByName.get(typeName);
      if (!typeId) continue;

      // Check if link already exists
      const { data: existingLink } = await supabase
        .from("type_workflow_links")
        .select("id")
        .eq("appointment_type_id", typeId)
        .eq("direction", "pre_appointment")
        .maybeSingle();

      if (!existingLink) {
        await supabase.from("type_workflow_links").insert({
          appointment_type_id: typeId,
          workflow_template_id: template.id,
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
    const { data: existing } = await supabase
      .from("workflow_templates")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", tpl.name)
      .eq("direction", "post_appointment")
      .maybeSingle();

    if (existing) continue;

    const { data: template } = await supabase
      .from("workflow_templates")
      .insert({
        org_id: orgId,
        name: tpl.name,
        direction: "post_appointment",
        status: "published",
      })
      .select("id")
      .single();

    if (!template) continue;

    const blocks = getPostActionBlocks(tpl.name, template.id, satisfactionFormId, k10FormId);
    if (blocks.length > 0) {
      await supabase.from("workflow_action_blocks").insert(blocks);
    }

    // Create or update outcome pathway
    const { data: existingPathway } = await supabase
      .from("outcome_pathways")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", tpl.name)
      .maybeSingle();

    if (existingPathway) {
      await supabase
        .from("outcome_pathways")
        .update({ workflow_template_id: template.id })
        .eq("id", existingPathway.id);
    } else {
      await supabase.from("outcome_pathways").insert({
        org_id: orgId,
        name: tpl.name,
        description: tpl.pathwayDescription,
        workflow_template_id: template.id,
      });
    }
  }

  console.log(`[WORKFLOW SEED] Default workflows seeded for org ${orgId}`);
}

type SupabaseClient = ReturnType<typeof createServiceClient>;

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
  supabase: SupabaseClient,
  templateName: string,
  templateId: string,
  intakeFormId: string | null
): Promise<void> {
  // Per-template spec: what the intake package contains + which reminders
  // nudge form completion + which reminders are plain appointment reminders.
  const plan = getPreTemplatePlan(templateName, intakeFormId);

  let intakePackageId: string | null = null;

  if (plan.intakePackage) {
    const { data: packageRow, error } = await supabase
      .from("workflow_action_blocks")
      .insert({
        template_id: templateId,
        action_type: "intake_package",
        offset_minutes: 0,
        offset_direction: "before",
        config: {
          includes_card_capture: plan.intakePackage.includes_card_capture,
          includes_consent: plan.intakePackage.includes_consent,
          form_ids: plan.intakePackage.form_ids,
        },
        sort_order: 0,
      })
      .select("id")
      .single();

    if (error) {
      console.error(
        `[WORKFLOW SEED] Failed to insert intake_package block for template '${templateName}':`,
        error
      );
      return;
    }
    intakePackageId = packageRow?.id ?? null;
  }

  // Children and siblings: intake_reminder, send_reminder, add_to_runsheet
  const children: Array<Record<string, unknown>> = [];

  for (const [i, reminder] of plan.intakeReminders.entries()) {
    if (!intakePackageId) continue;
    children.push({
      template_id: templateId,
      action_type: "intake_reminder",
      offset_minutes: reminder.offset_days * 24 * 60,
      offset_direction: "after",
      config: {
        offset_days: reminder.offset_days,
        message_body: reminder.message_body,
      },
      parent_action_block_id: intakePackageId,
      sort_order: 10 + i,
    });
  }

  for (const [i, reminder] of plan.appointmentReminders.entries()) {
    children.push({
      template_id: templateId,
      action_type: "send_reminder",
      offset_minutes: reminder.offset_minutes,
      offset_direction: "before",
      config: { message: reminder.message },
      sort_order: 50 + i,
    });
  }

  // Every pre-appointment run-sheet workflow needs an add_to_runsheet block.
  children.push({
    template_id: templateId,
    action_type: "add_to_runsheet",
    offset_minutes: 0,
    offset_direction: "before",
    config: {},
    sort_order: 100,
  });

  if (children.length > 0) {
    const { error } = await supabase
      .from("workflow_action_blocks")
      .insert(children);
    if (error) {
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
) {
  switch (templateName) {
    case "Discharge with Home Exercises":
      return [
        { template_id: templateId, action_type: "send_sms", offset_minutes: 0, offset_direction: "after", config: { message: "Hi {first_name}, thanks for your appointment today with {clinician_name}. We'll send your exercise program shortly." }, precondition: null, sort_order: 0 },
        { template_id: templateId, action_type: "send_file", offset_minutes: 1440, offset_direction: "after", config: { message: "Hi {first_name}, here's your home exercise program as discussed." }, precondition: null, sort_order: 1 },
        { template_id: templateId, action_type: "deliver_form", offset_minutes: 20160, offset_direction: "after", form_id: satisfactionFormId, config: {}, precondition: null, sort_order: 2 },
        { template_id: templateId, action_type: "send_rebooking_nudge", offset_minutes: 43200, offset_direction: "after", config: { message: "Hi {first_name}, it's been a month since your last appointment with {clinic_name}. Would you like to book a follow-up?" }, precondition: { type: "no_future_appointment" }, sort_order: 3 },
      ];
    case "Continue Treatment":
      return [
        { template_id: templateId, action_type: "send_sms", offset_minutes: 0, offset_direction: "after", config: { message: "Hi {first_name}, thanks for your appointment today. We'll be in touch about your next visit." }, precondition: null, sort_order: 0 },
        { template_id: templateId, action_type: "send_rebooking_nudge", offset_minutes: 10080, offset_direction: "after", config: { message: "Hi {first_name}, time to book your next appointment with {clinic_name}." }, precondition: { type: "no_future_appointment" }, sort_order: 1 },
      ];
    case "Discharge Complete":
      return [
        { template_id: templateId, action_type: "send_sms", offset_minutes: 0, offset_direction: "after", config: { message: "Hi {first_name}, your treatment with {clinic_name} is now complete. If you need anything in the future, don't hesitate to get in touch." }, precondition: null, sort_order: 0 },
        { template_id: templateId, action_type: "deliver_form", offset_minutes: 20160, offset_direction: "after", form_id: k10FormId, config: {}, precondition: null, sort_order: 1 },
      ];
    default:
      return [];
  }
}
