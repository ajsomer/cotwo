import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaffOrgAccess } from "@/lib/auth/staff-access";

// GET /api/forms/patients?org_id=xxx
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");

  if (!orgId) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const access = await requireStaffOrgAccess(supabase, orgId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    const { data: patients, error } = await supabase
      .from("patients")
      .select("id, first_name, last_name")
      .eq("org_id", orgId)
      .order("first_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get primary phone for each patient
    const patientIds = (patients ?? []).map((p) => p.id);
    let phoneMap: Record<string, string> = {};

    if (patientIds.length > 0) {
      const { data: phones } = await supabase
        .from("patient_phone_numbers")
        .select("patient_id, phone_number")
        .in("patient_id", patientIds)
        .eq("is_primary", true);

      if (phones) {
        phoneMap = Object.fromEntries(phones.map((p) => [p.patient_id, p.phone_number]));
      }
    }

    const result = (patients ?? []).map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      phone_number: phoneMap[p.id] ?? null,
    }));

    return NextResponse.json({ patients: result });
  } catch (err) {
    console.error("[Forms] GET patients error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
