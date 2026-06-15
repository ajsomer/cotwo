"use client";

import { useCallback, useRef, useState } from "react";
import { useSocketRoom } from "@/hooks/useSocketRoom";
import { useRole } from "@/hooks/useRole";
import type { IncomingCallMatch } from "@/lib/realtime/broadcast";

/**
 * Subscribes to the location's `incoming_call` / `call_ended` socket events
 * (call-pop test trigger) and turns them into a single "what to pop" state for
 * the run sheet. Owns all the call-pop logic so the run-sheet shell only has to
 * render the result.
 *
 *  - Filters on `userId`: the event is location-scoped (everyone in the room
 *    receives it) but only the configured demo-target user should pop. A null
 *    `userId` means "no target" → ignore.
 *  - Tracks the originating `callId` so `call_ended` only closes the card THIS
 *    call opened (a newer pop, or a manual interaction, wins).
 *  - `dismiss()` lets the UI clear the pop on manual close.
 */

export interface CallPop {
  callId: string;
  match: IncomingCallMatch;
}

export function useCallPop(locationId: string | null) {
  const { userId } = useRole();
  const [pop, setPop] = useState<CallPop | null>(null);
  // The callId currently shown — so call_ended for a stale call is ignored.
  const activeCallIdRef = useRef<string | null>(null);

  const dismiss = useCallback(() => {
    activeCallIdRef.current = null;
    setPop(null);
  }, []);

  useSocketRoom(
    locationId,
    () => {
      // Joining the location room is handled by ClinicDataProvider; nothing to
      // do on (re)connect here — call events are fire-and-forget pops.
    },
    {
      incoming_call: (payload: {
        userId: string | null;
        callId: string;
        match: IncomingCallMatch;
      }) => {
        // Only pop on the configured demo target's screen.
        if (!payload.userId || payload.userId !== userId) return;
        activeCallIdRef.current = payload.callId;
        setPop({ callId: payload.callId, match: payload.match });
      },
      call_ended: (payload: { callId: string }) => {
        // Close only if this is the call we're showing.
        if (activeCallIdRef.current && payload.callId === activeCallIdRef.current) {
          activeCallIdRef.current = null;
          setPop(null);
        }
      },
    }
  );

  return { pop, dismiss };
}
