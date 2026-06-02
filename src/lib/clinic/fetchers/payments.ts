import { cache } from "react";
import { db } from "@/lib/db";
import {
  locations as locationsT,
  organisations as organisationsT,
  staffAssignments,
  users as usersT,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { PaymentsData } from "@/stores/clinic-store";

export const fetchPaymentConfig = cache(async (
  locationId: string
): Promise<PaymentsData | null> => {
  const [location] = await db
    .select({
      id: locationsT.id,
      name: locationsT.name,
      stripe_account_id: locationsT.stripeAccountId,
      org_id: locationsT.orgId,
      stripe_routing: organisationsT.stripeRouting,
    })
    .from(locationsT)
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(locationsT.id, locationId));

  if (!location) {
    console.error("fetchPaymentConfig location error: not found", locationId);
    return null;
  }

  const staffData = await db
    .select({
      id: staffAssignments.id,
      user_id: staffAssignments.userId,
      role: staffAssignments.role,
      stripe_account_id: staffAssignments.stripeAccountId,
      full_name: usersT.fullName,
    })
    .from(staffAssignments)
    .leftJoin(usersT, eq(usersT.id, staffAssignments.userId))
    .where(
      and(
        eq(staffAssignments.locationId, locationId),
        inArray(staffAssignments.role, ["clinician", "clinic_owner"])
      )
    );

  const clinicians = staffData.map((sa) => ({
    staff_assignment_id: sa.id,
    user_id: sa.user_id,
    role: sa.role,
    full_name: sa.full_name ?? "Unknown",
    stripe_account_id: sa.stripe_account_id,
  }));

  return {
    routing_mode: location.stripe_routing,
    location_stripe_account_id: location.stripe_account_id,
    clinicians,
  };
});
