import { cache } from "react";
import { db } from "@/lib/db";
import {
  rooms as roomsT,
  clinicianRoomAssignments,
  staffAssignments,
  users as usersT,
} from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import type { RoomWithClinicians } from "@/stores/clinic-store";

export const fetchRoomsWithClinicians = cache(async (
  locationId: string
): Promise<RoomWithClinicians[]> => {
  const rooms = await db
    .select()
    .from(roomsT)
    .where(eq(roomsT.locationId, locationId))
    .orderBy(asc(roomsT.sortOrder));

  const roomIds = rooms.map((r) => r.id);
  let assignmentsByRoom: Record<
    string,
    Array<{ staff_assignment_id: string; full_name: string }>
  > = {};

  if (roomIds.length > 0) {
    const assignments = await db
      .select({
        room_id: clinicianRoomAssignments.roomId,
        staff_assignment_id: clinicianRoomAssignments.staffAssignmentId,
        user_id: staffAssignments.userId,
      })
      .from(clinicianRoomAssignments)
      .leftJoin(
        staffAssignments,
        eq(staffAssignments.id, clinicianRoomAssignments.staffAssignmentId)
      )
      .where(inArray(clinicianRoomAssignments.roomId, roomIds));

    if (assignments.length > 0) {
      const userIds = [
        ...new Set(assignments.map((a) => a.user_id).filter((x): x is string => !!x)),
      ];

      const users = userIds.length > 0
        ? await db
            .select({ id: usersT.id, full_name: usersT.fullName })
            .from(usersT)
            .where(inArray(usersT.id, userIds))
        : [];

      const userMap: Record<string, string> = {};
      for (const u of users) {
        userMap[u.id] = u.full_name;
      }

      assignmentsByRoom = assignments.reduce(
        (acc: Record<string, Array<{ staff_assignment_id: string; full_name: string }>>, a) => {
          const roomId = a.room_id;
          const userId = a.user_id;
          if (!acc[roomId]) acc[roomId] = [];
          acc[roomId].push({
            staff_assignment_id: a.staff_assignment_id,
            full_name: userId ? (userMap[userId] ?? "Unknown") : "Unknown",
          });
          return acc;
        },
        {}
      );
    }
  }

  return rooms.map((room) => ({
    id: room.id,
    location_id: room.locationId,
    name: room.name,
    room_type: room.roomType,
    link_token: room.linkToken ?? "",
    sort_order: room.sortOrder,
    payments_enabled: room.paymentsEnabled ?? false,
    clinicians: assignmentsByRoom[room.id] ?? [],
  }));
});
