import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sessions as sessionsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { getSessionPmsGate } from "@/lib/pms/session-gate";
import { pushSessionFormSubmissions } from "@/lib/pms/sync/push";
import { webLinkForPatientBySession } from "@/lib/pms/web-link";

/**
 * GET ?sessionId= → the §6.1 gate (should the Done step show "send to {PMS}").
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const denied = await authorizeSession(sessionId);
  if (denied) return denied;

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
  const denied = await authorizeSession(sessionId);
  if (denied) return denied;

  const result = await pushSessionFormSubmissions({ sessionId });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/** Returns a NextResponse on denial, or null when authorized. */
async function authorizeSession(
  sessionId: string
): Promise<NextResponse | null> {
  const [session] = await db
    .select({ locationId: sessionsT.locationId })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const access = await requireStaffLocationAccess(session.locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  return null;
}
