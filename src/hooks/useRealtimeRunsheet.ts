"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RunsheetSession, SessionStatus } from "@/lib/supabase/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

interface UseRealtimeRunsheetOptions {
  initialSessions: RunsheetSession[];
  locationId: string;
}

interface UseRealtimeRunsheetResult {
  sessions: RunsheetSession[];
  connectionStatus: ConnectionStatus;
}

export function useRealtimeRunsheet({
  initialSessions,
  locationId,
}: UseRealtimeRunsheetOptions): UseRealtimeRunsheetResult {
  const [sessions, setSessions] = useState<RunsheetSession[]>(initialSessions);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Merge a realtime update into the sessions array
  const mergeSession = useCallback(
    (payload: {
      eventType: string;
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      const updated = payload.new;
      const sessionId = updated.id as string;

      setSessions((prev) => {
        // Check if this session belongs to our location
        if (updated.location_id !== locationId) return prev;

        const idx = prev.findIndex((s) => s.session_id === sessionId);
        if (idx === -1 && payload.eventType === "INSERT") {
          // New session — we don't have all joins, so trigger a full refetch
          // For now, add a partial record; the next polling cycle will fill in details
          return prev;
        }

        if (idx === -1) return prev;

        // Update in place
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          status: updated.status as SessionStatus,
          notification_sent: updated.notification_sent as boolean,
          notification_sent_at: updated.notification_sent_at as string | null,
          patient_arrived: updated.patient_arrived as boolean,
          patient_arrived_at: updated.patient_arrived_at as string | null,
          session_started_at: updated.session_started_at as string | null,
          session_ended_at: updated.session_ended_at as string | null,
          video_call_id: updated.video_call_id as string | null,
        };
        return next;
      });
    },
    [locationId]
  );

  // Subscribe to realtime channel
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`runsheet:${locationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sessions",
          filter: `location_id=eq.${locationId}`,
        },
        (payload) => {
          mergeSession(payload as {
            eventType: string;
            new: Record<string, unknown>;
            old: Record<string, unknown>;
          });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          // Clear polling fallback when connected
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setConnectionStatus("disconnected");
          startPollingFallback();
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  // Reset sessions when location changes
  useEffect(() => {
    setSessions(initialSessions);
  }, [initialSessions]);

  // Polling fallback: full refetch every 30s when realtime is down
  const startPollingFallback = useCallback(() => {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/runsheet?locationId=${locationId}&_t=${Date.now()}`
        );
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions);
        }
      } catch {
        // Silent fail, will retry next interval
      }
    }, 30_000);
  }, [locationId]);

  return { sessions, connectionStatus };
}
