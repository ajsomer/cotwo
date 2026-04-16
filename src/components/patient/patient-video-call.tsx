"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LiveKitRoom, VideoConference } from "@/lib/livekit/client";

interface PatientVideoCallProps {
  entryToken: string;
  clinicianName: string | null;
}

type ConnectionState = "loading" | "ready" | "error";

interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
}

/**
 * Patient's side of the video call. Auto-joins as soon as the session moves
 * to in_session — no Join Call button. Renders full-viewport via portal so
 * it escapes the 420px patient flow container.
 *
 * When the clinician hangs up:
 *   - Session transitions to `complete` on the server.
 *   - Realtime subscription in the parent (WaitingRoom) picks that up.
 *   - This component unmounts and the parent shows the "Appointment complete"
 *     screen.
 *
 * We don't mark anything on the server when the patient's LiveKit connection
 * drops — patient disconnections don't end the session, they just temporarily
 * leave the room. The clinician still sees them as `patient_disconnected` via
 * presence.
 */
export function PatientVideoCall({ entryToken, clinicianName }: PatientVideoCallProps) {
  const [state, setState] = useState<ConnectionState>("loading");
  const [connection, setConnection] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchToken() {
      try {
        const res = await fetch("/api/patient/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryToken }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Token request failed (${res.status})`);
        }

        const data = (await res.json()) as TokenResponse;
        if (!cancelled) {
          setConnection(data);
          setState("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unknown error");
          setState("error");
        }
      }
    }

    fetchToken();
    return () => {
      cancelled = true;
    };
  }, [entryToken]);

  const content = (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-900">
      {state === "loading" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white px-6">
          <div className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-4" />
          <p className="text-sm text-gray-300">
            {clinicianName ? `Connecting to ${clinicianName}…` : "Connecting…"}
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white px-6">
          <div className="h-12 w-12 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold mb-2">Couldn&apos;t connect</h2>
          <p className="text-sm text-gray-400 max-w-sm">
            {error ?? "Something went wrong connecting to your appointment."}
          </p>
          <p className="text-xs text-gray-500 mt-3">
            Please refresh this page to try again.
          </p>
        </div>
      )}

      {state === "ready" && connection && (
        <LiveKitRoom
          token={connection.token}
          serverUrl={connection.url}
          connect={true}
          video={true}
          audio={true}
          onError={(e) => {
            setError(e.message);
            setState("error");
          }}
          data-lk-theme="default"
          className="h-full"
        >
          <VideoConference />
        </LiveKitRoom>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
