import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointmentTypes,
  typeWorkflowLinks,
  workflowTemplates,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireStaffCanAccessAppointmentType } from "@/lib/auth/staff-access";

// POST /api/appointment-types/[id]/workflow
// Creates a new pre-appointment workflow template for this appointment type
// and links them via type_workflow_links.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appointmentTypeId } = await params;

  const access = await requireStaffCanAccessAppointmentType(
    appointmentTypeId
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    // Verify the appointment type exists and get its org
    const [apptType] = await db
      .select({
        id: appointmentTypes.id,
        org_id: appointmentTypes.orgId,
        name: appointmentTypes.name,
      })
      .from(appointmentTypes)
      .where(eq(appointmentTypes.id, appointmentTypeId))
      .limit(1);

    if (!apptType) {
      return NextResponse.json(
        { error: "Appointment type not found" },
        { status: 404 }
      );
    }

    // Check if a pre-workflow already exists (the partial unique index
    // enforces this at DB level too, but a clear error is better)
    const [existingLink] = await db
      .select({ id: typeWorkflowLinks.id })
      .from(typeWorkflowLinks)
      .where(
        and(
          eq(typeWorkflowLinks.appointmentTypeId, appointmentTypeId),
          eq(typeWorkflowLinks.direction, "pre_appointment"),
        ),
      )
      .limit(1);

    if (existingLink) {
      return NextResponse.json(
        { error: "Appointment type already has a pre-appointment workflow" },
        { status: 409 }
      );
    }

    // Create the workflow template
    let template: {
      id: string;
      org_id: string;
      name: string;
      description: string | null;
      direction: string;
      status: string;
      terminal_type: string;
      at_risk_after_days: number | null;
      overdue_after_days: number | null;
      created_at: string;
      updated_at: string;
    };
    try {
      [template] = await db
        .insert(workflowTemplates)
        .values({
          orgId: apptType.org_id,
          name: `Pre-workflow: ${apptType.name}`,
          direction: "pre_appointment",
          status: "draft",
        })
        .returning({
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
        });
    } catch (templateError) {
      return NextResponse.json(
        { error: (templateError as Error).message },
        { status: 500 }
      );
    }

    // Create the junction link
    try {
      await db.insert(typeWorkflowLinks).values({
        appointmentTypeId,
        workflowTemplateId: template.id,
        direction: "pre_appointment",
      });
    } catch (linkError) {
      // Clean up the template if link creation fails
      await db.delete(workflowTemplates).where(eq(workflowTemplates.id, template.id));
      return NextResponse.json({ error: (linkError as Error).message }, { status: 500 });
    }

    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    console.error("[APPOINTMENT-TYPE-WORKFLOW] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointment-types/[id]/workflow
// Detaches the pre-appointment workflow from this appointment type.
// Deletes the type_workflow_links row. Does NOT delete the workflow template
// (it may be referenced by in-flight runs or reattached later).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appointmentTypeId } = await params;

  const access = await requireStaffCanAccessAppointmentType(
    appointmentTypeId
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    await db
      .delete(typeWorkflowLinks)
      .where(
        and(
          eq(typeWorkflowLinks.appointmentTypeId, appointmentTypeId),
          eq(typeWorkflowLinks.direction, "pre_appointment"),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[APPOINTMENT-TYPE-WORKFLOW] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
