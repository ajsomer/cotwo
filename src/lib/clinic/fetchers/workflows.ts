import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  AppointmentTypeRow,
  OutcomePathwayRow,
} from "@/stores/clinic-store";
import type {
  DbWorkflowTemplate,
  DbWorkflowActionBlock,
} from "@/lib/workflows/types";

export interface WorkflowsInitData {
  appointmentTypes: AppointmentTypeRow[];
  outcomePathways: OutcomePathwayRow[];
  preWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  preWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  postWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  postWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
}

export const fetchWorkflowsInit = cache(async (orgId: string): Promise<WorkflowsInitData> => {
  const supabase = createServiceClient();

  const [
    typesRes,
    linksRes,
    allBlocksRes,
    allTemplatesRes,
    runsRes,
    pathwaysRes,
  ] = await Promise.all([
    supabase.from("appointment_types").select("*").eq("org_id", orgId).order("name"),
    supabase.from("type_workflow_links").select("appointment_type_id, workflow_template_id").eq("direction", "pre_appointment"),
    supabase.from("workflow_action_blocks").select("*").order("sort_order"),
    supabase.from("workflow_templates").select("*").eq("org_id", orgId),
    supabase.from("appointment_workflow_runs").select("workflow_template_id").eq("status", "active"),
    supabase.from("outcome_pathways").select("*").eq("org_id", orgId).order("name"),
  ]);

  // --- Pre-appointment ---
  const types = typesRes.data ?? [];
  const typeIds = new Set(types.map((t) => t.id));
  const links = (linksRes.data ?? []).filter((l) => typeIds.has(l.appointment_type_id));
  const linkByType = new Map(links.map((l) => [l.appointment_type_id, l.workflow_template_id]));
  const preTemplateIds = new Set(links.map((l) => l.workflow_template_id));

  const preWorkflowTemplates: Record<string, DbWorkflowTemplate> = {};
  const preWorkflowBlocks: Record<string, DbWorkflowActionBlock[]> = {};
  for (const t of allTemplatesRes.data ?? []) {
    if (preTemplateIds.has(t.id)) preWorkflowTemplates[t.id] = t as DbWorkflowTemplate;
  }
  for (const b of allBlocksRes.data ?? []) {
    if (preTemplateIds.has(b.template_id)) {
      if (!preWorkflowBlocks[b.template_id]) preWorkflowBlocks[b.template_id] = [];
      preWorkflowBlocks[b.template_id].push(b as DbWorkflowActionBlock);
    }
  }

  const inFlightCounts: Record<string, number> = {};
  for (const r of runsRes.data ?? []) {
    inFlightCounts[r.workflow_template_id] =
      (inFlightCounts[r.workflow_template_id] ?? 0) + 1;
  }

  const appointmentTypes: AppointmentTypeRow[] = types.map((t) => {
    const tid = linkByType.get(t.id) ?? null;
    const template = tid ? preWorkflowTemplates[tid] : null;
    return {
      ...t,
      pre_workflow_template_id: tid,
      terminal_type: (template?.terminal_type as AppointmentTypeRow["terminal_type"]) ?? null,
      action_count: tid ? (preWorkflowBlocks[tid] ?? []).length : 0,
      in_flight_count: tid ? (inFlightCounts[tid] ?? 0) : 0,
    } as AppointmentTypeRow;
  });

  // --- Post-appointment (via outcome pathways) ---
  const pathways = pathwaysRes.data ?? [];
  const postTemplateIds = new Set(
    pathways.map((p) => p.workflow_template_id).filter(Boolean) as string[]
  );

  const postWorkflowTemplates: Record<string, DbWorkflowTemplate> = {};
  const postWorkflowBlocks: Record<string, DbWorkflowActionBlock[]> = {};
  for (const t of allTemplatesRes.data ?? []) {
    if (postTemplateIds.has(t.id)) postWorkflowTemplates[t.id] = t as DbWorkflowTemplate;
  }
  for (const b of allBlocksRes.data ?? []) {
    if (postTemplateIds.has(b.template_id)) {
      if (!postWorkflowBlocks[b.template_id]) postWorkflowBlocks[b.template_id] = [];
      postWorkflowBlocks[b.template_id].push(b as DbWorkflowActionBlock);
    }
  }

  const outcomePathways: OutcomePathwayRow[] = pathways.map((p) => {
    const tid = p.workflow_template_id;
    const template = tid ? postWorkflowTemplates[tid] ?? null : null;
    const blocks = tid ? postWorkflowBlocks[tid] ?? [] : [];
    return {
      ...p,
      template,
      blocks,
      action_count: blocks.length,
      in_flight_count: tid ? (inFlightCounts[tid] ?? 0) : 0,
    } as OutcomePathwayRow;
  });

  return {
    appointmentTypes,
    outcomePathways,
    preWorkflowTemplates,
    preWorkflowBlocks,
    postWorkflowTemplates,
    postWorkflowBlocks,
  };
});
