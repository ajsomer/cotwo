import { NextResponse, type NextRequest } from "next/server";
import { requireStaffSessionLocationAccess } from "@/lib/auth/staff-access";
import { getSessionPmsGate } from "@/lib/pms/session-gate";
import { pushSessionFormSubmissions } from "@/lib/pms/sync/push";
import { webLinkForPatientBySession } from "@/lib/pms/web-link";
import { denyResponse } from "@/lib/api/route-helpers";

/**
 * GET ?sessionId= → the §6.1 gate (should the Done step show "send to {PMS}").
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const access = await requireStaffSessionLocationAccess(sessionId);
  if (!access.ok) {
    return denyResponse(access, { notFound: "Session not found" });
  }

  const gate = await getSessionPmsGate(sessionId);
  const patientId = request.nextUrl.searchParams.get("patientId");
  const patientWebLink =
    gate.active && patientId
      ? await webLinkForPatientBySession(sessionId, patientId)
      : null;
  return NextResponse.json({ ...gate, patientWebLink });
}

/**
 * POST { sessionId } → push the session's PMS-bound form submissions.
 * Returns per-field results for the §6.1 feedback list. Does NOT mark the
 * session done — the client does that after the push settles.
 */
export async function POST(request: NextRequest) {
  const { sessionId } = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
  };
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const access = await requireStaffSessionLocationAccess(sessionId);
  if (!access.ok) {
    return denyResponse(access, { notFound: "Session not found" });
  }

  const result = await pushSessionFormSubmissions({ sessionId });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
