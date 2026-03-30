import { createClient } from "@/lib/supabase/server";
import { fetchRunsheetSessions, fetchLocationRooms, fetchClinicianRoomIds } from "@/lib/runsheet/queries";
import { RunsheetShell } from "@/components/clinic/runsheet-shell";
import type { UserRole } from "@/lib/supabase/types";

// Hardcoded defaults for prototype (no auth)
const DEFAULT_LOCATION_ID = "00000000-0000-0000-0000-000000000010";
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000001001";
const DEFAULT_ROLE: UserRole = "receptionist";
const DEFAULT_LOCATION_NAME = "Bondi Junction Clinic";
const DEFAULT_TIMEZONE = "Australia/Sydney";

export default async function RunSheetPage() {
  const supabase = await createClient();

  // Try to get authenticated user, fall back to prototype defaults
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let locationId = DEFAULT_LOCATION_ID;
  let locationName = DEFAULT_LOCATION_NAME;
  let timezone = DEFAULT_TIMEZONE;
  let role: UserRole = DEFAULT_ROLE;
  let userId = user?.id ?? DEFAULT_USER_ID;
  let clinicianRoomIds: string[] | undefined;

  // If authenticated, resolve from staff_assignments
  if (user) {
    const { data: assignment } = await supabase
      .from("staff_assignments")
      .select(
        `
        role,
        location_id,
        locations!inner (
          name,
          timezone
        )
      `
      )
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (assignment) {
      const loc = assignment.locations as unknown as Record<string, unknown>;
      role = assignment.role as UserRole;
      locationId = assignment.location_id;
      locationName = loc.name as string;
      timezone = loc.timezone as string;
      userId = user.id;
    }
  }

  // Fetch data in parallel
  const [sessions, rooms] = await Promise.all([
    fetchRunsheetSessions(locationId),
    fetchLocationRooms(locationId),
  ]);

  // For clinicians, also fetch their assigned room IDs
  if (role === "clinician") {
    clinicianRoomIds = await fetchClinicianRoomIds(userId, locationId);
  }

  return (
    <RunsheetShell
      initialSessions={sessions}
      rooms={rooms}
      locationId={locationId}
      locationName={locationName}
      timezone={timezone}
      role={role}
      clinicianRoomIds={clinicianRoomIds}
    />
  );
}
