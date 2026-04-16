import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchRoomsWithClinicians } from "@/lib/clinic/fetchers/rooms";

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

  try {
    if (type === "clinicians") {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("staff_assignments")
        .select("id, user_id, users ( full_name )")
        .eq("location_id", locationId)
        .eq("role", "clinician");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clinicians = (data ?? []).map((sa: any) => ({
        staff_assignment_id: sa.id,
        user_id: sa.user_id,
        full_name: sa.users?.full_name ?? "Unknown",
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

  const supabase = createServiceClient();

  const { data: room, error } = await supabase
    .from("rooms")
    .insert({
      location_id,
      name,
      room_type,
      sort_order: sort_order ?? 0,
      link_token: `link-${crypto.randomUUID().slice(0, 12)}`,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Insert clinician assignments if provided
  if (clinician_assignment_ids?.length > 0 && room) {
    const rows = clinician_assignment_ids.map((saId: string) => ({
      staff_assignment_id: saId,
      room_id: room.id,
    }));

    const { error: assignError } = await supabase
      .from("clinician_room_assignments")
      .insert(rows);

    if (assignError) {
      console.error("Failed to insert clinician assignments:", assignError);
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

  const supabase = createServiceClient();

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (room_type !== undefined) updates.room_type = room_type;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (body.payments_enabled !== undefined) updates.payments_enabled = body.payments_enabled;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("rooms")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Replace clinician assignments if provided
  if (clinician_assignment_ids !== undefined) {
    // Delete existing
    await supabase
      .from("clinician_room_assignments")
      .delete()
      .eq("room_id", id);

    // Insert new
    if (clinician_assignment_ids.length > 0) {
      const rows = clinician_assignment_ids.map((saId: string) => ({
        staff_assignment_id: saId,
        room_id: id,
      }));

      const { error: assignError } = await supabase
        .from("clinician_room_assignments")
        .insert(rows);

      if (assignError) {
        console.error("Failed to update clinician assignments:", assignError);
      }
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

  const supabase = createServiceClient();

  // Check for active sessions (anything not done or queued)
  const { data: activeSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("room_id", id)
    .not("status", "in", '("done","queued")')
    .limit(1);

  if (activeSessions && activeSessions.length > 0) {
    return NextResponse.json(
      {
        error:
          "Cannot delete room with active sessions. Complete or remove all sessions first.",
      },
      { status: 409 }
    );
  }

  // Delete room — clinician_room_assignments cascade automatically
  const { error } = await supabase.from("rooms").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
