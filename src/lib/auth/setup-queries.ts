import { db } from "@/lib/db";
import { staffAssignments, rooms as roomsT } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export type SetupState = "no_org" | "no_rooms" | "complete";

export async function getSetupState(userId: string): Promise<SetupState> {
  // Check if user has a staff assignment (meaning they have an org + location)
  const [assignment] = await db
    .select({ id: staffAssignments.id, location_id: staffAssignments.locationId })
    .from(staffAssignments)
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!assignment) return "no_org";

  // Check if their location has rooms
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roomsT)
    .where(eq(roomsT.locationId, assignment.location_id));

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
