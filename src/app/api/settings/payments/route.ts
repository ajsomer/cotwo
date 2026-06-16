import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  locations as locationsT,
  organisations as organisationsT,
  staffAssignments,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchPaymentConfig } from "@/lib/clinic/fetchers/payments";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import { denyResponse } from "@/lib/api/route-helpers";

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
    return denyResponse(access);
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
          return denyResponse(routingAccess);
        }

        // Get org_id from location
        const [loc] = await db
          .select({ org_id: locationsT.orgId })
          .from(locationsT)
          .where(eq(locationsT.id, location_id))
          .limit(1);

        if (!loc) {
          return NextResponse.json(
            { error: "Location not found" },
            { status: 404 }
          );
        }

        await db
          .update(organisationsT)
          .set({ stripeRouting: routing_mode })
          .where(eq(organisationsT.id, loc.org_id));

        return NextResponse.json({ success: true });
      }

      case "set_provider": {
        const { location_id, payment_provider, tyro_provider_number } = body;
        if (!location_id || !payment_provider) {
          return NextResponse.json(
            { error: "location_id and payment_provider required" },
            { status: 400 }
          );
        }
        if (!["stripe", "tyro", "console"].includes(payment_provider)) {
          return NextResponse.json(
            { error: "payment_provider must be 'stripe', 'tyro', or 'console'" },
            { status: 400 }
          );
        }

        const providerAccess = await requireStaffLocationAccess(location_id);
        if (!providerAccess.ok) {
          return denyResponse(providerAccess);
        }

        const [loc] = await db
          .select({ org_id: locationsT.orgId })
          .from(locationsT)
          .where(eq(locationsT.id, location_id))
          .limit(1);

        if (!loc) {
          return NextResponse.json({ error: "Location not found" }, { status: 404 });
        }

        await db
          .update(organisationsT)
          .set({
            paymentProvider: payment_provider,
            // Only set when provided; allows updating provider without clearing it.
            ...(tyro_provider_number !== undefined
              ? { tyroProviderNumber: tyro_provider_number || null }
              : {}),
          })
          .where(eq(organisationsT.id, loc.org_id));

        return NextResponse.json({ success: true });
      }

      case "set_tyro_credentials": {
        // Connect a clinic's OWN Tyro business. The clinic pastes only their API
        // key (per-business); we validate it and DERIVE the business id from it
        // (GET /businesses/me). The provider/location number is an optional
        // separate setting.
        const { location_id, tyro_api_key, tyro_provider_number } = body;
        if (!location_id) {
          return NextResponse.json({ error: "location_id required" }, { status: 400 });
        }

        const credAccess = await requireStaffLocationAccess(location_id);
        if (!credAccess.ok) return denyResponse(credAccess);

        const [loc] = await db
          .select({ org_id: locationsT.orgId })
          .from(locationsT)
          .where(eq(locationsT.id, location_id))
          .limit(1);
        if (!loc) {
          return NextResponse.json({ error: "Location not found" }, { status: 404 });
        }

        const update: Record<string, string | null> = {};

        if (tyro_api_key) {
          // Validate the key + derive the business id before storing.
          const { TyroPaymentProvider } = await import("@/lib/payments/tyro");
          const { encryptSecret } = await import("@/lib/payments/credentials");
          try {
            const probe = new TyroPaymentProvider({ apiKey: tyro_api_key, businessId: "" });
            const businessId = await probe.resolveBusinessId();
            update.tyroApiKeyEncrypted = encryptSecret(tyro_api_key);
            update.tyroBusinessId = businessId;
          } catch {
            return NextResponse.json(
              { error: "Invalid Tyro API key — could not connect to Tyro Health." },
              { status: 400 }
            );
          }
        }

        if (tyro_provider_number !== undefined) {
          update.tyroProviderNumber = tyro_provider_number || null;
        }

        await db.update(organisationsT).set(update).where(eq(organisationsT.id, loc.org_id));
        return NextResponse.json({ success: true });
      }

      case "connect_account":
        // Generate a test Stripe account ID for the prototype
        return setStripeAccount(
          body,
          `acct_test_${crypto.randomUUID().slice(0, 8)}`,
        );

      case "disconnect_account":
        return setStripeAccount(body, null);

      default:
        return NextResponse.json(
          { error: "Unknown action. Use: set_routing, set_provider, connect_account, disconnect_account" },
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

// connect_account and disconnect_account are the same write with a different
// value: gate on the target's location, then set/clear the Stripe account id
// on the location (location routing) or the staff assignment (clinician
// routing). `stripeAccountId === null` means disconnect; the connect response
// additionally echoes the new stripe_account_id.
async function setStripeAccount(
  body: {
    target?: string;
    location_id?: string;
    staff_assignment_id?: string;
  },
  stripeAccountId: string | null,
): Promise<NextResponse> {
  const { target, location_id, staff_assignment_id } = body;
  const successBody = stripeAccountId
    ? { success: true, stripe_account_id: stripeAccountId }
    : { success: true };

  if (target === "location") {
    if (!location_id) {
      return NextResponse.json(
        { error: "location_id required" },
        { status: 400 }
      );
    }

    const access = await requireStaffLocationAccess(location_id);
    if (!access.ok) {
      return denyResponse(access);
    }

    await db
      .update(locationsT)
      .set({ stripeAccountId })
      .where(eq(locationsT.id, location_id));

    return NextResponse.json(successBody);
  }

  if (target === "clinician") {
    if (!staff_assignment_id) {
      return NextResponse.json(
        { error: "staff_assignment_id required" },
        { status: 400 }
      );
    }

    const saAccess = await requireStaffAssignmentLocationAccess(
      staff_assignment_id,
    );
    if (!saAccess.ok) return saAccess.response;

    await db
      .update(staffAssignments)
      .set({ stripeAccountId })
      .where(eq(staffAssignments.id, staff_assignment_id));

    return NextResponse.json(successBody);
  }

  return NextResponse.json(
    { error: "target must be 'location' or 'clinician'" },
    { status: 400 }
  );
}

// Clinician-target payment actions key on staff_assignment_id, not location_id.
// Resolve the assignment's location with the service client, then run the
// standard location gate so the caller must be staff at that location.
async function requireStaffAssignmentLocationAccess(
  staffAssignmentId: string,
): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const [assignment] = await db
    .select({ location_id: staffAssignments.locationId })
    .from(staffAssignments)
    .where(eq(staffAssignments.id, staffAssignmentId))
    .limit(1);

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
      response: denyResponse(access),
    };
  }

  return { ok: true };
}
