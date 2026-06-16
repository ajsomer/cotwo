import { db } from '@/lib/db';
import {
  sessions as sessionsT,
  rooms as roomsT,
  locations as locationsT,
  organisations as organisationsT,
  appointments as appointmentsT,
  users as usersT,
  staffAssignments,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { EntryContext } from '@/lib/types/domain';
import type { OrgTier, RoomType } from '@/lib/types/domain';
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
      room_payments_enabled: roomsT.paymentsEnabled,
      location_id: locationsT.id,
      location_name: locationsT.name,
      location_stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      org_logo_url: organisationsT.logoUrl,
      org_tier: organisationsT.tier,
      org_stripe_routing: organisationsT.stripeRouting,
      org_payment_provider: organisationsT.paymentProvider,
      org_tyro_provider_number: organisationsT.tyroProviderNumber,
      scheduled_at: appointmentsT.scheduledAt,
      phone_number: appointmentsT.phoneNumber,
      clinician_id: appointmentsT.clinicianId,
      clinician_name: usersT.fullName,
    })
    .from(sessionsT)
    .innerJoin(roomsT, eq(roomsT.id, sessionsT.roomId))
    .innerJoin(locationsT, eq(locationsT.id, roomsT.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .leftJoin(appointmentsT, eq(appointmentsT.id, sessionsT.appointmentId))
    .leftJoin(usersT, eq(usersT.id, appointmentsT.clinicianId))
    .where(eq(sessionsT.entryToken, token))
    .limit(1);

  if (session) {
    const paymentsEnabled = await resolvePaymentsEnabled(
      session.room_payments_enabled,
      session.location_stripe_account_id,
      session.location_id,
      session.org_stripe_routing,
      session.clinician_id,
      session.org_payment_provider,
      session.org_tyro_provider_number
    );

    return {
      entry_type: 'session',
      org: {
        id: session.org_id,
        name: session.org_name,
        logo_url: session.org_logo_url,
        tier: session.org_tier as OrgTier,
      },
      location: {
        id: session.location_id,
        name: session.location_name,
        stripe_account_id: session.location_stripe_account_id,
      },
      room: {
        id: session.room_id,
        name: session.room_name,
        room_type: session.room_type as RoomType,
      },
      session: {
        id: session.id,
        entry_token: session.entry_token ?? '',
        status: session.status,
        appointment_id: session.appointment_id,
        scheduled_at: session.scheduled_at || null,
        phone_number: session.phone_number || null,
        clinician_name: session.clinician_name || null,
      },
      payments_enabled: paymentsEnabled,
    };
  }

  // 2. Check rooms.link_token (on-demand entry)
  const [room] = await db
    .select({
      room_id: roomsT.id,
      room_name: roomsT.name,
      room_type: roomsT.roomType,
      room_payments_enabled: roomsT.paymentsEnabled,
      location_id: locationsT.id,
      location_name: locationsT.name,
      location_stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      org_logo_url: organisationsT.logoUrl,
      org_tier: organisationsT.tier,
      org_stripe_routing: organisationsT.stripeRouting,
      org_payment_provider: organisationsT.paymentProvider,
      org_tyro_provider_number: organisationsT.tyroProviderNumber,
    })
    .from(roomsT)
    .innerJoin(locationsT, eq(locationsT.id, roomsT.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(roomsT.linkToken, token))
    .limit(1);

  if (room) {
    const paymentsEnabled = await resolvePaymentsEnabled(
      room.room_payments_enabled,
      room.location_stripe_account_id,
      room.location_id,
      room.org_stripe_routing,
      null,
      room.org_payment_provider,
      room.org_tyro_provider_number
    );

    return {
      entry_type: 'on_demand',
      org: {
        id: room.org_id,
        name: room.org_name,
        logo_url: room.org_logo_url,
        tier: room.org_tier as OrgTier,
      },
      location: {
        id: room.location_id,
        name: room.location_name,
        stripe_account_id: room.location_stripe_account_id,
      },
      room: {
        id: room.room_id,
        name: room.room_name,
        room_type: room.room_type as RoomType,
      },
      session: null,
      payments_enabled: paymentsEnabled,
    };
  }

  // 3. Check locations.qr_token (QR code — deferred but resolve works)
  const [location] = await db
    .select({
      location_id: locationsT.id,
      location_name: locationsT.name,
      location_stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      org_logo_url: organisationsT.logoUrl,
      org_tier: organisationsT.tier,
      org_payment_provider: organisationsT.paymentProvider,
      org_tyro_provider_number: organisationsT.tyroProviderNumber,
    })
    .from(locationsT)
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(locationsT.qrToken, token))
    .limit(1);

  if (location) {
    return {
      entry_type: 'qr_code',
      org: {
        id: location.org_id,
        name: location.org_name,
        logo_url: location.org_logo_url,
        tier: location.org_tier as OrgTier,
      },
      location: {
        id: location.location_id,
        name: location.location_name,
        stripe_account_id: location.location_stripe_account_id,
      },
      room: null,
      session: null,
      // QR code has no room context yet — fall back to location-level check.
      // Tyro: enabled when the org's Tyro location identifier is configured.
      payments_enabled:
        location.org_payment_provider === 'tyro'
          ? !!location.org_tyro_provider_number
          : !!location.location_stripe_account_id,
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
  roomPaymentsEnabled: boolean,
  locationStripeAccountId: string | null,
  locationId: string,
  stripeRouting: string,
  clinicianId: string | null,
  paymentProvider: string,
  tyroProviderNumber: string | null
): Promise<boolean> {
  // Room has payments disabled — skip regardless
  if (!roomPaymentsEnabled) return false;

  // Tyro: settlement is via the org's Tyro location identifier, not a Stripe
  // Connect account. Payments are enabled when that identifier is configured.
  if (paymentProvider === 'tyro') {
    return !!tyroProviderNumber;
  }

  // Clinic-level routing: check location's Stripe account
  if (stripeRouting === 'location') {
    return !!locationStripeAccountId;
  }

  // Per-clinician routing: check the assigned clinician's Stripe account
  if (stripeRouting === 'clinician' && clinicianId) {
    const [assignment] = await db
      .select({ stripe_account_id: staffAssignments.stripeAccountId })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.userId, clinicianId),
          eq(staffAssignments.locationId, locationId)
        )
      )
      .limit(1);

    return !!assignment?.stripe_account_id;
  }

  // Per-clinician but no clinician assigned (on-demand) — no payment
  return false;
}
