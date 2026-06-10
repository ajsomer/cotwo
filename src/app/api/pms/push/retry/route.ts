import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { formSubmissions, sessions as sessionsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { retryField } from "@/lib/pms/sync/push";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * POST { submissionId, questionName, value } → re-send one corrected field
 * from the §6.1 inline edit. Idempotent via the stored patient_form id.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    submissionId?: string;
    questionName?: string;
    value?: string;
  };
  if (!body.submissionId || !body.questionName) {
    return NextResponse.json(
      { error: "submissionId and questionName required" },
      { status: 400 }
    );
  }

  // Authorize via the submission's appointment → session location.
  const [sub] = await db
    .select({ appointmentId: formSubmissions.appointmentId })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, body.submissionId))
    .limit(1);
  if (!sub?.appointmentId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [session] = await db
    .select({ locationId: sessionsT.locationId })
    .from(sessionsT)
    .where(eq(sessionsT.appointmentId, sub.appointmentId))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const access = await requireStaffLocationAccess(session.locationId);
  if (!access.ok) {
    return denyResponse(access);
  }

  const result = await retryField({
    submissionId: body.submissionId,
    questionName: body.questionName,
    value: body.value ?? "",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
