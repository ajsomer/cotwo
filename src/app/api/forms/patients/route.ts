import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { patients as patientsT, patientPhoneNumbers } from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireStaffOrgAccess } from "@/lib/auth/staff-access";

// GET /api/forms/patients?org_id=xxx
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
    const patients = await db
      .select({
        id: patientsT.id,
        first_name: patientsT.firstName,
        last_name: patientsT.lastName,
      })
      .from(patientsT)
      .where(eq(patientsT.orgId, orgId))
      .orderBy(asc(patientsT.firstName));

    // Get primary phone for each patient
    const patientIds = patients.map((p) => p.id);
    let phoneMap: Record<string, string> = {};

    if (patientIds.length > 0) {
      const phones = await db
        .select({
          patient_id: patientPhoneNumbers.patientId,
          phone_number: patientPhoneNumbers.phoneNumber,
        })
        .from(patientPhoneNumbers)
        .where(
          and(
            inArray(patientPhoneNumbers.patientId, patientIds),
            eq(patientPhoneNumbers.isPrimary, true)
          )
        );

      phoneMap = Object.fromEntries(phones.map((p) => [p.patient_id, p.phone_number]));
    }

    const result = patients.map((p) => ({
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
