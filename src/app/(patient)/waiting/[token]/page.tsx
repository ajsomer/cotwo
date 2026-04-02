import { createServiceClient } from '@/lib/supabase/service';
import { WaitingRoomClient } from './waiting-room-client';

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
      id, status, entry_token,
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
      <div className="flex flex-col items-center py-12 text-center">
        <h1 className="text-xl font-semibold text-gray-800">
          Session not found
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          This waiting room link is no longer valid.
        </p>
      </div>
    );
  }

  const room = session.rooms as any;
  const location = room.locations as any;
  const org = location.organisations as any;
  const appointment = session.appointments as any;

  return (
    <WaitingRoomClient
      sessionId={session.id}
      clinicName={org.name}
      logoUrl={org.logo_url}
      roomName={room.name}
      clinicianName={appointment?.users?.full_name || null}
      scheduledAt={appointment?.scheduled_at || null}
    />
  );
}
