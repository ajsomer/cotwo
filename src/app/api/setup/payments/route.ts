import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { skipped } = body as { skipped: boolean };

  const service = createServiceClient();

  const { data: sa } = await service
    .from("staff_assignments")
    .select("location_id, locations!inner(org_id)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!sa) return NextResponse.json({ error: "No org found." }, { status: 400 });
  const orgId = (sa as unknown as { locations: { org_id: string } }).locations.org_id;
  const locationId = sa.location_id;

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
