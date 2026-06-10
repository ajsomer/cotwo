import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthenticatedUserId,
  requireStaffLocationAccess,
  resolveDefaultStaffOrg,
} from "@/lib/auth/staff-access";
import { connectPms } from "@/lib/pms/integrations-service";
import { unauthenticatedResponse } from "@/lib/api/route-helpers";

const PM_ROLES = new Set(["clinic_owner", "practice_manager"]);

/**
 * Onboarding-time real PMS connect. Resolves the user's default location
 * (setup flow supplies no scope) and connects via the shared service path
 * (verify → encrypt → seed registration form). Plan §7a.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return unauthenticatedResponse();
  }

  const body = (await request.json().catch(() => ({}))) as {
    provider?: string;
    credentials?: Record<string, string>;
  };
  if (!body.provider || !body.credentials) {
    return NextResponse.json(
      { error: "provider and credentials required" },
      { status: 400 }
    );
  }

  const resolved = await resolveDefaultStaffOrg(userId);
  if (!resolved) {
    return NextResponse.json({ error: "No org found." }, { status: 400 });
  }

  // Connecting (or switching) a PMS is admin-level config — same PM gate as
  // the Settings connection route, so a receptionist/clinician can't
  // re-credential the location's integration post-setup.
  const access = await requireStaffLocationAccess(resolved.locationId);
  if (!access.ok || !PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await connectPms({
    locationId: resolved.locationId,
    provider: body.provider,
    credentials: body.credentials,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
