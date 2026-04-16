import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateAccessToken } from "@/lib/livekit/tokens";

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
  const { entryToken } = await request.json();

  if (!entryToken || typeof entryToken !== "string") {
    return NextResponse.json({ error: "entryToken required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(
      `
      id, status,
      session_participants(
        patients(id, first_name, last_name)
      )
    `
    )
    .eq("entry_token", entryToken)
    .single();

  if (sessionError || !session) {
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
  // Supabase types the joined relation as an array even for singular FKs.
  const participants = (session.session_participants ?? []) as unknown as Array<{
    patients:
      | { id: string; first_name: string; last_name: string }
      | { id: string; first_name: string; last_name: string }[]
      | null;
  }>;
  const raw = participants[0]?.patients ?? null;
  const patient = Array.isArray(raw) ? (raw[0] ?? null) : raw;

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
