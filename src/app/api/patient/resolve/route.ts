import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { EntryContext } from '@/lib/supabase/types';
import type { OrgTier, RoomType } from '@/lib/supabase/custom-types';

/**
 * Unwrap a Supabase embedded relation that may arrive as an object or a
 * single-element array, into the caller-declared shape. Avoids `any` casts
 * when walking nested joins (session → room → location → org).
 */
function rel<T = Record<string, unknown>>(value: unknown): T {
  if (Array.isArray(value)) return (value[0] ?? {}) as T;
  return (value ?? {}) as T;
}

type OrgRel = { id: string; name: string; logo_url: string | null; tier: OrgTier };
type LocationRel = {
  id: string;
  name: string;
  stripe_account_id: string | null;
  organisations: unknown;
};
type RoomRel = { id: string; name: string; room_type: RoomType; locations: unknown };
type AppointmentRel = {
  scheduled_at: string | null;
  phone_number: string | null;
  users: { full_name: string | null } | { full_name: string | null }[] | null;
};

/**
 * POST /api/patient/resolve
 * Resolves an entry token to full context (org, location, room, session).
 * Checks sessions.entry_token → rooms.link_token → locations.qr_token in order.
 */
export async function POST(request: NextRequest) {
  const { token } = await request.json();

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1. Check sessions.entry_token (SMS link entry)
  const { data: session } = await supabase
    .from('sessions')
    .select(`
      id, entry_token, status, appointment_id, notification_sent,
      prep_completed, card_captured, device_tested,
      rooms!inner (id, name, room_type,
        locations!inner (id, name, stripe_account_id,
          organisations!inner (id, name, logo_url, tier)
        )
      ),
      appointments!left (scheduled_at, phone_number,
        users!left (full_name)
      )
    `)
    .eq('entry_token', token)
    .single();

  if (session) {
    const room = rel<RoomRel>(session.rooms);
    const location = rel<LocationRel>(room.locations);
    const org = rel<OrgRel>(location.organisations);
    const appointment = rel<AppointmentRel>(session.appointments);
    const clinician = rel<{ full_name: string | null }>(appointment.users);

    const context: EntryContext = {
      entry_type: 'session',
      org: { id: org.id, name: org.name, logo_url: org.logo_url, tier: org.tier },
      location: { id: location.id, name: location.name, stripe_account_id: location.stripe_account_id },
      room: { id: room.id, name: room.name, room_type: room.room_type },
      session: {
        id: session.id,
        entry_token: session.entry_token,
        status: session.status,
        appointment_id: session.appointment_id,
        scheduled_at: appointment.scheduled_at || null,
        phone_number: appointment.phone_number || null,
        clinician_name: clinician.full_name || null,
      },
      payments_enabled: !!location.stripe_account_id,
    };

    return NextResponse.json({ context });
  }

  // 2. Check rooms.link_token (on-demand entry)
  const { data: room } = await supabase
    .from('rooms')
    .select(`
      id, name, room_type,
      locations!inner (id, name, stripe_account_id,
        organisations!inner (id, name, logo_url, tier)
      )
    `)
    .eq('link_token', token)
    .single();

  if (room) {
    const location = rel<LocationRel>((room as { locations: unknown }).locations);
    const org = rel<OrgRel>(location.organisations);

    const context: EntryContext = {
      entry_type: 'on_demand',
      org: { id: org.id, name: org.name, logo_url: org.logo_url, tier: org.tier },
      location: { id: location.id, name: location.name, stripe_account_id: location.stripe_account_id },
      room: { id: room.id, name: room.name, room_type: room.room_type },
      session: null,
      payments_enabled: !!location.stripe_account_id,
    };

    return NextResponse.json({ context });
  }

  // 3. Check locations.qr_token (QR code entry — deferred but resolve works)
  const { data: location } = await supabase
    .from('locations')
    .select(`
      id, name, stripe_account_id,
      organisations!inner (id, name, logo_url, tier)
    `)
    .eq('qr_token', token)
    .single();

  if (location) {
    const org = rel<OrgRel>((location as { organisations: unknown }).organisations);

    const context: EntryContext = {
      entry_type: 'qr_code',
      org: { id: org.id, name: org.name, logo_url: org.logo_url, tier: org.tier },
      location: { id: location.id, name: location.name, stripe_account_id: location.stripe_account_id },
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
