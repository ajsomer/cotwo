"use client";

import { WifiOff } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { ActionButton } from "./action-button";
import { Tooltip } from "@/components/ui/tooltip";
import { getRowBorderColor } from "@/lib/runsheet/derived-state";
import { formatSessionTime, formatPatientName } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/supabase/types";

interface SessionRowProps {
  session: EnrichedSession;
  onAction: (sessionId: string, action: string) => void;
  onClick?: (sessionId: string) => void;
  onPatientClick?: (sessionId: string) => void;
}

export function SessionRow({ session, onAction, onClick, onPatientClick }: SessionRowProps) {
  const borderColor = getRowBorderColor(session.derived_state);
  const isDone = session.derived_state === "done";
  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name,
    session.phone_number
  );
  const time = formatSessionTime(session.scheduled_at);

  return (
    <div
      className={`flex items-stretch border-b border-gray-200 last:border-b-0 border-l-[3px] ${borderColor} transition-colors ${isDone ? "opacity-40" : ""} ${onClick ? "cursor-pointer hover:bg-gray-50/50" : ""}`}
      onClick={() => onClick?.(session.session_id)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(session.session_id);
        }
      }}
    >
      {/* Time column — full height, flush against left border */}
      <span className="flex items-center justify-center w-[94px] flex-shrink-0 text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A]">
        {time}
      </span>

      {/* Single-line content area — fixed height for consistency */}
      <div className="flex items-center flex-1 min-w-0 px-5 h-12">
        {/* Patient name */}
        {session.patient_id && onPatientClick ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPatientClick(session.session_id);
            }}
            className="text-[14px] font-semibold text-gray-800 truncate leading-none hover:underline hover:text-teal-600 transition-colors"
          >
            {patientName}
          </button>
        ) : (
          <span className="text-[14px] font-semibold text-gray-800 truncate leading-none">
            {patientName}
          </span>
        )}

        {/* Card indicator */}
        <CardIndicator hasCard={session.has_card_on_file} />

        <span className="mx-2 text-gray-300 leading-none flex-shrink-0">&middot;</span>

        {/* Status badge */}
        <StatusBadge state={session.derived_state} className="flex-shrink-0" />

        {/* Disconnect indicator */}
        {session.patient_disconnected && (
          <Tooltip content="Patient disconnected">
            <span className="ml-1.5 flex-shrink-0 inline-flex items-center text-amber-500">
              <WifiOff size={14} />
            </span>
          </Tooltip>
        )}

        {/* Appointment type */}
        {session.type_name && (
          <>
            <span className="mx-2 text-gray-300 leading-none flex-shrink-0">&middot;</span>
            <span className="text-xs text-gray-500 truncate flex-shrink min-w-0 leading-none">
              {session.type_name}
            </span>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action button */}
        <div className="ml-2 flex-shrink-0">
          <ActionButton
            state={session.derived_state}
            modality={session.modality}
            sessionId={session.session_id}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}

function CardIndicator({ hasCard }: { hasCard: boolean }) {
  if (hasCard) {
    return (
      <Tooltip content="Card on file">
        <span className="ml-2 flex-shrink-0 inline-flex items-center">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
            <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
            <path d="M1.5 6.5h13" />
            <path d="M4 10h3" />
          </svg>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content="No card stored">
      <span className="ml-2 flex-shrink-0 inline-flex items-center">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
          <path d="M1.5 6.5h13" />
          <path d="M4 10h3" />
          <path d="M13 2L3 14" strokeWidth="1.5" />
        </svg>
      </span>
    </Tooltip>
  );
}
