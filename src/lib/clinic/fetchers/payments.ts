import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import type { PaymentsData, RoomPayment } from "@/stores/clinic-store";

export const fetchPaymentConfig = cache(async (
  locationId: string
): Promise<PaymentsData | null> => {
  const supabase = createServiceClient();

  const { data: location, error: locError } = await supabase
    .from("locations")
    .select("id, name, stripe_account_id, org_id, organisations!inner (id, stripe_routing)")
    .eq("id", locationId)
    .single();

  if (locError || !location) {
    console.error("fetchPaymentConfig location error:", locError);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = (location as any).organisations;

  const { data: staffData } = await supabase
    .from("staff_assignments")
    .select("id, user_id, role, stripe_account_id, users ( full_name )")
    .eq("location_id", locationId)
    .in("role", ["clinician", "clinic_owner"]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clinicians = (staffData ?? []).map((sa: any) => ({
    staff_assignment_id: sa.id,
    user_id: sa.user_id,
    role: sa.role,
    full_name: sa.users?.full_name ?? "Unknown",
    stripe_account_id: sa.stripe_account_id,
  }));

  return {
    routing_mode: org.stripe_routing,
    location_stripe_account_id: location.stripe_account_id,
    clinicians,
  };
});

export const fetchPaymentRooms = cache(async (
  locationId: string
): Promise<RoomPayment[]> => {
  const supabase = createServiceClient();

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("id, name, room_type, payments_enabled")
    .eq("location_id", locationId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("fetchPaymentRooms error:", error);
    return [];
  }

  return (rooms ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    room_type: r.room_type,
    payments_enabled: r.payments_enabled ?? false,
  }));
});
