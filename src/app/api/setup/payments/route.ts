import { createServiceClient } from "@/lib/supabase/service";
import { resolveDefaultStaffOrg, getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { skipped } = body as { skipped: boolean };

  const service = createServiceClient();

  // Setup flow: no scope is supplied, so resolve the user's default org.
  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) return NextResponse.json({ error: "No org found." }, { status: 400 });
  const { orgId, locationId } = resolved;

  if (skipped) {
    await service.from("stripe_connections").upsert(
      { org_id: orgId, status: "skipped", stripe_account_id: null },
      { onConflict: "org_id" }
    );
    return NextResponse.json({ ok: true });
  }

  // Stub: generate fake account reference
  const stripeAccountId = `acct_onboarding_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await service.from("stripe_connections").upsert(
    { org_id: orgId, status: "connected", stripe_account_id: stripeAccountId },
    { onConflict: "org_id" }
  );

  await service
    .from("locations")
    .update({ stripe_account_id: stripeAccountId })
    .eq("id", locationId);

  return NextResponse.json({ ok: true, stripe_account_id: stripeAccountId });
}
