import { NextRequest, NextResponse } from "next/server";
import { requireStaffCanAccessAppointment } from "@/lib/auth/staff-access";
import { buildIntakePackagePdf } from "@/lib/forms/build-intake-pdf";

/**
 * GET /api/tasks/intake-handoff/pdf?appointment_id=X
 *
 * Renders the whole intake package as a single inline PDF. Data resolution +
 * rendering live in the shared buildIntakePackagePdf (also used by the
 * attach-to-PMS push). Staff-only; org-scoped.
 */
export async function GET(request: NextRequest) {
  const appointmentId = request.nextUrl.searchParams.get("appointment_id");
  if (!appointmentId) {
    return NextResponse.json({ error: "appointment_id required" }, { status: 400 });
  }

  const access = await requireStaffCanAccessAppointment(appointmentId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Not found" },
      { status: access.status }
    );
  }

  try {
    const pdf = await buildIntakePackagePdf(appointmentId);
    if (!pdf) {
      return NextResponse.json(
        { error: "No intake package found for appointment" },
        { status: 404 }
      );
    }
    return new Response(pdf.buffer as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.fileName}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    console.error("[intake-handoff-pdf] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
