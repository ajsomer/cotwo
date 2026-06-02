import { cache } from "react";
import { db } from "@/lib/db";
import {
  appointmentTypes as appointmentTypesT,
  workflowTemplates as workflowTemplatesT,
  outcomePathways as outcomePathwaysT,
  typeWorkflowLinks,
  workflowActionBlocks,
  appointmentWorkflowRuns,
} from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
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

const appointmentTypeCols = {
  id: appointmentTypesT.id,
  org_id: appointmentTypesT.orgId,
  name: appointmentTypesT.name,
  modality: appointmentTypesT.modality,
  duration_minutes: appointmentTypesT.durationMinutes,
  default_fee_cents: appointmentTypesT.defaultFeeCents,
  pms_external_id: appointmentTypesT.pmsExternalId,
  source: appointmentTypesT.source,
  pms_provider: appointmentTypesT.pmsProvider,
  created_at: appointmentTypesT.createdAt,
  updated_at: appointmentTypesT.updatedAt,
};

const templateCols = {
  id: workflowTemplatesT.id,
  org_id: workflowTemplatesT.orgId,
  name: workflowTemplatesT.name,
  description: workflowTemplatesT.description,
  direction: workflowTemplatesT.direction,
  status: workflowTemplatesT.status,
  terminal_type: workflowTemplatesT.terminalType,
  at_risk_after_days: workflowTemplatesT.atRiskAfterDays,
  overdue_after_days: workflowTemplatesT.overdueAfterDays,
  created_at: workflowTemplatesT.createdAt,
  updated_at: workflowTemplatesT.updatedAt,
};

const pathwayCols = {
  id: outcomePathwaysT.id,
  org_id: outcomePathwaysT.orgId,
  name: outcomePathwaysT.name,
  description: outcomePathwaysT.description,
  workflow_template_id: outcomePathwaysT.workflowTemplateId,
  archived_at: outcomePathwaysT.archivedAt,
  created_at: outcomePathwaysT.createdAt,
  updated_at: outcomePathwaysT.updatedAt,
};

const blockCols = {
  id: workflowActionBlocks.id,
  template_id: workflowActionBlocks.templateId,
  action_type: workflowActionBlocks.actionType,
  offset_minutes: workflowActionBlocks.offsetMinutes,
  offset_direction: workflowActionBlocks.offsetDirection,
  modality_filter: workflowActionBlocks.modalityFilter,
  form_id: workflowActionBlocks.formId,
  config: workflowActionBlocks.config,
  sort_order: workflowActionBlocks.sortOrder,
  precondition: workflowActionBlocks.precondition,
  parent_action_block_id: workflowActionBlocks.parentActionBlockId,
  created_at: workflowActionBlocks.createdAt,
  updated_at: workflowActionBlocks.updatedAt,
};

export const fetchWorkflowsInit = cache(async (orgId: string): Promise<WorkflowsInitData> => {
  // Phase 1: the org-scoped roots. Templates give us the bounded set of
  // template IDs the dependent queries below scope to, so blocks/runs/links
  // never scan the whole platform's data.
  const [types, allTemplates, pathwaysData] = await Promise.all([
    db.select(appointmentTypeCols).from(appointmentTypesT).where(eq(appointmentTypesT.orgId, orgId)).orderBy(asc(appointmentTypesT.name)),
    db.select(templateCols).from(workflowTemplatesT).where(eq(workflowTemplatesT.orgId, orgId)),
    db.select(pathwayCols).from(outcomePathwaysT).where(eq(outcomePathwaysT.orgId, orgId)).orderBy(asc(outcomePathwaysT.name)),
  ]);

  const typeIds = types.map((t) => t.id);
  const orgTemplateIds = allTemplates.map((t) => t.id);

  // Phase 2: dependents, all scoped to this org's types/templates.
  const [links, allBlocks, runs] = await Promise.all([
    typeIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            appointment_type_id: typeWorkflowLinks.appointmentTypeId,
            workflow_template_id: typeWorkflowLinks.workflowTemplateId,
          })
          .from(typeWorkflowLinks)
          .where(
            and(
              eq(typeWorkflowLinks.direction, "pre_appointment"),
              inArray(typeWorkflowLinks.appointmentTypeId, typeIds)
            )
          ),
    orgTemplateIds.length === 0
      ? Promise.resolve([])
      : db
          .select(blockCols)
          .from(workflowActionBlocks)
          .where(inArray(workflowActionBlocks.templateId, orgTemplateIds))
          .orderBy(asc(workflowActionBlocks.sortOrder)),
    orgTemplateIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ workflow_template_id: appointmentWorkflowRuns.workflowTemplateId })
          .from(appointmentWorkflowRuns)
          .where(
            and(
              eq(appointmentWorkflowRuns.status, "active"),
              inArray(appointmentWorkflowRuns.workflowTemplateId, orgTemplateIds)
            )
          ),
  ]);

  // --- Pre-appointment ---
  const typeIdSet = new Set(typeIds);
  const filteredLinks = links.filter((l) => typeIdSet.has(l.appointment_type_id));
  const linkByType = new Map(filteredLinks.map((l) => [l.appointment_type_id, l.workflow_template_id]));
  const preTemplateIds = new Set(filteredLinks.map((l) => l.workflow_template_id));

  const preWorkflowTemplates: Record<string, DbWorkflowTemplate> = {};
  const preWorkflowBlocks: Record<string, DbWorkflowActionBlock[]> = {};
  for (const t of allTemplates) {
    if (preTemplateIds.has(t.id)) preWorkflowTemplates[t.id] = t as DbWorkflowTemplate;
  }
  for (const b of allBlocks) {
    if (preTemplateIds.has(b.template_id)) {
      if (!preWorkflowBlocks[b.template_id]) preWorkflowBlocks[b.template_id] = [];
      preWorkflowBlocks[b.template_id].push(b as DbWorkflowActionBlock);
    }
  }

  const inFlightCounts: Record<string, number> = {};
  for (const r of runs) {
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
  const postTemplateIds = new Set(
    pathwaysData.map((p) => p.workflow_template_id).filter(Boolean) as string[]
  );

  const postWorkflowTemplates: Record<string, DbWorkflowTemplate> = {};
  const postWorkflowBlocks: Record<string, DbWorkflowActionBlock[]> = {};
  for (const t of allTemplates) {
    if (postTemplateIds.has(t.id)) postWorkflowTemplates[t.id] = t as DbWorkflowTemplate;
  }
  for (const b of allBlocks) {
    if (postTemplateIds.has(b.template_id)) {
      if (!postWorkflowBlocks[b.template_id]) postWorkflowBlocks[b.template_id] = [];
      postWorkflowBlocks[b.template_id].push(b as DbWorkflowActionBlock);
    }
  }

  const outcomePathways: OutcomePathwayRow[] = pathwaysData.map((p) => {
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
