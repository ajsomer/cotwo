import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  sessions as sessionsT,
  rooms as roomsT,
  locations as locationsT,
  organisations as organisationsT,
  appointments as appointmentsT,
  users as usersT,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { EntryContext } from '@/lib/types/domain';
import type { OrgTier, RoomType } from '@/lib/types/domain';
import { parseJsonBody } from '@/lib/api/route-helpers';

/**
 * POST /api/patient/resolve
 * Resolves an entry token to full context (org, location, room, session).
 * Checks sessions.entry_token → rooms.link_token → locations.qr_token in order.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<{ token?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const { token } = parsed.body;

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  // 1. Check sessions.entry_token (SMS link entry)
  const [session] = await db
    .select({
      id: sessionsT.id,
      entry_token: sessionsT.entryToken,
      status: sessionsT.status,
      appointment_id: sessionsT.appointmentId,
      room_id: roomsT.id,
      room_name: roomsT.name,
      room_type: roomsT.roomType,
      location_id: locationsT.id,
      location_name: locationsT.name,
      stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      logo_url: organisationsT.logoUrl,
      tier: organisationsT.tier,
      scheduled_at: appointmentsT.scheduledAt,
      phone_number: appointmentsT.phoneNumber,
      clinician_name: usersT.fullName,
    })
    .from(sessionsT)
    .innerJoin(roomsT, eq(roomsT.id, sessionsT.roomId))
    .innerJoin(locationsT, eq(locationsT.id, roomsT.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .leftJoin(appointmentsT, eq(appointmentsT.id, sessionsT.appointmentId))
    .leftJoin(usersT, eq(usersT.id, appointmentsT.clinicianId))
    .where(eq(sessionsT.entryToken, token));

  if (session) {
    const context: EntryContext = {
      entry_type: 'session',
      org: {
        id: session.org_id,
        name: session.org_name,
        logo_url: session.logo_url,
        tier: session.tier as OrgTier,
      },
      location: {
        id: session.location_id,
        name: session.location_name,
        stripe_account_id: session.stripe_account_id,
      },
      room: { id: session.room_id, name: session.room_name, room_type: session.room_type as RoomType },
      session: {
        id: session.id,
        entry_token: session.entry_token ?? '',
        status: session.status,
        appointment_id: session.appointment_id,
        scheduled_at: session.scheduled_at || null,
        phone_number: session.phone_number || null,
        clinician_name: session.clinician_name || null,
      },
      payments_enabled: !!session.stripe_account_id,
    };

    return NextResponse.json({ context });
  }

  // 2. Check rooms.link_token (on-demand entry)
  const [room] = await db
    .select({
      id: roomsT.id,
      name: roomsT.name,
      room_type: roomsT.roomType,
      location_id: locationsT.id,
      location_name: locationsT.name,
      stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      logo_url: organisationsT.logoUrl,
      tier: organisationsT.tier,
    })
    .from(roomsT)
    .innerJoin(locationsT, eq(locationsT.id, roomsT.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(roomsT.linkToken, token));

  if (room) {
    const context: EntryContext = {
      entry_type: 'on_demand',
      org: {
        id: room.org_id,
        name: room.org_name,
        logo_url: room.logo_url,
        tier: room.tier as OrgTier,
      },
      location: {
        id: room.location_id,
        name: room.location_name,
        stripe_account_id: room.stripe_account_id,
      },
      room: { id: room.id, name: room.name, room_type: room.room_type as RoomType },
      session: null,
      payments_enabled: !!room.stripe_account_id,
    };

    return NextResponse.json({ context });
  }

  // 3. Check locations.qr_token (QR code entry — deferred but resolve works)
  const [location] = await db
    .select({
      id: locationsT.id,
      name: locationsT.name,
      stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      logo_url: organisationsT.logoUrl,
      tier: organisationsT.tier,
    })
    .from(locationsT)
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(locationsT.qrToken, token));

  if (location) {
    const context: EntryContext = {
      entry_type: 'qr_code',
      org: {
        id: location.org_id,
        name: location.org_name,
        logo_url: location.logo_url,
        tier: location.tier as OrgTier,
      },
      location: {
        id: location.id,
        name: location.name,
        stripe_account_id: location.stripe_account_id,
      },
      room: null,
      session: null,
      payments_enabled: !!location.stripe_account_id,
    };

    return NextResponse.json({ context });
  }

  // 4. No match
  return NextResponse.json(
    { error: 'This link has expired or is no longer valid.' },
    { status: 404 }
  );
}
