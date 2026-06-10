import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sessions as sessionsT,
  sessionParticipants,
  patients as patientsT,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { generateAccessToken } from "@/lib/livekit/tokens";
import { parseJsonBody } from "@/lib/api/route-helpers";

/**
 * POST /api/patient/livekit/token
 *
 * Mints a LiveKit access token for a patient to join their session's video
 * room. Patients are not auth users — they authenticate via their session's
 * entry_token.
 *
 * Authorisation:
 *   - entryToken must resolve to a session.
 *   - Session status must be `in_session`. If `waiting`, the patient hasn't
 *     been admitted yet and shouldn't have a video token (409).
 */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<{ entryToken?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const { entryToken } = parsed.body;

  if (!entryToken || typeof entryToken !== "string") {
    return NextResponse.json({ error: "entryToken required" }, { status: 400 });
  }

  const [session] = await db
    .select({ id: sessionsT.id, status: sessionsT.status })
    .from(sessionsT)
    .where(eq(sessionsT.entryToken, entryToken))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status === "waiting") {
    return NextResponse.json(
      { error: "Not yet admitted. Please wait for your clinician." },
      { status: 409 }
    );
  }

  if (session.status !== "in_session") {
    return NextResponse.json(
      { error: `Session is ${session.status}, cannot join video.` },
      { status: 409 }
    );
  }

  // Resolve patient display name (first participant; MVP assumes single patient).
  const [patient] = await db
    .select({
      id: patientsT.id,
      first_name: patientsT.firstName,
      last_name: patientsT.lastName,
    })
    .from(sessionParticipants)
    .innerJoin(patientsT, eq(patientsT.id, sessionParticipants.patientId))
    .where(eq(sessionParticipants.sessionId, session.id))
    .orderBy(asc(sessionParticipants.createdAt))
    .limit(1);

  const identity = patient ? `patient-${patient.id}` : `patient-session-${session.id}`;
  const displayName = patient
    ? `${patient.first_name} ${patient.last_name}`.trim() || "Patient"
    : "Patient";

  const result = await generateAccessToken({
    sessionId: session.id,
    identity,
    name: displayName,
    role: "patient",
  });

  return NextResponse.json(result);
}
