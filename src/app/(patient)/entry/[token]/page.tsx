import { createServiceClient } from '@/lib/supabase/service';
import { EntryContext } from '@/lib/supabase/types';
import { EntryFlowClient } from './entry-flow-client';

export default async function EntryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const context = await resolveToken(token);

  if (!context) {
    return (
      <div className="mx-auto w-full max-w-[420px]">
        <div className="flex flex-col items-center py-12 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <span className="text-lg text-red-500">!</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">
            Link not found
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            This link has expired or is no longer valid. Please contact your
            clinic for a new link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[420px]">
      <EntryFlowClient context={context} token={token} />
    </div>
  );
}

async function resolveToken(token: string): Promise<EntryContext | null> {
  const supabase = createServiceClient();

  // 1. Check sessions.entry_token (SMS link entry)
  const { data: session } = await supabase
    .from('sessions')
    .select(`
      id, entry_token, status, appointment_id, notification_sent,
      prep_completed, card_captured, device_tested,
      rooms!inner (id, name, room_type, payments_enabled,
        locations!inner (id, name, stripe_account_id,
          organisations!inner (id, name, logo_url, tier, stripe_routing)
        )
      ),
      appointments!left (scheduled_at, phone_number, clinician_id,
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

    const paymentsEnabled = await resolvePaymentsEnabled(
      supabase, room, location, org, appointment?.clinician_id
    );

    return {
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
      payments_enabled: paymentsEnabled,
    };
  }

  // 2. Check rooms.link_token (on-demand entry)
  const { data: room } = await supabase
    .from('rooms')
    .select(`
      id, name, room_type, payments_enabled,
      locations!inner (id, name, stripe_account_id,
        organisations!inner (id, name, logo_url, tier, stripe_routing)
      )
    `)
    .eq('link_token', token)
    .single();

  if (room) {
    const location = (room as any).locations as any;
    const org = location.organisations as any;

    const paymentsEnabled = await resolvePaymentsEnabled(
      supabase, room, location, org, null
    );

    return {
      entry_type: 'on_demand',
      org: { id: org.id, name: org.name, logo_url: org.logo_url, tier: org.tier },
      location: { id: location.id, name: location.name, stripe_account_id: location.stripe_account_id },
      room: { id: room.id, name: room.name, room_type: room.room_type },
      session: null,
      payments_enabled: paymentsEnabled,
    };
  }

  // 3. Check locations.qr_token (QR code — deferred but resolve works)
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

    return {
      entry_type: 'qr_code',
      org: { id: org.id, name: org.name, logo_url: org.logo_url, tier: org.tier },
      location: { id: location.id, name: location.name, stripe_account_id: location.stripe_account_id },
      room: null,
      session: null,
      // QR code has no room context yet — fall back to location-level check
      payments_enabled: !!location.stripe_account_id,
    };
  }

  return null;
}

/**
 * Resolve whether payments are enabled for this entry, considering:
 * 1. Room-level toggle (payments_enabled)
 * 2. Routing mode (clinic vs per-clinician)
 * 3. Whether the relevant Stripe account is connected
 */
async function resolvePaymentsEnabled(
  supabase: any,
  room: any,
  location: any,
  org: any,
  clinicianId: string | null
): Promise<boolean> {
  // Room has payments disabled — skip regardless
  if (!room.payments_enabled) return false;

  // Clinic-level routing: check location's Stripe account
  if (org.stripe_routing === 'location') {
    return !!location.stripe_account_id;
  }

  // Per-clinician routing: check the assigned clinician's Stripe account
  if (org.stripe_routing === 'clinician' && clinicianId) {
    const { data: assignment } = await supabase
      .from('staff_assignments')
      .select('stripe_account_id')
      .eq('user_id', clinicianId)
      .eq('location_id', location.id)
      .single();

    return !!assignment?.stripe_account_id;
  }

  // Per-clinician but no clinician assigned (on-demand) — no payment
  return false;
}
