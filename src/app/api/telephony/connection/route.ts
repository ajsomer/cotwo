import { NextRequest, NextResponse } from "next/server";
import {
  PM_ROLES,
  requireStaffLocationAccess,
} from "@/lib/auth/staff-access";
import {
  getTelephonyConfig,
  connectTelephony,
  disconnectTelephony,
} from "@/lib/telephony/config-service";
import { parseJsonBody, denyResponse } from "@/lib/api/route-helpers";

/**
 * Settings CRUD for the Twilio call-pop TEST config. Mirrors the PMS connection
 * route's shape: location-scoped, PM-role gated, one shared service underneath.
 *   GET    ?locationId=  → status DTO (never includes the auth token)
 *   POST   { locationId, twilioAccountSid, authToken, twilioPhoneNumber, demoUserId }
 *   DELETE ?locationId=  → turn off + forget credentials
 */

async function gate(locationId: string | null) {
  if (!locationId) {
    return { ok: false as const, response: NextResponse.json({ error: "locationId required" }, { status: 400 }) };
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) return { ok: false as const, response: denyResponse(access) };
  if (!PM_ROLES.has(access.role)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  const g = await gate(locationId);
  if (!g.ok) return g.response;
  return NextResponse.json(await getTelephonyConfig(locationId!));
}

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<{
    locationId?: string;
    twilioAccountSid?: string;
    authToken?: string;
    twilioPhoneNumber?: string;
    demoUserId?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { locationId, twilioAccountSid, authToken, twilioPhoneNumber, demoUserId } = parsed.body;

  const g = await gate(locationId ?? null);
  if (!g.ok) return g.response;

  if (!twilioAccountSid || !authToken || !twilioPhoneNumber || !demoUserId) {
    return NextResponse.json(
      { error: "twilioAccountSid, authToken, twilioPhoneNumber and demoUserId are required" },
      { status: 400 }
    );
  }

  const dto = await connectTelephony({
    locationId: locationId!,
    twilioAccountSid,
    authToken,
    twilioPhoneNumber,
    demoUserId,
  });
  return NextResponse.json(dto);
}

export async function DELETE(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  const g = await gate(locationId);
  if (!g.ok) return g.response;
  await disconnectTelephony(locationId!);
  return NextResponse.json({ ok: true });
}
