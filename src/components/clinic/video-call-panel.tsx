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
 * Two ways out:
 *   - Leave (built-in LiveKit control bar button) → fires onDisconnected →
 *     markSessionComplete() → session → complete. Panel closes.
 *   - Hold (our top-bar button) → panel closes, session stays in_session.
 *     Anyone with visibility of the row can Rejoin from the run sheet.
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
  // Distinguishes "Leave button → complete session" from "Hold button / unmount
  // → just disconnect". Set before Hold so the disconnect handler is a no-op.
  const holdingRef = useRef(false);

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

  const handleDisconnected = useCallback(async () => {
    // Fires on Leave (built-in LiveKit button), Hold (we set holdingRef),
    // and on unmount (LiveKit disconnects in its cleanup). We only treat
    // this as a hang up when holdingRef is false.
    if (holdingRef.current) return;
    const result = await markSessionComplete(sessionId);
    if (!result.success) {
      setError(result.error || "Failed to end session");
      return;
    }
    onClose();
  }, [sessionId, onClose]);

  const handleHold = useCallback(() => {
    // Hold — close the panel but leave the session in_session. Setting the ref
    // first tells handleDisconnected (which fires on LiveKitRoom unmount) to
    // do nothing.
    holdingRef.current = true;
    onClose();
  }, [onClose]);

  // Render into document.body so the panel escapes the clinic layout padding.
  const content = (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-900">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="text-sm font-medium text-white">
            In session with {patientName}
          </span>
        </div>
        <button
          onClick={handleHold}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          aria-label="Hold — keep the session active and close this panel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="3" height="10" rx="0.5" />
            <rect x="9" y="3" width="3" height="10" rx="0.5" />
          </svg>
          Hold
        </button>
      </div>

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

        {state === "ready" && connection && (
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
      </div>
    </div>
  );

  // Only render portal on client (document exists).
  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
