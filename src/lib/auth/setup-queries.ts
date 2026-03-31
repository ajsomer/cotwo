import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type SetupState = "no_org" | "no_rooms" | "complete";

export async function getSetupState(userId: string): Promise<SetupState> {
  const supabase = getServiceClient();

  // Check if user has a staff assignment (meaning they have an org + location)
  const { data: assignments } = await supabase
    .from("staff_assignments")
    .select("id, location_id")
    .eq("user_id", userId)
    .limit(1);

  const assignment = assignments?.[0];

  if (!assignment) return "no_org";

  // Check if their location has rooms
  const { count } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("location_id", assignment.location_id);

  if (!count || count === 0) return "no_rooms";

  return "complete";
}

export function getRedirectForState(state: SetupState): string {
  switch (state) {
    case "no_org":
      return "/setup/clinic";
    case "no_rooms":
      return "/setup/rooms";
    case "complete":
      return "/runsheet";
  }
}
