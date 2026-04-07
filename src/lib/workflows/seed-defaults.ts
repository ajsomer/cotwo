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
      })
      .select("id")
      .single();

    if (!template) continue;

    // Create action blocks based on template name
    const blocks = getPreActionBlocks(tpl.name, template.id, intakeFormId);
    if (blocks.length > 0) {
      await supabase.from("workflow_action_blocks").insert(blocks);
    }

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

function getPreActionBlocks(
  templateName: string,
  templateId: string,
  intakeFormId: string | null
) {
  switch (templateName) {
    case "Standard New Patient Intake":
      return [
        { template_id: templateId, action_type: "deliver_form", offset_minutes: 20160, offset_direction: "before", form_id: intakeFormId, config: {}, precondition: null, sort_order: 0 },
        { template_id: templateId, action_type: "send_reminder", offset_minutes: 4320, offset_direction: "before", config: { message: "Hi {first_name}, just a reminder you have an appointment with {clinic_name} in 3 days. Please complete your intake form if you haven't already." }, precondition: intakeFormId ? { type: "form_not_completed", form_id: intakeFormId } : null, sort_order: 1 },
        { template_id: templateId, action_type: "capture_card", offset_minutes: 2880, offset_direction: "before", config: {}, precondition: { type: "card_not_on_file" }, sort_order: 2 },
        { template_id: templateId, action_type: "send_reminder", offset_minutes: 1440, offset_direction: "before", config: { message: "Hi {first_name}, your appointment with {clinician_name} at {clinic_name} is tomorrow at {appointment_time}. See you then!" }, precondition: null, sort_order: 3 },
      ];
    case "Returning Patient Quick Check":
      return [
        { template_id: templateId, action_type: "send_reminder", offset_minutes: 2880, offset_direction: "before", config: { message: "Hi {first_name}, just a reminder about your appointment with {clinic_name} in 2 days at {appointment_time}." }, precondition: null, sort_order: 0 },
        { template_id: templateId, action_type: "capture_card", offset_minutes: 1440, offset_direction: "before", config: {}, precondition: { type: "card_not_on_file" }, sort_order: 1 },
      ];
    case "Telehealth-specific Setup":
      return [
        { template_id: templateId, action_type: "verify_contact", offset_minutes: 10080, offset_direction: "before", config: {}, precondition: { type: "contact_not_verified" }, sort_order: 0 },
        { template_id: templateId, action_type: "send_reminder", offset_minutes: 1440, offset_direction: "before", config: { message: "Hi {first_name}, your telehealth appointment with {clinician_name} is tomorrow at {appointment_time}. Make sure you're in a quiet spot with good internet." }, precondition: null, sort_order: 1 },
      ];
    case "Minimal Reminder Only":
      return [
        { template_id: templateId, action_type: "send_reminder", offset_minutes: 1440, offset_direction: "before", config: { message: "Hi {first_name}, quick reminder about your check-in with {clinic_name} tomorrow at {appointment_time}." }, precondition: null, sort_order: 0 },
      ];
    default:
      return [];
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
