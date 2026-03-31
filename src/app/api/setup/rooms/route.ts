import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Verify auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { rooms } = body as {
    rooms?: Array<{ name: string; sort_order: number }>;
  };

  if (!rooms || rooms.length === 0) {
    return NextResponse.json(
      { error: "At least one room is required." },
      { status: 400 }
    );
  }

  // Validate room names
  if (rooms.some((r) => !r.name?.trim())) {
    return NextResponse.json(
      { error: "All rooms must have a name." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Look up the user's staff assignment and location
  const { data: assignment, error: saError } = await service
    .from("staff_assignments")
    .select("id, location_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (saError || !assignment) {
    return NextResponse.json(
      { error: "Complete clinic setup first." },
      { status: 400 }
    );
  }

  // Insert rooms
  const roomInserts = rooms.map((r) => ({
    location_id: assignment.location_id,
    name: r.name.trim(),
    sort_order: r.sort_order,
  }));

  const { data: createdRooms, error: roomError } = await service
    .from("rooms")
    .insert(roomInserts)
    .select("id, sort_order");

  if (roomError || !createdRooms) {
    return NextResponse.json(
      { error: "Failed to create rooms." },
      { status: 500 }
    );
  }

  // Auto-assign clinic owner to the first room
  const firstRoom = createdRooms.find((r) => r.sort_order === 0) ?? createdRooms[0];

  if (
    firstRoom &&
    (assignment.role === "clinic_owner" || assignment.role === "clinician")
  ) {
    await service.from("clinician_room_assignments").insert({
      staff_assignment_id: assignment.id,
      room_id: firstRoom.id,
    });
  }

  return NextResponse.json({
    rooms: createdRooms.map((r) => r.id),
  });
}
