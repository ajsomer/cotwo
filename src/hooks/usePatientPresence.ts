"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to patient presence on a location-wide channel.
 * Returns a Set of session IDs for currently connected patients.
 */
export function usePatientPresence(locationId: string): Set<string> {
  const [connectedSessions, setConnectedSessions] = useState<Set<string>>(
    new Set()
  );
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`presence:location:${locationId}`)
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const sessionIds = new Set<string>();
        for (const presences of Object.values(state)) {
          for (const presence of presences as Array<{ session_id?: string }>) {
            if (presence.session_id) {
              sessionIds.add(presence.session_id);
            }
          }
        }
        setConnectedSessions(sessionIds);
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        setConnectedSessions((prev) => {
          const next = new Set(prev);
          for (const presence of newPresences as Array<{
            session_id?: string;
          }>) {
            if (presence.session_id) {
              next.add(presence.session_id);
            }
          }
          return next;
        });
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        setConnectedSessions((prev) => {
          const next = new Set(prev);
          for (const presence of leftPresences as Array<{
            session_id?: string;
          }>) {
            if (presence.session_id) {
              next.delete(presence.session_id);
            }
          }
          return next;
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [locationId]);

  return connectedSessions;
}
