import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointmentTypes,
  typeWorkflowLinks,
  workflowActionBlocks,
  appointmentWorkflowRuns,
} from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  requireStaffOrgAccess,
  requireStaffCanAccessAppointmentType,
} from "@/lib/auth/staff-access";

// GET /api/appointment-types?org_id=xxx
// Returns appointment types with pre-workflow template IDs, action counts,
// and in-flight counts in a single query batch.
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
    // Phase 1: this org's types, and (scoped to those types) their pre links.
    const types = await db
      .select({
        id: appointmentTypes.id,
        org_id: appointmentTypes.orgId,
        name: appointmentTypes.name,
        modality: appointmentTypes.modality,
        duration_minutes: appointmentTypes.durationMinutes,
        default_fee_cents: appointmentTypes.defaultFeeCents,
        pms_external_id: appointmentTypes.pmsExternalId,
        source: appointmentTypes.source,
        pms_provider: appointmentTypes.pmsProvider,
        created_at: appointmentTypes.createdAt,
        updated_at: appointmentTypes.updatedAt,
      })
      .from(appointmentTypes)
      .where(eq(appointmentTypes.orgId, orgId))
      .orderBy(asc(appointmentTypes.name));

    const typeIdList = types.map((t) => t.id);

    const links = typeIdList.length === 0 ? [] : await db
      .select({
        appointment_type_id: typeWorkflowLinks.appointmentTypeId,
        workflow_template_id: typeWorkflowLinks.workflowTemplateId,
      })
      .from(typeWorkflowLinks)
      .where(
        and(
          eq(typeWorkflowLinks.direction, "pre_appointment"),
          inArray(typeWorkflowLinks.appointmentTypeId, typeIdList),
        ),
      );

    const linkByType = new Map(links.map((l) => [l.appointment_type_id, l.workflow_template_id]));
    const templateIdList = [...new Set(links.map((l) => l.workflow_template_id))];

    // Phase 2: blocks + active runs, scoped to the derived template ids
    // instead of scanning every block/run on the platform.
    const [blocksRes, runsRes] = await Promise.all([
      templateIdList.length === 0 ? Promise.resolve([]) : db
        .select({ template_id: workflowActionBlocks.templateId })
        .from(workflowActionBlocks)
        .where(inArray(workflowActionBlocks.templateId, templateIdList)),
      templateIdList.length === 0 ? Promise.resolve([]) : db
        .select({ workflow_template_id: appointmentWorkflowRuns.workflowTemplateId })
        .from(appointmentWorkflowRuns)
        .where(
          and(
            eq(appointmentWorkflowRuns.status, "active"),
            inArray(appointmentWorkflowRuns.workflowTemplateId, templateIdList),
          ),
        ),
    ]);

    // Count blocks per template
    const blockCounts: Record<string, number> = {};
    for (const b of blocksRes ?? []) {
      blockCounts[b.template_id] = (blockCounts[b.template_id] || 0) + 1;
    }

    // Count in-flight runs per template
    const inFlightCounts: Record<string, number> = {};
    for (const r of runsRes ?? []) {
      inFlightCounts[r.workflow_template_id] =
        (inFlightCounts[r.workflow_template_id] || 0) + 1;
    }

    const result = types.map((t) => {
      const templateId = linkByType.get(t.id) ?? null;
      return {
        ...t,
        pre_workflow_template_id: templateId,
        action_count: templateId ? blockCounts[templateId] ?? 0 : 0,
        in_flight_count: templateId ? inFlightCounts[templateId] ?? 0 : 0,
      };
    });

    return NextResponse.json({ appointment_types: result });
  } catch (err) {
    console.error("[APPOINTMENT-TYPES] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/appointment-types
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_id, name, modality, duration_minutes, default_fee_cents } = body;

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

    const [data] = await db
      .insert(appointmentTypes)
      .values({
        orgId: org_id,
        name,
        modality: modality ?? "telehealth",
        durationMinutes: duration_minutes ?? 30,
        defaultFeeCents: default_fee_cents ?? 0,
        source: "coviu",
      })
      .returning({
        id: appointmentTypes.id,
        org_id: appointmentTypes.orgId,
        name: appointmentTypes.name,
        modality: appointmentTypes.modality,
        duration_minutes: appointmentTypes.durationMinutes,
        default_fee_cents: appointmentTypes.defaultFeeCents,
        pms_external_id: appointmentTypes.pmsExternalId,
        source: appointmentTypes.source,
        pms_provider: appointmentTypes.pmsProvider,
        created_at: appointmentTypes.createdAt,
        updated_at: appointmentTypes.updatedAt,
      });

    return NextResponse.json({ appointment_type: data }, { status: 201 });
  } catch (err) {
    console.error("[APPOINTMENT-TYPES] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/appointment-types
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, modality, duration_minutes, default_fee_cents } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const access = await requireStaffCanAccessAppointmentType(id);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Not found" },
        { status: access.status }
      );
    }

    const [existing] = await db
      .select({ source: appointmentTypes.source })
      .from(appointmentTypes)
      .where(eq(appointmentTypes.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Appointment type not found" },
        { status: 404 }
      );
    }

    const updates: Partial<typeof appointmentTypes.$inferInsert> = {};

    if (existing.source === "pms") {
      if (default_fee_cents !== undefined)
        updates.defaultFeeCents = default_fee_cents;
      if (modality !== undefined) updates.modality = modality;
    } else {
      if (name !== undefined) updates.name = name;
      if (duration_minutes !== undefined)
        updates.durationMinutes = duration_minutes;
      if (default_fee_cents !== undefined)
        updates.defaultFeeCents = default_fee_cents;
      if (modality !== undefined) updates.modality = modality;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updateable fields provided" },
        { status: 400 }
      );
    }

    await db.update(appointmentTypes).set(updates).where(eq(appointmentTypes.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[APPOINTMENT-TYPES] PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointment-types?id=xxx
// Cascade: type_workflow_links removed, workflow_templates NOT deleted,
// appointment_workflow_runs unaffected (reference appointments not types),
// appointments.appointment_type_id SET NULL.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const access = await requireStaffCanAccessAppointmentType(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    await db.delete(appointmentTypes).where(eq(appointmentTypes.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[APPOINTMENT-TYPES] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
