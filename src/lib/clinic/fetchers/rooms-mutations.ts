import type { SupabaseClient } from "@supabase/supabase-js";
import { assertStaffAssignmentsInLocation } from "@/lib/auth/staff-access";

/**
 * Set a room's clinician assignments to exactly `staffAssignmentIds`.
 *
 * Replaces any existing `clinician_room_assignments` for the room (delete then
 * insert), so it's correct for both creation (no existing rows — the delete is
 * a no-op) and editing (swap the set). Shared by the POST and PATCH handlers in
 * the settings/rooms route, which previously inlined this diff logic twice.
 *
 * `locationId` is the room's location: every submitted `staff_assignment_id`
 * must belong to it. The caller already gated the room/location, but the
 * assignment ids are caller-supplied — without this check a crafted request
 * could attach a staff assignment from another location to this room. On
 * mismatch we return `{ ok: false }` WITHOUT mutating, so the route can fail
 * the request rather than half-applying.
 *
 * Insert failures (after validation passes) are logged, not thrown: a room
 * create/update should still succeed if the secondary assignment write fails,
 * matching the route's prior behaviour.
 */
export async function updateClinicianAssignments(
  service: SupabaseClient,
  roomId: string,
  staffAssignmentIds: string[],
  locationId: string,
): Promise<{ ok: boolean }> {
  // Validate BEFORE the destructive delete so a bad id can't wipe existing
  // assignments.
  const valid = await assertStaffAssignmentsInLocation(
    service,
    staffAssignmentIds,
    locationId,
  );
  if (!valid) return { ok: false };

  await service
    .from("clinician_room_assignments")
    .delete()
    .eq("room_id", roomId);

  if (staffAssignmentIds.length === 0) return { ok: true };

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

  return { ok: true };
}
