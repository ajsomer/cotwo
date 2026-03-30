"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { SessionRow } from "./session-row";
import {
  getRoomExpansionState,
  getAttentionSessions,
  type RoomExpansionState,
} from "@/lib/runsheet/grouping";
import type { RoomGroup } from "@/lib/supabase/types";

interface RoomContainerProps {
  group: RoomGroup;
  onAction: (sessionId: string, action: string) => void;
  onSessionClick?: (sessionId: string) => void;
  singleRoom?: boolean;
}

export function RoomContainer({
  group,
  onAction,
  onSessionClick,
  singleRoom = false,
}: RoomContainerProps) {
  const autoState = getRoomExpansionState(group.sessions);
  const [expansion, setExpansion] = useState<RoomExpansionState>(autoState);
  const [showDone, setShowDone] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-evaluate auto-expansion when session states change, unless manually overridden
  useEffect(() => {
    if (!manualOverride) {
      setExpansion(autoState);
    }
  }, [autoState, manualOverride]);

  const toggleExpansion = useCallback(() => {
    setManualOverride(true);
    setExpansion((prev) => {
      if (prev === "collapsed") return "fully-expanded";
      if (prev === "auto-expanded") return "fully-expanded";
      return "collapsed";
    });
  }, []);

  const handleCopyLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const url = `${window.location.origin}/entry/${group.link_token}`;
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [group.link_token]
  );

  const handleSendLink = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("Send session link for room:", group.room_name);
  }, [group.room_name]);

  const handleRoomSettings = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.location.href = "/settings/rooms";
  }, []);

  const attentionSessions = getAttentionSessions(group.sessions);
  const nonDoneSessions = group.sessions.filter(
    (s) => s.derived_state !== "done"
  );
  const doneSessions = group.sessions.filter(
    (s) => s.derived_state === "done"
  );

  const visibleSessions =
    expansion === "collapsed"
      ? []
      : expansion === "auto-expanded"
        ? attentionSessions
        : showDone
          ? group.sessions
          : nonDoneSessions;

  const hiddenCount =
    expansion === "auto-expanded"
      ? group.sessions.length - attentionSessions.length
      : 0;

  // Single-room clinician view: always expanded, no header
  if (singleRoom) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {group.sessions.map((session) => (
          <SessionRow
            key={session.session_id}
            session={session}
            onAction={onAction}
            onClick={onSessionClick}
          />
        ))}
        {group.sessions.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">
            No sessions today
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Room header */}
      <button
        onClick={toggleExpansion}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
        aria-expanded={expansion !== "collapsed"}
      >
        {/* Chevron */}
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform flex-shrink-0 ${
            expansion !== "collapsed" ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5l7 7-7 7"
          />
        </svg>

        {/* Room name */}
        <span className="text-sm font-semibold text-gray-800 truncate">
          {group.room_name}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Room action icons (hover-reveal) */}
        <div className="flex items-center gap-2">
          {/* Settings */}
          <span
            onClick={handleRoomSettings}
            title="Room settings"
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            role="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2" />
              <path d="M8 2.5v1M8 12.5v1M13.5 8h-1M3.5 8h-1M11.9 4.1l-.7.7M4.8 11.2l-.7.7M11.9 11.9l-.7-.7M4.8 4.8l-.7-.7" />
            </svg>
          </span>

          {/* Send link */}
          <span
            onClick={handleSendLink}
            title="Send session link"
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            role="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2L7 9" />
              <path d="M14 2l-4.5 12-2.5-5L2 6.5 14 2z" />
            </svg>
          </span>

          {/* Copy link */}
          <span
            onClick={handleCopyLink}
            title={copied ? "Copied!" : "Copy room link"}
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            role="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M3.5 11H3a1.5 1.5 0 01-1.5-1.5V3A1.5 1.5 0 013 1.5h6.5A1.5 1.5 0 0111 3v.5" />
            </svg>
          </span>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1.5">
          {group.counts.late > 0 && (
            <Badge variant="red">{group.counts.late} late</Badge>
          )}
          {group.counts.waiting > 0 && (
            <Badge variant="amber">{group.counts.waiting} waiting</Badge>
          )}
          {group.counts.active > 0 && (
            <Badge variant="teal">{group.counts.active} active</Badge>
          )}
          {group.counts.complete > 0 && (
            <Badge variant="blue">{group.counts.complete} to process</Badge>
          )}
          <span className="text-xs text-gray-500 ml-1">
            {group.counts.total}
          </span>
        </div>
      </button>

      {/* Session rows */}
      {visibleSessions.length > 0 && (
        <div className="border-t border-gray-200">
          {visibleSessions.map((session) => (
            <SessionRow
              key={session.session_id}
              session={session}
              onAction={onAction}
              onClick={onSessionClick}
            />
          ))}
        </div>
      )}

      {/* Show all toggle (auto-expanded mode) */}
      {expansion === "auto-expanded" && hiddenCount > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setManualOverride(true);
            setExpansion("fully-expanded");
          }}
          className="w-full px-4 py-2 text-xs text-teal-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
        >
          Show all ({group.counts.total} sessions)
        </button>
      )}

      {/* Done sessions toggle (fully-expanded mode) */}
      {expansion === "fully-expanded" && doneSessions.length > 0 && !showDone && (
        <button
          onClick={() => setShowDone(true)}
          className="w-full px-4 py-2 text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
        >
          {doneSessions.length} completed
        </button>
      )}

      {/* Empty state */}
      {expansion !== "collapsed" && group.sessions.length === 0 && (
        <p className="p-4 text-center text-xs text-gray-500 border-t border-gray-200">
          No sessions
        </p>
      )}
    </div>
  );
}
