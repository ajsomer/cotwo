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
import { WaitingRoomClient } from './waiting-room-client';

export default async function WaitingRoomPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Resolve session by entry_token, joining room → location → org and
  // (left) appointment → clinician.
  const [session] = await db
    .select({
      id: sessionsT.id,
      status: sessionsT.status,
      is_onboarding_demo: sessionsT.isOnboardingDemo,
      room_name: roomsT.name,
      location_id: locationsT.id,
      org_name: organisationsT.name,
      org_logo_url: organisationsT.logoUrl,
      scheduled_at: appointmentsT.scheduledAt,
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

  return (
    <div className="mx-auto w-full max-w-[420px]">
    <WaitingRoomClient
      sessionId={session.id}
      locationId={session.location_id}
      entryToken={token}
      clinicName={session.org_name}
      logoUrl={session.org_logo_url}
      roomName={session.room_name}
      clinicianName={session.clinician_name || null}
      scheduledAt={session.scheduled_at || null}
      isOnboardingDemo={session.is_onboarding_demo ?? false}
      initialStatus={session.status}
    />
    </div>
  );
}
