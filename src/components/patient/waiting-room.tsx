'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { PersistentHeader } from './persistent-header';

interface WaitingRoomProps {
  sessionId: string;
  locationId: string;
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

  // Subscribe to session status changes via Supabase Realtime
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const channel = supabase
      .channel(`presence:location:${locationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newStatus = payload.new.status as SessionStatus;
          setStatus(newStatus);

          if (newStatus === 'in_session') {
            // Clinician admitted the patient — trigger video call
            // In production, this would launch the LiveKit video interface
            console.log('[WAITING] Clinician admitted — launching video call');
          }
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            session_id: sessionId,
            connected_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, locationId]);

  if (status === 'in_session') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={clinicName}
          logoUrl={logoUrl}
          roomName={roomName}
        />
        <div className="w-full space-y-6 text-center">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-teal-50">
            <svg className="h-8 w-8 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">
            Your appointment is starting
          </h1>
          <p className="text-sm text-gray-500">
            {clinicianName ? `${clinicianName} is ready for you.` : 'Your clinician is ready for you.'}
          </p>
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-6">
            <p className="text-sm font-medium text-teal-700">
              Video call would launch here (LiveKit integration)
            </p>
          </div>
        </div>
      </div>
    );
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
