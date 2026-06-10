import { NextResponse, type NextRequest } from "next/server";
import { requireStaffLocationAccess } from "@/lib/auth/staff-access";
import {
  getConnectionForLocation,
  isSyncActive,
} from "@/lib/pms/connection";
import {
  getMappingData,
  saveBusinessMapping,
  savePractitionerMapping,
} from "@/lib/pms/integrations-service";

const PM_ROLES = new Set(["clinic_owner", "practice_manager"]);

/** GET ?locationId= → live PMS resources joined with current mappings. */
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) {
    return NextResponse.json(
      { error: "No active PMS connection." },
      { status: 409 }
    );
  }
  try {
    const data = await getMappingData(connection);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** POST { locationId, kind, ... } → save a single mapping. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const locationId = body.locationId as string | undefined;
  const kind = body.kind as string | undefined;
  if (!locationId || !kind) {
    return NextResponse.json(
      { error: "locationId and kind required" },
      { status: 400 }
    );
  }
  const access = await requireStaffLocationAccess(locationId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  if (!PM_ROLES.has(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const connection = await getConnectionForLocation(locationId);
  if (!connection || !isSyncActive(connection)) {
    return NextResponse.json(
      { error: "No active PMS connection." },
      { status: 409 }
    );
  }

  switch (kind) {
    case "practitioner": {
      // Map the PMS practitioner (appointment-book column) → a Coviu room (§025).
      try {
        await savePractitionerMapping({
          connectionId: connection.id,
          externalId: body.externalId as string,
          roomId: (body.roomId as string | null) ?? null,
        });
      } catch (e) {
        return NextResponse.json(
          { error: (e as Error).message },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }
    case "business": {
      await saveBusinessMapping({
        locationId,
        externalId: (body.externalId as string | null) ?? null,
      });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown mapping kind" }, { status: 400 });
  }
}
