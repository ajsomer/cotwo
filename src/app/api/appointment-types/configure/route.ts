import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/appointment-types/configure
 *
 * Atomic save for the full appointment type configuration: details, terminal
 * type, intake package, reminders, and urgency thresholds. Wraps the
 * configure_appointment_type RPC function (013/014 migration) which executes
 * the multi-table write in a single database transaction.
 *
 * Handles both create (new appointment type) and update (existing) in one call.
 * Idempotent at the appointment-type-id level.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      appointment_type_id,
      org_id,
      name,
      duration_minutes,
      modality,
      default_fee_cents,
      terminal_type,
      includes_card_capture,
      includes_consent,
      form_ids,
      reminders,
      at_risk_after_days,
      overdue_after_days,
    } = body;

    // --- Server-side validation ---

    if (!org_id) {
      return NextResponse.json({ error: "org_id is required" }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (terminal_type !== undefined && terminal_type !== "run_sheet") {
      return NextResponse.json({ error: "terminal_type must be run_sheet" }, { status: 400 });
    }
    if (duration_minutes == null || typeof duration_minutes !== "number" || duration_minutes < 0) {
      return NextResponse.json({ error: "Duration is required" }, { status: 400 });
    }
    if (!modality) {
      return NextResponse.json({ error: "Modality is required" }, { status: 400 });
    }

    // Urgency threshold validation
    if (at_risk_after_days != null && at_risk_after_days <= 0) {
      return NextResponse.json({ error: "At-risk threshold must be a positive number" }, { status: 400 });
    }
    if (overdue_after_days != null && overdue_after_days <= 0) {
      return NextResponse.json({ error: "Overdue threshold must be a positive number" }, { status: 400 });
    }
    if (at_risk_after_days != null && overdue_after_days != null && overdue_after_days <= at_risk_after_days) {
      return NextResponse.json({ error: "Overdue threshold must be greater than at-risk threshold" }, { status: 400 });
    }

    // Reminder validation
    const reminderList = Array.isArray(reminders) ? reminders : [];
    if (reminderList.length > 2) {
      return NextResponse.json({ error: "Maximum 2 reminders allowed" }, { status: 400 });
    }
    const offsets = reminderList.map((r: { offset_days: number }) => r.offset_days);
    if (new Set(offsets).size !== offsets.length) {
      return NextResponse.json({ error: "Reminder offsets must be unique" }, { status: 400 });
    }
    for (const r of reminderList) {
      if (!r.offset_days || r.offset_days <= 0) {
        return NextResponse.json({ error: "Reminder offsets must be positive integers" }, { status: 400 });
      }
    }

    // Form IDs validation
    const formIdList = Array.isArray(form_ids) ? form_ids : [];
    if (formIdList.length > 0) {
      const supabaseCheck = createServiceClient();
      const { data: existingForms } = await supabaseCheck
        .from("forms")
        .select("id")
        .in("id", formIdList)
        .eq("org_id", org_id)
        .eq("is_platform_demo", false);

      const existingIds = new Set((existingForms ?? []).map((f) => f.id));
      const missing = formIdList.filter((id: string) => !existingIds.has(id));
      if (missing.length > 0) {
        return NextResponse.json({ error: `Forms not found: ${missing.join(", ")}` }, { status: 400 });
      }
    }

    // --- Call RPC ---

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("configure_appointment_type", {
      p_org_id: org_id,
      p_appointment_type_id: appointment_type_id ?? null,
      p_name: name.trim(),
      p_duration_minutes: duration_minutes,
      p_modality: modality,
      p_default_fee_cents: default_fee_cents ?? 0,
      p_terminal_type: "run_sheet",
      p_includes_card_capture: includes_card_capture ?? false,
      p_includes_consent: includes_consent ?? false,
      p_form_ids: formIdList,
      p_reminders: reminderList.map((r: { id?: string; offset_days: number; message_body: string }) => ({
        id: r.id ?? null,
        offset_days: r.offset_days,
        message_body: r.message_body ?? "",
      })),
      p_at_risk_after_days: at_risk_after_days ?? null,
      p_overdue_after_days: overdue_after_days ?? null,
    });

    if (error) {
      console.error("[configure] RPC error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Legacy block cleanup is now inside the RPC itself (Step 3.5).
    return NextResponse.json(data);
  } catch (err) {
    console.error("[configure] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
