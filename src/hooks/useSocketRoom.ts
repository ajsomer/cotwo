'use client';

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@/lib/socket-client';

/**
 * The join-on-connect pattern: run `onConnect` immediately when the socket is
 * already connected, and again on every (re)connect. `onConnect` typically
 * emits a room join and resyncs whatever events were missed while the socket
 * was down. `events` maps additional event names to handlers attached for the
 * effect's lifetime; handlers always see their latest render's closure.
 *
 * Pass `key: null` to deactivate (e.g. while the location is unknown).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SocketEventHandler = (...args: any[]) => void;

export function useSocketRoom(
  key: string | null,
  onConnect: (socket: Socket) => void,
  events?: Record<string, SocketEventHandler>
) {
  // Keep latest callbacks without re-subscribing on every render.
  const onConnectRef = useRef(onConnect);
  const eventsRef = useRef(events);
  useEffect(() => {
    onConnectRef.current = onConnect;
    eventsRef.current = events;
  });

  useEffect(() => {
    if (!key) return;
    const socket = getSocket();

    const handleConnect = () => onConnectRef.current(socket);
    if (socket.connected) handleConnect();
    socket.on('connect', handleConnect);

    // Stable wrappers that dispatch to the latest handlers. Event names are
    // fixed for the lifetime of this key.
    const wrappers = Object.keys(eventsRef.current ?? {}).map((name) => {
      const fn: SocketEventHandler = (...args) =>
        eventsRef.current?.[name]?.(...args);
      socket.on(name, fn);
      return [name, fn] as const;
    });

    return () => {
      socket.off('connect', handleConnect);
      for (const [name, fn] of wrappers) socket.off(name, fn);
    };
  }, [key]);
}
