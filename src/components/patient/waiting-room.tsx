'use client';

import { useState, useEffect } from 'react';
import { getSocket } from '@/lib/socket-client';
import { PersistentHeader } from './persistent-header';
import { PatientVideoCall } from './patient-video-call';

interface WaitingRoomProps {
  sessionId: string;
  locationId: string;
  entryToken: string;
  clinicName: string;
  logoUrl: string | null;
  roomName: string;
  clinicianName: string | null;
  scheduledAt: string | null;
}

type SessionStatus = 'waiting' | 'in_session' | 'complete' | 'done';

export function WaitingRoom({
  sessionId,
  locationId,
  entryToken,
  clinicName,
  logoUrl,
  roomName,
  clinicianName,
  scheduledAt,
}: WaitingRoomProps) {
  const [status, setStatus] = useState<SessionStatus>('waiting');
  const [message, setMessage] = useState<string | null>(null);
  const [dots, setDots] = useState('');

  // Animate waiting dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 800);
    return () => clearInterval(interval);
  }, []);

  // Claim presence via Socket.IO so clinic clients see this session as
  // connected. Re-emit on every socket connect (including reconnects).
  useEffect(() => {
    const socket = getSocket();
    const track = () => {
      socket.emit('presence:track', { locationId, sessionId });
    };
    if (socket.connected) track();
    socket.on('connect', track);
    return () => {
      socket.off('connect', track);
    };
  }, [sessionId, locationId]);

  // Subscribe to session status changes via Socket.IO. When the clinician
  // flips the session into `in_session`, PatientVideoCall auto-mounts;
  // when they complete, we switch to the "appointment complete" view.
  useEffect(() => {
    const socket = getSocket();
    const joinRoom = () => {
      socket.emit('join:session', sessionId);
    };
    if (socket.connected) joinRoom();
    socket.on('connect', joinRoom);

    const onStatusChanged = (payload: { status: SessionStatus }) => {
      if (payload?.status) setStatus(payload.status);
    };
    socket.on('status_changed', onStatusChanged);

    return () => {
      socket.off('connect', joinRoom);
      socket.off('status_changed', onStatusChanged);
    };
  }, [sessionId]);

  if (status === 'in_session') {
    return <PatientVideoCall entryToken={entryToken} clinicianName={clinicianName} />;
  }

  if (status === 'complete' || status === 'done') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          roomName={roomName}
        />
        <div className="w-full space-y-4 text-center">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-green-50">
            <svg className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">
            Appointment complete
          </h1>
          <p className="text-sm text-gray-500">
            Thank you for visiting {clinicName}. You can close this window.
          </p>
        </div>
      </div>
    );
  }

  // Default: waiting state
  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        roomName={roomName}
      />

      <div className="w-full space-y-6 text-center">
        {/* Waiting animation */}
        <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-teal-50">
          <div className="h-8 w-8 animate-pulse rounded-full bg-teal-500/30" />
        </div>

        <div>
          <h1 className="text-xl font-semibold text-gray-800">
            You&apos;re in the waiting room
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {clinicianName
              ? `${clinicianName} will be with you shortly${dots}`
              : `Your clinician will be with you shortly${dots}`}
          </p>
        </div>

        {/* Scheduled time */}
        {scheduledAt && (
          <div className="rounded-lg bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-400">Appointment time</p>
            <p className="text-sm font-medium text-gray-800">
              {new Date(scheduledAt).toLocaleTimeString('en-AU', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </p>
          </div>
        )}

        {/* Running late message */}
        {message && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-700">{message}</p>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Please keep this page open. You&apos;ll be connected when your
          clinician is ready.
        </p>
      </div>
    </div>
  );
}
