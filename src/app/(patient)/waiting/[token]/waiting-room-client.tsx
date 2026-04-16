'use client';

import { WaitingRoom } from '@/components/patient/waiting-room';

interface WaitingRoomClientProps {
  sessionId: string;
  locationId: string;
  entryToken: string;
  clinicName: string;
  logoUrl: string | null;
  roomName: string;
  clinicianName: string | null;
  scheduledAt: string | null;
}

export function WaitingRoomClient(props: WaitingRoomClientProps) {
  return <WaitingRoom {...props} />;
}
