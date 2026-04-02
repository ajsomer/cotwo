import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { EntryContext } from '@/lib/supabase/types';

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
    const room = session.rooms as any;
    const location = room.locations as any;
    const org = location.organisations as any;
    const appointment = session.appointments as any;

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
        scheduled_at: appointment?.scheduled_at || null,
        phone_number: appointment?.phone_number || null,
        clinician_name: appointment?.users?.full_name || null,
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
    const location = (room as any).locations as any;
    const org = location.organisations as any;

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
    const org = (location as any).organisations as any;

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
