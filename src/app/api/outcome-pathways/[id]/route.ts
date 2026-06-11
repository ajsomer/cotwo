import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { outcomePathways, workflowActionBlocks } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireStaffCanAccessOutcomePathway } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

// GET /api/outcome-pathways/[id]
// Returns a pathway's name/description + its workflow action blocks, for the
// editor. (Moved server-side from the browser when the data layer became a
// direct pg connection — the browser can no longer query the DB directly.)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireStaffCanAccessOutcomePathway(id);
  if (!access.ok) {
    return denyResponse(access);
  }

  const [pathway] = await db
    .select({
      name: outcomePathways.name,
      description: outcomePathways.description,
      workflow_template_id: outcomePathways.workflowTemplateId,
    })
    .from(outcomePathways)
    .where(eq(outcomePathways.id, id))
    .limit(1);

  if (!pathway) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let blocks: Array<{
    id: string;
    action_type: string;
    offset_minutes: number;
    offset_direction: string;
    form_id: string | null;
    config: unknown;
    sort_order: number;
  }> = [];

  if (pathway.workflow_template_id) {
    blocks = await db
      .select({
        id: workflowActionBlocks.id,
        action_type: workflowActionBlocks.actionType,
        offset_minutes: workflowActionBlocks.offsetMinutes,
        offset_direction: workflowActionBlocks.offsetDirection,
        form_id: workflowActionBlocks.formId,
        config: workflowActionBlocks.config,
        sort_order: workflowActionBlocks.sortOrder,
      })
      .from(workflowActionBlocks)
      .where(eq(workflowActionBlocks.templateId, pathway.workflow_template_id))
      .orderBy(asc(workflowActionBlocks.sortOrder));
  }

  return NextResponse.json({ pathway, blocks });
}
