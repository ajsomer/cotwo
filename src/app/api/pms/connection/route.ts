import { NextResponse, type NextRequest } from "next/server";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import {
  connectPms,
  disconnectPms,
  getIntegrationStatus,
} from "@/lib/pms/integrations-service";

const PM_ROLES = new Set(["clinic_owner", "practice_manager"]);

/** GET ?locationId= → integration status + provider metadata. */
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  const status = await getIntegrationStatus(locationId);
  return NextResponse.json(status);
}

/** POST { locationId, provider, credentials } → connect / re-credential. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    locationId?: string;
    provider?: string;
    credentials?: Record<string, string>;
  };
  if (!body.locationId || !body.provider || !body.credentials) {
    return NextResponse.json(
      { error: "locationId, provider, credentials required" },
      { status: 400 }
    );
  }
  const access = await requireStaffLocationAccess(body.locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  if (!PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await connectPms({
    locationId: body.locationId,
    provider: body.provider,
    credentials: body.credentials,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

/** DELETE ?locationId= → disconnect (clears credentials, keeps mappings). */
export async function DELETE(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  if (!PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await disconnectPms(locationId);
  return NextResponse.json({ ok: true });
}
