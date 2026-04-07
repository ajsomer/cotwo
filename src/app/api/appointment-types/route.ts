import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/appointment-types?org_id=xxx
// Returns appointment types with pre-workflow action counts.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    // Fetch appointment types
    const { data: types, error } = await supabase
      .from("appointment_types")
      .select("*")
      .eq("org_id", orgId)
      .order("name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const typeIds = (types ?? []).map((t) => t.id);
    if (typeIds.length === 0) {
      return NextResponse.json({ appointment_types: [] });
    }

    // Fetch pre-workflow links with action block counts
    const { data: links } = await supabase
      .from("type_workflow_links")
      .select("appointment_type_id, workflow_template_id")
      .in("appointment_type_id", typeIds)
      .eq("direction", "pre_appointment");

    const templateIds = (links ?? []).map((l) => l.workflow_template_id);
    const linkByType = new Map(
      (links ?? []).map((l) => [l.appointment_type_id, l.workflow_template_id])
    );

    // Count action blocks per template
    let blockCounts: Record<string, number> = {};
    if (templateIds.length > 0) {
      const { data: blocks } = await supabase
        .from("workflow_action_blocks")
        .select("template_id")
        .in("template_id", templateIds);

      for (const b of blocks ?? []) {
        blockCounts[b.template_id] = (blockCounts[b.template_id] || 0) + 1;
      }
    }

    // Count in-flight runs per template
    let inFlightCounts: Record<string, number> = {};
    if (templateIds.length > 0) {
      const { data: runs } = await supabase
        .from("appointment_workflow_runs")
        .select("workflow_template_id")
        .in("workflow_template_id", templateIds)
        .eq("status", "active");

      for (const r of runs ?? []) {
        inFlightCounts[r.workflow_template_id] =
          (inFlightCounts[r.workflow_template_id] || 0) + 1;
      }
    }

    // Assemble response
    const result = (types ?? []).map((t) => {
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
// Creates a new Coviu-created appointment type.
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

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("appointment_types")
      .insert({
        org_id,
        name,
        modality: modality ?? "telehealth",
        duration_minutes: duration_minutes ?? 30,
        default_fee_cents: default_fee_cents ?? 0,
        source: "coviu",
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
// Updates an existing appointment type. When source='pms', name and
// duration_minutes are read-only (overwritten on PMS sync).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, modality, duration_minutes, default_fee_cents } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Check if PMS-sourced
    const { data: existing } = await supabase
      .from("appointment_types")
      .select("source")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Appointment type not found" },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};

    // PMS-sourced types: only fee and modality are editable
    if (existing.source === "pms") {
      if (default_fee_cents !== undefined)
        updates.default_fee_cents = default_fee_cents;
      if (modality !== undefined) updates.modality = modality;
    } else {
      if (name !== undefined) updates.name = name;
      if (duration_minutes !== undefined)
        updates.duration_minutes = duration_minutes;
      if (default_fee_cents !== undefined)
        updates.default_fee_cents = default_fee_cents;
      if (modality !== undefined) updates.modality = modality;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updateable fields provided" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("appointment_types")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
// Deletes an appointment type.
// Cascade behaviour:
// - type_workflow_links: CASCADE — junction row removed
// - workflow_templates: NOT deleted — may be reused by other types
// - appointment_workflow_runs: reference appointments, not types — unaffected
// - appointments.appointment_type_id: SET NULL
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { error } = await supabase
      .from("appointment_types")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[APPOINTMENT-TYPES] DELETE error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
