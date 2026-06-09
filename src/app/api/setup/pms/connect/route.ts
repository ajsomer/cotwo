import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthenticatedUserId,
  resolveDefaultStaffOrg,
} from "@/lib/auth/staff-access";
import { connectPms } from "@/lib/pms/integrations-service";

/**
 * Onboarding-time real PMS connect. Resolves the user's default location
 * (setup flow supplies no scope) and connects via the shared service path
 * (verify → encrypt → seed registration form). Plan §7a.
 */
export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const result = await connectPms({
    locationId: resolved.locationId,
    provider: body.provider,
    credentials: body.credentials,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
