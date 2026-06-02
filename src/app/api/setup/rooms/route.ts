import { createServiceClient } from "@/lib/supabase/service";
import { resolveDefaultStaffOrg, getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { NextResponse, type NextRequest } from "next/server";

export async function GET() {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  // Setup flow: no scope is supplied, so resolve the user's default org.
  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) {
    return NextResponse.json({ rooms: [], imported: false });
  }
  const { orgId, locationId } = resolved;

  const [{ data: rooms }, { data: pms }] = await Promise.all([
    service
      .from("rooms")
      .select("id, name, sort_order")
      .eq("location_id", locationId)
      .order("sort_order", { ascending: true }),
    service
      .from("pms_connections")
      .select("provider, status")
      .eq("org_id", orgId)
      .maybeSingle(),
  ]);

  const imported = pms?.provider === "gentu" && pms?.status === "connected";

  return NextResponse.json({ rooms: rooms ?? [], imported });
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const service = createServiceClient();

  const { data: assignment, error: saError } = await service
    .from("staff_assignments")
    .select("id, location_id, role")
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (saError || !assignment) {
    return NextResponse.json(
      { error: "Complete clinic setup first." },
      { status: 400 }
    );
  }

  // Diff against existing rooms: update kept rows, insert new ones, delete removed ones.
  const { data: existing } = await service
    .from("rooms")
    .select("id")
    .eq("location_id", assignment.location_id);

  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const submittedIds = new Set(rooms.filter((r) => r.id).map((r) => r.id as string));
  const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));

  if (toDelete.length > 0) {
    await service.from("rooms").delete().in("id", toDelete);
  }

  // Updates for kept rooms
  await Promise.all(
    rooms
      .filter((r) => r.id && existingIds.has(r.id))
      .map((r) =>
        service
          .from("rooms")
          .update({ name: r.name.trim(), sort_order: r.sort_order })
          .eq("id", r.id as string)
      )
  );

  // Inserts for new rooms
  const newRows = rooms.filter((r) => !r.id || !existingIds.has(r.id));
  let inserted: { id: string; sort_order: number }[] = [];
  if (newRows.length > 0) {
    const { data, error } = await service
      .from("rooms")
      .insert(
        newRows.map((r) => ({
          location_id: assignment.location_id,
          name: r.name.trim(),
          sort_order: r.sort_order,
          room_type: "clinical",
        }))
      )
      .select("id, sort_order");

    if (error) {
      return NextResponse.json({ error: "Failed to save rooms." }, { status: 500 });
    }
    inserted = data ?? [];
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
      const { data: existingAssignment } = await service
        .from("clinician_room_assignments")
        .select("id, room_id")
        .eq("staff_assignment_id", assignment.id)
        .maybeSingle();

      if (!existingAssignment) {
        await service.from("clinician_room_assignments").insert({
          staff_assignment_id: assignment.id,
          room_id: firstRoomId,
        });
      } else if (existingAssignment.room_id !== firstRoomId) {
        await service
          .from("clinician_room_assignments")
          .update({ room_id: firstRoomId })
          .eq("id", existingAssignment.id);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
