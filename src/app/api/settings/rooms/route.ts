import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  rooms as roomsT,
  staffAssignments,
  users as usersT,
  sessions as sessionsT,
} from "@/lib/db/schema";
import { and, eq, notInArray } from "drizzle-orm";
import { fetchRoomsWithClinicians } from "@/lib/clinic/fetchers/rooms";
import { updateClinicianAssignments } from "@/lib/clinic/fetchers/rooms-mutations";
import {
  requireAuthenticatedUser,
  requireStaffLocationAccess,
} from "@/lib/auth/staff-access";
import { denyResponse, unauthenticatedResponse } from "@/lib/api/route-helpers";

// Mutation routes take a room id, not a location id. Order matters: auth
// FIRST, then service-role lookup, then location access. Reversing those
// steps lets unauthenticated callers distinguish a real room id (401 from
// the location check) from a fake one (404 from the room lookup), which is
// an existence-leak. Matches the pattern documented on
// requireAuthenticatedUser in staff-access.ts.
async function gateRoomMutation(
  roomId: string,
): Promise<
  | { ok: true; locationId: string }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return {
      ok: false,
      response: unauthenticatedResponse(),
    };
  }

  const [room] = await db
    .select({ location_id: roomsT.locationId })
    .from(roomsT)
    .where(eq(roomsT.id, roomId))
    .limit(1);

  if (!room) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Room not found" }, { status: 404 }),
    };
  }

  const access = await requireStaffLocationAccess(room.location_id);
  if (!access.ok) {
    return {
      ok: false,
      response: denyResponse(access),
    };
  }

  return { ok: true, locationId: room.location_id };
}

// GET /api/settings/rooms?location_id=xxx
// GET /api/settings/rooms?location_id=xxx&type=clinicians
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");
  const type = request.nextUrl.searchParams.get("type");

  if (!locationId) {
    return NextResponse.json(
      { error: "location_id required" },
      { status: 400 }
    );
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return denyResponse(access);
  }

  try {
    if (type === "clinicians") {
      const rows = await db
        .select({
          id: staffAssignments.id,
          user_id: staffAssignments.userId,
          full_name: usersT.fullName,
        })
        .from(staffAssignments)
        .leftJoin(usersT, eq(usersT.id, staffAssignments.userId))
        .where(
          and(
            eq(staffAssignments.locationId, locationId),
            eq(staffAssignments.role, "clinician"),
          ),
        );

      const clinicians = rows.map((sa) => ({
        staff_assignment_id: sa.id,
        user_id: sa.user_id,
        full_name: sa.full_name ?? "Unknown",
      }));

      return NextResponse.json({ clinicians });
    }

    const rooms = await fetchRoomsWithClinicians(locationId);
    return NextResponse.json({ rooms });
  } catch (err) {
    console.error("GET /api/settings/rooms error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/settings/rooms
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { location_id, name, room_type, sort_order, clinician_assignment_ids } =
    body;

  if (!location_id || !name || !room_type) {
    return NextResponse.json(
      { error: "location_id, name, and room_type are required" },
      { status: 400 }
    );
  }

  const access = await requireStaffLocationAccess(location_id);
  if (!access.ok) {
    return denyResponse(access);
  }

  const [room] = await db
    .insert(roomsT)
    .values({
      locationId: location_id,
      name,
      roomType: room_type,
      sortOrder: sort_order ?? 0,
      linkToken: `link-${crypto.randomUUID().slice(0, 12)}`,
    })
    .returning();

  // Insert clinician assignments if provided
  if (clinician_assignment_ids?.length > 0 && room) {
    const res = await updateClinicianAssignments(
      room.id,
      clinician_assignment_ids,
      location_id,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: "Invalid clinician assignment for this location" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ room }, { status: 201 });
}

// PATCH /api/settings/rooms
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, room_type, sort_order, clinician_assignment_ids } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const gate = await gateRoomMutation(id);
  if (!gate.ok) return gate.response;

  // Build update object with only provided fields
  const updates: Partial<typeof roomsT.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (room_type !== undefined) updates.roomType = room_type;
  if (sort_order !== undefined) updates.sortOrder = sort_order;
  if (body.payments_enabled !== undefined) updates.paymentsEnabled = body.payments_enabled;

  if (Object.keys(updates).length > 0) {
    await db.update(roomsT).set(updates).where(eq(roomsT.id, id));
  }

  // Replace clinician assignments if provided
  if (clinician_assignment_ids !== undefined) {
    const res = await updateClinicianAssignments(
      id,
      clinician_assignment_ids,
      gate.locationId,
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: "Invalid clinician assignment for this location" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/settings/rooms?id=xxx
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const gate = await gateRoomMutation(id);
  if (!gate.ok) return gate.response;

  // Check for active sessions (anything not done or queued)
  const activeSessions = await db
    .select({ id: sessionsT.id })
    .from(sessionsT)
    .where(
      and(
        eq(sessionsT.roomId, id),
        notInArray(sessionsT.status, ["done", "queued"]),
      ),
    )
    .limit(1);

  if (activeSessions.length > 0) {
    return NextResponse.json(
      {
        error:
          "Cannot delete room with active sessions. Complete or remove all sessions first.",
      },
      { status: 409 }
    );
  }

  // Delete room — clinician_room_assignments cascade automatically
  await db.delete(roomsT).where(eq(roomsT.id, id));

  return NextResponse.json({ success: true });
}
