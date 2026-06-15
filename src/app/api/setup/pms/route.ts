import {
  PM_ROLES,
  getAuthenticatedUserId,
  requireStaffLocationAccess,
  resolveDefaultStaffOrg,
} from "@/lib/auth/staff-access";
import { NextResponse, type NextRequest } from "next/server";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";
import { clearPmsConnection } from "@/lib/pms/integrations-service";

/**
 * Setup-flow "No PMS" endpoint.
 *
 * This route ONLY handles the clinic choosing no PMS at setup. Real provider
 * connects (Cliniko, Nookal, Gentu) go through /api/setup/pms/connect →
 * connectPms → the registry. The old Gentu "demo simulation" path (seeding fake
 * clinicians/rooms/forms + a credential-less marker) was removed when Gentu
 * became a real registry-backed adapter (plan §1a.1).
 *
 * No-PMS is modelled as NO pms_connections row (plan §1a.2) — we deliberately
 * write nothing. The previous code wrote `provider: "cliniko", status:
 * "skipped"`, which mislabelled no-PMS as skipped Cliniko and leaked into
 * Settings. The setup gate treats a missing connection row as "PMS step
 * satisfied," so the clinic proceeds to room setup.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return unauthenticatedResponse();

  const body = await request.json();
  const { provider } = body as { provider: string | null };

  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) return NextResponse.json({ error: "No org found." }, { status: 400 });
  const { locationId } = resolved;

  // Same PM-role gate as the Settings connection route.
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok || !PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A non-null provider should never reach here — those connect via /connect.
  if (provider != null) {
    return NextResponse.json(
      { error: "Use /api/setup/pms/connect to connect a provider." },
      { status: 400 }
    );
  }

  // No PMS → clear any existing connection state so no-PMS is idempotently
  // "no row" (plan §1a.2). Without this, an old marker/demo/real row would
  // linger and getIntegrationStatus would still report hasConnection:true with
  // that stale provider. No-op on a clean setup.
  await clearPmsConnection(locationId);
  return NextResponse.json({ ok: true });
}
