import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateAccessToken } from "@/lib/livekit/tokens";

/**
 * POST /api/livekit/token
 *
 * Mints a LiveKit access token for the authenticated clinician to join a
 * specific session's video room.
 *
 * Authorisation:
 *   - User must be authenticated (Supabase session cookie).
 *   - User must be either (a) assigned to the session's room via
 *     clinician_room_assignments, or (b) a clinic_owner / practice_manager
 *     at the session's location (admin override — useful for ops and demos).
 *   - Session status must be `in_session`.
 */
export async function POST(request: NextRequest) {
  const { sessionId } = await request.json();

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  // 1. Auth the staff user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Load the session with its room + location.
  const service = createServiceClient();
  const { data: session, error: sessionError } = await service
    .from("sessions")
    .select("id, status, room_id, location_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "in_session") {
    return NextResponse.json(
      {
        error: `Session is ${session.status}, not in_session. Admit the patient first.`,
      },
      { status: 409 }
    );
  }

  // 3. Authorise. Try room assignment first; fall back to owner/PM at location.
  const { data: roomAssignment } = await service
    .from("clinician_room_assignments")
    .select("room_id, staff_assignments!inner(user_id, location_id)")
    .eq("room_id", session.room_id)
    .eq("staff_assignments.user_id", user.id)
    .maybeSingle();

  let authorised = !!roomAssignment;

  if (!authorised) {
    const { data: staff } = await service
      .from("staff_assignments")
      .select("role")
      .eq("user_id", user.id)
      .eq("location_id", session.location_id)
      .in("role", ["clinic_owner", "practice_manager"])
      .maybeSingle();
    authorised = !!staff;
  }

  if (!authorised) {
    return NextResponse.json(
      { error: "Not authorised to join this session" },
      { status: 403 }
    );
  }

  // 4. Resolve the clinician's display name.
  const { data: userRow } = await service
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const displayName = userRow?.full_name ?? "Clinician";

  // 5. Mint the token.
  const result = await generateAccessToken({
    sessionId: session.id,
    identity: `clinician-${user.id}`,
    name: displayName,
    role: "clinician",
  });

  return NextResponse.json(result);
}
