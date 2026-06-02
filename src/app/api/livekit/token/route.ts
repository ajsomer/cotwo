import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { db } from "@/lib/db";
import {
  sessions as sessionsT,
  clinicianRoomAssignments,
  staffAssignments,
  users as usersT,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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

  // 1. Auth the staff user (local cookie verification, no auth-server hop).
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Load the session with its room + location.
  const [session] = await db
    .select({
      id: sessionsT.id,
      status: sessionsT.status,
      room_id: sessionsT.roomId,
      location_id: sessionsT.locationId,
    })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId))
    .limit(1);

  if (!session) {
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
  let authorised = false;
  if (session.room_id) {
    const [roomAssignment] = await db
      .select({ room_id: clinicianRoomAssignments.roomId })
      .from(clinicianRoomAssignments)
      .innerJoin(
        staffAssignments,
        eq(staffAssignments.id, clinicianRoomAssignments.staffAssignmentId),
      )
      .where(
        and(
          eq(clinicianRoomAssignments.roomId, session.room_id),
          eq(staffAssignments.userId, userId),
        ),
      )
      .limit(1);
    authorised = !!roomAssignment;
  }

  if (!authorised) {
    const [staff] = await db
      .select({ role: staffAssignments.role })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.userId, userId),
          eq(staffAssignments.locationId, session.location_id),
          inArray(staffAssignments.role, ["clinic_owner", "practice_manager"]),
        ),
      )
      .limit(1);
    authorised = !!staff;
  }

  if (!authorised) {
    return NextResponse.json(
      { error: "Not authorised to join this session" },
      { status: 403 }
    );
  }

  // 4. Resolve the clinician's display name.
  const [userRow] = await db
    .select({ full_name: usersT.fullName })
    .from(usersT)
    .where(eq(usersT.id, userId))
    .limit(1);

  const displayName = userRow?.full_name ?? "Clinician";

  // 5. Mint the token.
  const result = await generateAccessToken({
    sessionId: session.id,
    identity: `clinician-${userId}`,
    name: displayName,
    role: "clinician",
  });

  return NextResponse.json(result);
}
