import { db } from "@/lib/db";
import {
  rooms as roomsT,
  pmsConnections,
  staffAssignments,
  clinicianRoomAssignments,
} from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { resolveDefaultStaffOrg, getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { NextResponse, type NextRequest } from "next/server";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";

export async function GET() {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return unauthenticatedResponse();
  }

  // Setup flow: no scope is supplied, so resolve the user's default org.
  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) {
    return NextResponse.json({ rooms: [], imported: false });
  }
  const { orgId, locationId } = resolved;

  const [rooms, pmsRows] = await Promise.all([
    db
      .select({ id: roomsT.id, name: roomsT.name, sort_order: roomsT.sortOrder })
      .from(roomsT)
      .where(eq(roomsT.locationId, locationId))
      .orderBy(asc(roomsT.sortOrder)),
    db
      .select({
        provider: pmsConnections.provider,
        status: pmsConnections.status,
        credentialsEncrypted: pmsConnections.credentialsEncrypted,
      })
      .from(pmsConnections)
      .where(eq(pmsConnections.orgId, orgId))
      .limit(1),
  ]);

  const pms = pmsRows[0];
  // Rooms were imported from a PMS when: a real (sync-active) connection
  // provisioned them, or the Gentu demo marker seeded them.
  const imported =
    Boolean(pms?.credentialsEncrypted) ||
    (pms?.provider === "gentu" && pms?.status === "connected");

  return NextResponse.json({ rooms: rooms ?? [], imported });
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return unauthenticatedResponse();
  }

  const body = await request.json();
  const { rooms } = body as {
    rooms?: Array<{ id?: string; name: string; sort_order: number }>;
  };

  if (!rooms || rooms.length === 0) {
    return NextResponse.json(
      { error: "At least one room is required." },
      { status: 400 }
    );
  }

  if (rooms.some((r) => !r.name?.trim())) {
    return NextResponse.json(
      { error: "All rooms must have a name." },
      { status: 400 }
    );
  }

  const [assignment] = await db
    .select({
      id: staffAssignments.id,
      location_id: staffAssignments.locationId,
      role: staffAssignments.role,
    })
    .from(staffAssignments)
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!assignment) {
    return NextResponse.json(
      { error: "Complete clinic setup first." },
      { status: 400 }
    );
  }

  // Diff against existing rooms: update kept rows, insert new ones, delete removed ones.
  const existing = await db
    .select({ id: roomsT.id })
    .from(roomsT)
    .where(eq(roomsT.locationId, assignment.location_id));

  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const submittedIds = new Set(rooms.filter((r) => r.id).map((r) => r.id as string));
  const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));

  if (toDelete.length > 0) {
    await db.delete(roomsT).where(inArray(roomsT.id, toDelete));
  }

  // Updates for kept rooms
  await Promise.all(
    rooms
      .filter((r) => r.id && existingIds.has(r.id))
      .map((r) =>
        db
          .update(roomsT)
          .set({ name: r.name.trim(), sortOrder: r.sort_order })
          .where(eq(roomsT.id, r.id as string))
      )
  );

  // Inserts for new rooms
  const newRows = rooms.filter((r) => !r.id || !existingIds.has(r.id));
  let inserted: { id: string; sort_order: number }[] = [];
  if (newRows.length > 0) {
    try {
      inserted = await db
        .insert(roomsT)
        .values(
          newRows.map((r) => ({
            locationId: assignment.location_id,
            name: r.name.trim(),
            sortOrder: r.sort_order,
            roomType: "clinical" as const,
          }))
        )
        .returning({ id: roomsT.id, sort_order: roomsT.sortOrder });
    } catch {
      return NextResponse.json({ error: "Failed to save rooms." }, { status: 500 });
    }
  }

  // Auto-assign clinic owner to the first room (sort_order 0)
  if (assignment.role === "clinic_owner" || assignment.role === "clinician") {
    const firstSubmitted = rooms.find((r) => r.sort_order === 0) ?? rooms[0];
    let firstRoomId: string | undefined = firstSubmitted.id;
    if (!firstRoomId) {
      // Newly inserted — find by sort_order
      firstRoomId = inserted.find((r) => r.sort_order === firstSubmitted.sort_order)?.id;
    }

    if (firstRoomId) {
      const [existingAssignment] = await db
        .select({
          id: clinicianRoomAssignments.id,
          room_id: clinicianRoomAssignments.roomId,
        })
        .from(clinicianRoomAssignments)
        .where(eq(clinicianRoomAssignments.staffAssignmentId, assignment.id))
        .limit(1);

      if (!existingAssignment) {
        await db.insert(clinicianRoomAssignments).values({
          staffAssignmentId: assignment.id,
          roomId: firstRoomId,
        });
      } else if (existingAssignment.room_id !== firstRoomId) {
        await db
          .update(clinicianRoomAssignments)
          .set({ roomId: firstRoomId })
          .where(eq(clinicianRoomAssignments.id, existingAssignment.id));
      }
    }
  }

  return NextResponse.json({ ok: true });
}
