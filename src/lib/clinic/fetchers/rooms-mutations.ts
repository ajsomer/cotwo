import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Set a room's clinician assignments to exactly `staffAssignmentIds`.
 *
 * Replaces any existing `clinician_room_assignments` for the room (delete then
 * insert), so it's correct for both creation (no existing rows — the delete is
 * a no-op) and editing (swap the set). Shared by the POST and PATCH handlers in
 * the settings/rooms route, which previously inlined this diff logic twice.
 *
 * Assignment-write failures are logged, not thrown: a room create/update should
 * still succeed if the (secondary) assignment write fails, matching the route's
 * prior behaviour.
 */
export async function updateClinicianAssignments(
  service: SupabaseClient,
  roomId: string,
  staffAssignmentIds: string[],
): Promise<void> {
  await service
    .from("clinician_room_assignments")
    .delete()
    .eq("room_id", roomId);

  if (staffAssignmentIds.length === 0) return;

  const rows = staffAssignmentIds.map((staff_assignment_id) => ({
    staff_assignment_id,
    room_id: roomId,
  }));

  const { error } = await service
    .from("clinician_room_assignments")
    .insert(rows);

  if (error) {
    console.error("Failed to set clinician assignments:", error);
  }
}
