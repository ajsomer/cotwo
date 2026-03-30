"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@/components/ui/tooltip";
import { SessionRow } from "./session-row";
import {
  getRoomExpansionState,
  getAttentionSessions,
  type RoomExpansionState,
} from "@/lib/runsheet/grouping";
import type { RoomGroup } from "@/lib/supabase/types";

// Distinct background colours for room avatars from the Coviu palette
const AVATAR_COLORS = [
  "bg-teal-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-red-400",
  "bg-green-500",
  "bg-purple-500",
];

function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(/[\s']+/)
    .filter((w) => w.length > 0 && w[0] !== "(")
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

interface RoomContainerProps {
  group: RoomGroup;
  roomIndex: number;
  onAction: (sessionId: string, action: string) => void;
  onSessionClick?: (sessionId: string) => void;
  singleRoom?: boolean;
}

export function RoomContainer({
  group,
  roomIndex,
  onAction,
  onSessionClick,
  singleRoom = false,
}: RoomContainerProps) {
  const autoState = getRoomExpansionState(group.sessions);
  const [expansion, setExpansion] = useState<RoomExpansionState>(autoState);
  const [manualOverride, setManualOverride] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

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

  const handleSendLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      console.log("Send session link for room:", group.room_name);
    },
    [group.room_name]
  );

  const handleRoomSettings = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.location.href = "/settings/rooms";
  }, []);

  const attentionSessions = getAttentionSessions(group.sessions);

  const visibleSessions =
    expansion === "collapsed"
      ? []
      : expansion === "auto-expanded"
        ? attentionSessions
        : group.sessions;

  const hiddenCount =
    expansion === "auto-expanded"
      ? group.sessions.length - attentionSessions.length
      : 0;

  const initials = getInitials(group.room_name);
  const avatarColor = getAvatarColor(roomIndex);

  // Single-room clinician view: always expanded, no header
  if (singleRoom) {
    return (
      <div className="bg-white rounded-xl border border-gray-200">
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
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-200 transition-colors">
        {/* Clickable expand/collapse area */}
        <button
          onClick={toggleExpansion}
          className="flex items-center gap-3 flex-1 min-w-0"
          aria-expanded={expansion !== "collapsed"}
        >
          {/* Chevron */}
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform flex-shrink-0 ${
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
          <span className="text-lg font-semibold text-gray-800 truncate">
            {group.room_name}
          </span>
        </button>

        {/* Traffic lights */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <TrafficLight
            count={group.counts.late}
            activeColor="bg-red-500"
            tooltip={`${group.counts.late} late`}
          />
          <TrafficLight
            count={group.counts.upcoming + group.counts.waiting}
            activeColor="bg-amber-500/80"
            tooltip={`${group.counts.upcoming + group.counts.waiting} waiting`}
          />
          <TrafficLight
            count={group.counts.active}
            activeColor="bg-teal-500/60"
            tooltip={`${group.counts.active} in session`}
          />
          <TrafficLight
            count={group.counts.total}
            activeColor="bg-gray-500"
            tooltip={`${group.counts.total} total`}
            alwaysActive
          />
        </div>

        {/* Kebab menu */}
        <div className="flex items-center flex-shrink-0" ref={menuRef}>
          <Tooltip content="Room actions">
            <button
              ref={kebabRef}
              onClick={(e) => {
                e.stopPropagation();
                if (kebabRef.current) {
                  const rect = kebabRef.current.getBoundingClientRect();
                  setMenuCoords({ x: rect.right, y: rect.bottom });
                }
                setMenuOpen((prev) => !prev);
              }}
              className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-md hover:bg-gray-100"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
          </Tooltip>

          {menuOpen &&
            createPortal(
              <div
                className="fixed z-[9999] w-44 bg-white rounded-lg border border-gray-200 shadow-lg py-1"
                style={{ top: menuCoords.y + 4, left: menuCoords.x - 176 }}
              >
                <button
                  onClick={(e) => {
                    handleSendLink(e);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Send room link
                </button>
                <button
                  onClick={(e) => {
                    handleCopyLink(e);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copied ? "Copied!" : "Copy room link"}
                </button>
                <button
                  onClick={(e) => {
                    handleRoomSettings(e);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Room settings
                </button>
              </div>,
              document.body
            )}
        </div>
      </div>

      {/* Session rows */}
      {visibleSessions.length > 0 && (
        <div>
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

      {/* Show all / Show less toggle */}
      {expansion === "auto-expanded" && hiddenCount > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setManualOverride(true);
            setExpansion("fully-expanded");
          }}
          className="w-full px-6 py-1.5 text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
        >
          Show all ({group.counts.total} sessions)
        </button>
      )}
      {expansion === "fully-expanded" && attentionSessions.length > 0 && attentionSessions.length < group.sessions.length && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setManualOverride(true);
            setExpansion("auto-expanded");
          }}
          className="w-full px-6 py-1.5 text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
        >
          Show less
        </button>
      )}

      {/* Empty state */}
      {expansion !== "collapsed" && group.sessions.length === 0 && (
        <p className="p-4 text-center text-sm text-gray-500 border-t border-gray-200">
          No sessions
        </p>
      )}
    </div>
  );
}

function TrafficLight({
  count,
  activeColor,
  tooltip,
  alwaysActive = false,
}: {
  count: number;
  activeColor: string;
  tooltip: string;
  alwaysActive?: boolean;
}) {
  const isActive = alwaysActive || count > 0;

  return (
    <Tooltip content={tooltip}>
      <span
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold flex-shrink-0 ${
          isActive
            ? `${activeColor} text-white`
            : "border border-gray-200 text-transparent"
        }`}
      >
        {isActive ? count : "0"}
      </span>
    </Tooltip>
  );
}
