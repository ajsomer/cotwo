import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  outcomePathways,
  workflowTemplates,
  workflowActionBlocks,
} from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  requireStaffOrgAccess,
  requireStaffCanAccessOutcomePathway,
} from "@/lib/auth/staff-access";

const pathwayColumns = {
  id: outcomePathways.id,
  org_id: outcomePathways.orgId,
  name: outcomePathways.name,
  description: outcomePathways.description,
  workflow_template_id: outcomePathways.workflowTemplateId,
  archived_at: outcomePathways.archivedAt,
  created_at: outcomePathways.createdAt,
  updated_at: outcomePathways.updatedAt,
};

const templateColumns = {
  id: workflowTemplates.id,
  org_id: workflowTemplates.orgId,
  name: workflowTemplates.name,
  description: workflowTemplates.description,
  direction: workflowTemplates.direction,
  status: workflowTemplates.status,
  terminal_type: workflowTemplates.terminalType,
  at_risk_after_days: workflowTemplates.atRiskAfterDays,
  overdue_after_days: workflowTemplates.overdueAfterDays,
  created_at: workflowTemplates.createdAt,
  updated_at: workflowTemplates.updatedAt,
};

const blockColumns = {
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

// GET /api/outcome-pathways?org_id=xxx
// Returns outcome pathways with their linked workflow template and action blocks
// in a single response to avoid a second round trip.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const access = await requireStaffOrgAccess(orgId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    const includeArchived = request.nextUrl.searchParams.get("include_archived") === "true";

    const pathways = await db
      .select(pathwayColumns)
      .from(outcomePathways)
      .where(
        includeArchived
          ? eq(outcomePathways.orgId, orgId)
          : and(eq(outcomePathways.orgId, orgId), isNull(outcomePathways.archivedAt)),
      )
      .orderBy(asc(outcomePathways.name));

    // Fetch linked workflow templates and their action blocks
    const templateIds = (pathways ?? [])
      .map((p) => p.workflow_template_id)
      .filter(Boolean) as string[];

    const templates: Record<string, unknown> = {};
    const blocksByTemplate: Record<string, unknown[]> = {};

    if (templateIds.length > 0) {
      const templateData = await db
        .select(templateColumns)
        .from(workflowTemplates)
        .where(inArray(workflowTemplates.id, templateIds));

      for (const t of templateData ?? []) {
        templates[t.id] = t;
      }

      const blocks = await db
        .select(blockColumns)
        .from(workflowActionBlocks)
        .where(inArray(workflowActionBlocks.templateId, templateIds))
        .orderBy(asc(workflowActionBlocks.sortOrder));

      for (const b of blocks ?? []) {
        if (!blocksByTemplate[b.template_id]) {
          blocksByTemplate[b.template_id] = [];
        }
        blocksByTemplate[b.template_id].push(b);
      }
    }

    // Assemble response: each pathway includes its template and blocks
    const result = (pathways ?? []).map((p) => ({
      ...p,
      template: p.workflow_template_id
        ? templates[p.workflow_template_id] ?? null
        : null,
      blocks: p.workflow_template_id
        ? blocksByTemplate[p.workflow_template_id] ?? []
        : [],
      action_count: p.workflow_template_id
        ? (blocksByTemplate[p.workflow_template_id] ?? []).length
        : 0,
    }));

    return NextResponse.json({ outcome_pathways: result });
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/outcome-pathways
// Creates a new outcome pathway, optionally with a linked post-appointment
// workflow template.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_id, name, description, create_workflow } = body;

    if (!org_id || !name) {
      return NextResponse.json(
        { error: "org_id and name required" },
        { status: 400 }
      );
    }

    const access = await requireStaffOrgAccess(org_id);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status }
      );
    }

    let workflowTemplateId: string | null = null;

    // Optionally create a linked workflow template
    if (create_workflow) {
      try {
        const [template] = await db
          .insert(workflowTemplates)
          .values({
            orgId: org_id,
            name: `Post-workflow: ${name}`,
            direction: "post_appointment",
            status: "draft",
          })
          .returning({ id: workflowTemplates.id });
        workflowTemplateId = template.id;
      } catch (templateError) {
        return NextResponse.json(
          { error: (templateError as Error).message },
          { status: 500 }
        );
      }
    }

    let pathway;
    try {
      [pathway] = await db
        .insert(outcomePathways)
        .values({
          orgId: org_id,
          name,
          description: description ?? null,
          workflowTemplateId,
        })
        .returning(pathwayColumns);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    return NextResponse.json(
      {
        outcome_pathway: {
          ...pathway,
          template: null,
          blocks: [],
          action_count: 0,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/outcome-pathways
// Updates an outcome pathway's metadata (name, description).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const access = await requireStaffCanAccessOutcomePathway(id);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status }
      );
    }

    const updates: Partial<typeof outcomePathways.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (body.archived_at !== undefined) updates.archivedAt = body.archived_at;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updateable fields provided" },
        { status: 400 }
      );
    }

    await db.update(outcomePathways).set(updates).where(eq(outcomePathways.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/outcome-pathways?id=xxx
// Soft-deletes an outcome pathway by setting archived_at.
// Existing in-flight workflow runs continue; pathway is hidden from Process picker.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const access = await requireStaffCanAccessOutcomePathway(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    await db
      .update(outcomePathways)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(outcomePathways.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[OUTCOME-PATHWAYS] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
