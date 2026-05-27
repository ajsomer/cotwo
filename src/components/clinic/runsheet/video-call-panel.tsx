"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LiveKitRoom, VideoConference } from "@/lib/livekit/client";
import { markSessionComplete } from "@/lib/runsheet/actions";

interface VideoCallPanelProps {
  sessionId: string;
  patientName: string;
  onClose: () => void;
}

type ConnectionState = "loading" | "ready" | "error";

interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
}

/**
 * Full-screen modal overlay the clinician sees while on a video call.
 *
 * When the clinician clicks Leave (built-in LiveKit button), we show a
 * confirmation modal with two choices:
 *   - Hold — close the panel, session stays in_session. Clinician can
 *     Rejoin from the run sheet.
 *   - End session — markSessionComplete(), session → complete.
 *
 * If the token fetch fails, we show an error state with a Close button
 * (equivalent to Hold — session stays live if it was).
 */
export function VideoCallPanel({
  sessionId,
  patientName,
  onClose,
}: VideoCallPanelProps) {
  const [state, setState] = useState<ConnectionState>("loading");
  const [connection, setConnection] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When true, the user clicked Leave in LiveKit and we're showing the
  // Hold-vs-End confirmation modal instead of immediately ending.
  const [showEndModal, setShowEndModal] = useState(false);
  const [ending, setEnding] = useState(false);
  // Distinguishes intentional Hold/End from unmount-triggered disconnects.
  const intentionalRef = useRef(false);

  // Fetch token on mount.
  useEffect(() => {
    let cancelled = false;

    async function fetchToken() {
      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
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
  }, [sessionId]);

  const handleDisconnected = useCallback(() => {
    // Fires when LiveKit disconnects (Leave button, unmount, network drop).
    // If we already handled it intentionally (Hold/End), skip.
    if (intentionalRef.current) return;
    // Show the confirmation modal so the clinician chooses Hold or End.
    setShowEndModal(true);
  }, []);

  const handleHold = useCallback(() => {
    // Hold — close the panel but leave the session in_session.
    intentionalRef.current = true;
    onClose();
  }, [onClose]);

  const handleEnd = useCallback(async () => {
    setEnding(true);
    intentionalRef.current = true;
    const result = await markSessionComplete(sessionId);
    if (!result.success) {
      setError(result.error || "Failed to end session");
      setEnding(false);
      return;
    }
    onClose();
  }, [sessionId, onClose]);

  // Render into document.body so the panel escapes the clinic layout padding.
  const content = (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-900">
      {/* Video area */}
      <div className="flex-1 relative">
        {state === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white">
            <div className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-4" />
            <p className="text-sm text-gray-300">Connecting to {patientName}…</p>
          </div>
        )}

        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white px-6">
            <div className="h-12 w-12 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <span className="text-red-400 text-xl">!</span>
            </div>
            <h2 className="text-lg font-semibold mb-2">Video connection failed</h2>
            <p className="text-sm text-gray-400 max-w-sm">
              {error ?? "Something went wrong connecting to the video room."}
            </p>
            <p className="text-xs text-gray-500 mt-3">
              The appointment is still active — close this panel and try Rejoin.
            </p>
            <button
              onClick={handleHold}
              className="mt-6 px-4 py-2 rounded-lg bg-gray-800 text-sm text-white hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {state === "ready" && connection && !showEndModal && (
          <LiveKitRoom
            token={connection.token}
            serverUrl={connection.url}
            connect={true}
            video={true}
            audio={true}
            onDisconnected={handleDisconnected}
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

        {/* Hold vs End confirmation — shown after clinician clicks Leave */}
        {showEndModal && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
            <div className="w-full max-w-sm mx-4 rounded-xl bg-gray-800 border border-gray-700 p-6 text-center space-y-4">
              <h2 className="text-lg font-semibold text-white">
                End session with {patientName}?
              </h2>
              <p className="text-sm text-gray-400">
                Hold keeps the session active so you can rejoin. End will complete the session.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleHold}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-600 bg-gray-700 text-sm font-medium text-white hover:bg-gray-600 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="3" height="10" rx="0.5" />
                    <rect x="9" y="3" width="3" height="10" rx="0.5" />
                  </svg>
                  Hold
                </button>
                <button
                  onClick={handleEnd}
                  disabled={ending}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {ending ? "Ending…" : "End session"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Only render portal on client (document exists).
  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
