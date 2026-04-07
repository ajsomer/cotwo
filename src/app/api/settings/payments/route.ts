import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  try {
    const supabase = createServiceClient();

    // Get location + org (for stripe_routing)
    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("id, name, stripe_account_id, org_id, organisations!inner (id, stripe_routing)")
      .eq("id", locationId)
      .single();

    if (locError || !location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    const org = (location as any).organisations;

    // Get clinicians + clinic_owners at this location with their Stripe status
    const { data: staffData } = await supabase
      .from("staff_assignments")
      .select("id, user_id, role, stripe_account_id, users ( full_name )")
      .eq("location_id", locationId)
      .in("role", ["clinician", "clinic_owner"]);

    const clinicians = (staffData ?? []).map((sa: any) => ({
      staff_assignment_id: sa.id,
      user_id: sa.user_id,
      role: sa.role,
      full_name: sa.users?.full_name ?? "Unknown",
      stripe_account_id: sa.stripe_account_id,
    }));

    return NextResponse.json({
      routing_mode: org.stripe_routing,
      location_stripe_account_id: location.stripe_account_id,
      clinicians,
    });
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
