import { db } from "@/lib/db";
import { stripeConnections, locations as locationsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveDefaultStaffOrg, getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { skipped } = body as { skipped: boolean };

  // Setup flow: no scope is supplied, so resolve the user's default org.
  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) return NextResponse.json({ error: "No org found." }, { status: 400 });
  const { orgId, locationId } = resolved;

  if (skipped) {
    await db
      .insert(stripeConnections)
      .values({ orgId, status: "skipped", stripeAccountId: null })
      .onConflictDoUpdate({
        target: stripeConnections.orgId,
        set: { status: "skipped", stripeAccountId: null },
      });
    return NextResponse.json({ ok: true });
  }

  // Stub: generate fake account reference
  const stripeAccountId = `acct_onboarding_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await db
    .insert(stripeConnections)
    .values({ orgId, status: "connected", stripeAccountId })
    .onConflictDoUpdate({
      target: stripeConnections.orgId,
      set: { status: "connected", stripeAccountId },
    });

  await db
    .update(locationsT)
    .set({ stripeAccountId })
    .where(eq(locationsT.id, locationId));

  return NextResponse.json({ ok: true, stripe_account_id: stripeAccountId });
}
