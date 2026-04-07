import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { WorkflowsShell } from "@/components/clinic/workflows-shell";
import { redirect } from "next/navigation";

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const service = createServiceClient();

  // Resolve org
  const { data: assignment } = await service
    .from("staff_assignments")
    .select("locations!inner(org_id)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!assignment) redirect("/setup/clinic");

  const orgId = (assignment.locations as unknown as { org_id: string }).org_id;

  // Fetch sidebar data + forms in parallel
  const [typesRes, formsRes] = await Promise.all([
    service
      .from("appointment_types")
      .select("*")
      .eq("org_id", orgId)
      .order("name"),
    service
      .from("forms")
      .select("id, name, status")
      .eq("org_id", orgId)
      .eq("status", "published"),
  ]);

  const types = typesRes.data ?? [];
  const typeIds = types.map((t) => t.id);

  // Fetch workflow links + block counts + in-flight counts in parallel
  const { data: links } = await service
    .from("type_workflow_links")
    .select("appointment_type_id, workflow_template_id")
    .in("appointment_type_id", typeIds.length > 0 ? typeIds : ["__none__"])
    .eq("direction", "pre_appointment");

  const templateIds = (links ?? []).map((l) => l.workflow_template_id);
  const linkByType = new Map(
    (links ?? []).map((l) => [l.appointment_type_id, l.workflow_template_id])
  );

  let blockCounts: Record<string, number> = {};
  let inFlightCounts: Record<string, number> = {};

  if (templateIds.length > 0) {
    const [blocksRes, runsRes] = await Promise.all([
      service
        .from("workflow_action_blocks")
        .select("template_id")
        .in("template_id", templateIds),
      service
        .from("appointment_workflow_runs")
        .select("workflow_template_id")
        .in("workflow_template_id", templateIds)
        .eq("status", "active"),
    ]);

    for (const b of blocksRes.data ?? []) {
      blockCounts[b.template_id] = (blockCounts[b.template_id] || 0) + 1;
    }
    for (const r of runsRes.data ?? []) {
      inFlightCounts[r.workflow_template_id] =
        (inFlightCounts[r.workflow_template_id] || 0) + 1;
    }
  }

  const appointmentTypes = types.map((t) => {
    const templateId = linkByType.get(t.id) ?? null;
    return {
      ...t,
      pre_workflow_template_id: templateId,
      action_count: templateId ? blockCounts[templateId] ?? 0 : 0,
      in_flight_count: templateId ? inFlightCounts[templateId] ?? 0 : 0,
    };
  });

  // Fetch first item's detail if it has a workflow
  let initialTemplate = null;
  let initialBlocks: unknown[] = [];

  if (appointmentTypes.length > 0) {
    const first = appointmentTypes[0];
    if (first.pre_workflow_template_id) {
      const [templateRes, blocksRes] = await Promise.all([
        service
          .from("workflow_templates")
          .select("*")
          .eq("id", first.pre_workflow_template_id)
          .single(),
        service
          .from("workflow_action_blocks")
          .select("*")
          .eq("template_id", first.pre_workflow_template_id)
          .order("sort_order"),
      ]);
      initialTemplate = templateRes.data;
      initialBlocks = blocksRes.data ?? [];
    }
  }

  const forms = (formsRes.data ?? []).map((f) => ({ id: f.id, name: f.name }));

  return (
    <WorkflowsShell
      initialAppointmentTypes={appointmentTypes}
      initialForms={forms}
      initialTemplate={initialTemplate}
      initialBlocks={initialBlocks}
      orgId={orgId}
    />
  );
}
