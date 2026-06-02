import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchPaymentConfig } from "@/lib/clinic/fetchers/payments";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";

// GET /api/settings/payments?location_id=xxx
// Returns routing mode, location Stripe account, and clinician Stripe statuses
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("location_id");

  if (!locationId) {
    return NextResponse.json(
      { error: "location_id required" },
      { status: 400 }
    );
  }

  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status },
    );
  }

  try {
    const config = await fetchPaymentConfig(locationId);
    if (!config) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }
    return NextResponse.json(config);
  } catch (err) {
    console.error("GET /api/settings/payments error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/settings/payments
// Actions: set_routing, connect_account, disconnect_account
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  const supabase = createServiceClient();

  try {
    switch (action) {
      case "set_routing": {
        const { location_id, routing_mode } = body;
        if (!location_id || !routing_mode) {
          return NextResponse.json(
            { error: "location_id and routing_mode required" },
            { status: 400 }
          );
        }
        if (routing_mode !== "location" && routing_mode !== "clinician") {
          return NextResponse.json(
            { error: "routing_mode must be 'location' or 'clinician'" },
            { status: 400 }
          );
        }

        const routingAccess = await requireStaffLocationAccess(location_id);
        if (!routingAccess.ok) {
          return NextResponse.json(
            { error: routingAccess.status === 401 ? "Unauthorized" : "Forbidden" },
            { status: routingAccess.status },
          );
        }

        // Get org_id from location
        const { data: loc } = await supabase
          .from("locations")
          .select("org_id")
          .eq("id", location_id)
          .single();

        if (!loc) {
          return NextResponse.json(
            { error: "Location not found" },
            { status: 404 }
          );
        }

        const { error } = await supabase
          .from("organisations")
          .update({ stripe_routing: routing_mode })
          .eq("id", loc.org_id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case "connect_account": {
        const { target, location_id, staff_assignment_id } = body;

        // Generate a test Stripe account ID for the prototype
        const testAccountId = `acct_test_${crypto.randomUUID().slice(0, 8)}`;

        if (target === "location") {
          if (!location_id) {
            return NextResponse.json(
              { error: "location_id required" },
              { status: 400 }
            );
          }

          const connectAccess = await requireStaffLocationAccess(location_id);
          if (!connectAccess.ok) {
            return NextResponse.json(
              { error: connectAccess.status === 401 ? "Unauthorized" : "Forbidden" },
              { status: connectAccess.status },
            );
          }

          const { error } = await supabase
            .from("locations")
            .update({ stripe_account_id: testAccountId })
            .eq("id", location_id);

          if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
          }

          return NextResponse.json({
            success: true,
            stripe_account_id: testAccountId,
          });
        }

        if (target === "clinician") {
          if (!staff_assignment_id) {
            return NextResponse.json(
              { error: "staff_assignment_id required" },
              { status: 400 }
            );
          }

          const saAccess = await requireStaffAssignmentLocationAccess(
            supabase,
            staff_assignment_id,
          );
          if (!saAccess.ok) return saAccess.response;

          const { error } = await supabase
            .from("staff_assignments")
            .update({ stripe_account_id: testAccountId })
            .eq("id", staff_assignment_id);

          if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
          }

          return NextResponse.json({
            success: true,
            stripe_account_id: testAccountId,
          });
        }

        return NextResponse.json(
          { error: "target must be 'location' or 'clinician'" },
          { status: 400 }
        );
      }

      case "disconnect_account": {
        const { target, location_id, staff_assignment_id } = body;

        if (target === "location") {
          if (!location_id) {
            return NextResponse.json(
              { error: "location_id required" },
              { status: 400 }
            );
          }

          const disconnectAccess = await requireStaffLocationAccess(location_id);
          if (!disconnectAccess.ok) {
            return NextResponse.json(
              { error: disconnectAccess.status === 401 ? "Unauthorized" : "Forbidden" },
              { status: disconnectAccess.status },
            );
          }

          const { error } = await supabase
            .from("locations")
            .update({ stripe_account_id: null })
            .eq("id", location_id);

          if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
          }

          return NextResponse.json({ success: true });
        }

        if (target === "clinician") {
          if (!staff_assignment_id) {
            return NextResponse.json(
              { error: "staff_assignment_id required" },
              { status: 400 }
            );
          }

          const saAccess = await requireStaffAssignmentLocationAccess(
            supabase,
            staff_assignment_id,
          );
          if (!saAccess.ok) return saAccess.response;

          const { error } = await supabase
            .from("staff_assignments")
            .update({ stripe_account_id: null })
            .eq("id", staff_assignment_id);

          if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
          }

          return NextResponse.json({ success: true });
        }

        return NextResponse.json(
          { error: "target must be 'location' or 'clinician'" },
          { status: 400 }
        );
      }

      default:
        return NextResponse.json(
          { error: "Unknown action. Use: set_routing, connect_account, disconnect_account" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("PATCH /api/settings/payments error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Clinician-target payment actions key on staff_assignment_id, not location_id.
// Resolve the assignment's location with the service client, then run the
// standard location gate so the caller must be staff at that location.
async function requireStaffAssignmentLocationAccess(
  supabase: ReturnType<typeof createServiceClient>,
  staffAssignmentId: string,
): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const { data: assignment } = await supabase
    .from("staff_assignments")
    .select("location_id")
    .eq("id", staffAssignmentId)
    .maybeSingle();

  if (!assignment) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Staff assignment not found" },
        { status: 404 },
      ),
    };
  }

  const access = await requireStaffLocationAccess(assignment.location_id);
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: access.status },
      ),
    };
  }

  return { ok: true };
}
