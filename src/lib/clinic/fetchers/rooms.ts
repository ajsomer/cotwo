import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import type { RoomWithClinicians } from "@/stores/clinic-store";

export const fetchRoomsWithClinicians = cache(async (
  locationId: string
): Promise<RoomWithClinicians[]> => {
  const supabase = createServiceClient();

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("*")
    .eq("location_id", locationId)
    .order("sort_order", { ascending: true });

  if (roomsError) {
    console.error("fetchRoomsWithClinicians rooms error:", roomsError);
    return [];
  }

  const roomIds = (rooms ?? []).map((r) => r.id);
  let assignmentsByRoom: Record<
    string,
    Array<{ staff_assignment_id: string; full_name: string }>
  > = {};

  if (roomIds.length > 0) {
    const { data: assignments } = await supabase
      .from("clinician_room_assignments")
      .select("room_id, staff_assignment_id, staff_assignments ( user_id )")
      .in("room_id", roomIds);

    if (assignments && assignments.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userIds = [...new Set(assignments.map((a: any) => a.staff_assignments?.user_id).filter(Boolean))];

      const { data: users } = await supabase
        .from("users")
        .select("id, full_name")
        .in("id", userIds);

      const userMap: Record<string, string> = {};
      for (const u of users ?? []) {
        userMap[u.id] = u.full_name;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assignmentsByRoom = assignments.reduce((acc: any, a: any) => {
        const roomId = a.room_id;
        const userId = a.staff_assignments?.user_id;
        if (!acc[roomId]) acc[roomId] = [];
        acc[roomId].push({
          staff_assignment_id: a.staff_assignment_id,
          full_name: userId ? (userMap[userId] ?? "Unknown") : "Unknown",
        });
        return acc;
      }, {});
    }
  }

  return (rooms ?? []).map((room) => ({
    id: room.id,
    location_id: room.location_id,
    name: room.name,
    room_type: room.room_type,
    link_token: room.link_token,
    sort_order: room.sort_order,
    payments_enabled: room.payments_enabled ?? false,
    clinicians: assignmentsByRoom[room.id] ?? [],
  }));
});
