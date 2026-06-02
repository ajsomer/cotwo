import { createServiceClient } from '@/lib/supabase/service';
import { WaitingRoomClient } from './waiting-room-client';

/** Unwrap a Supabase embedded relation (object or single-element array). */
function rel<T = Record<string, unknown>>(value: unknown): T {
  if (Array.isArray(value)) return (value[0] ?? {}) as T;
  return (value ?? {}) as T;
}

type OrgRel = { name: string; logo_url: string | null };
type LocationRel = { id: string; organisations: unknown };
type RoomRel = { name: string; locations: unknown };
type AppointmentRel = {
  scheduled_at: string | null;
  users: { full_name: string | null } | { full_name: string | null }[] | null;
};

export default async function WaitingRoomPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = createServiceClient();

  // Resolve session by entry_token
  const { data: session } = await supabase
    .from('sessions')
    .select(`
      id, status, entry_token, is_onboarding_demo,
      rooms!inner (id, name,
        locations!inner (id, name,
          organisations!inner (id, name, logo_url)
        )
      ),
      appointments!left (scheduled_at,
        users!left (full_name)
      )
    `)
    .eq('entry_token', token)
    .single();

  if (!session) {
    return (
      <div className="mx-auto w-full max-w-[420px]">
        <div className="flex flex-col items-center py-12 text-center">
          <h1 className="text-xl font-semibold text-gray-800">
            Session not found
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            This waiting room link is no longer valid.
          </p>
        </div>
      </div>
    );
  }

  const room = rel<RoomRel>(session.rooms);
  const location = rel<LocationRel>(room.locations);
  const org = rel<OrgRel>(location.organisations);
  const appointment = rel<AppointmentRel>(session.appointments);
  const clinician = rel<{ full_name: string | null }>(appointment.users);

  return (
    <div className="mx-auto w-full max-w-[420px]">
    <WaitingRoomClient
      sessionId={session.id}
      locationId={location.id}
      entryToken={token}
      clinicName={org.name}
      logoUrl={org.logo_url}
      roomName={room.name}
      clinicianName={clinician.full_name || null}
      scheduledAt={appointment.scheduled_at || null}
      isOnboardingDemo={session.is_onboarding_demo ?? false}
    />
    </div>
  );
}
