"use client";

import { WifiOff, CalendarClock, LogIn } from "lucide-react";
import { StatusBadge } from "@/components/clinic/shared/status-badge";
import { ActionButton } from "./action-button";
import { Tooltip } from "@/components/ui/tooltip";
import { getRowBorderColor } from "@/lib/runsheet/derived-state";
import { resolveSessionTime, formatPatientName } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/types/domain";

interface SessionRowProps {
  session: EnrichedSession;
  onAction: (sessionId: string, action: string) => void;
  onClick?: (sessionId: string) => void;
  onPatientClick?: (sessionId: string) => void;
}

export function SessionRow({ session, onAction, onClick, onPatientClick }: SessionRowProps) {
  const borderColor = getRowBorderColor(session.derived_state);
  const isDone = session.derived_state === "done";
  const isActive =
    session.derived_state === "in_session" ||
    session.derived_state === "running_over" ||
    session.derived_state === "waiting" ||
    session.derived_state === "checked_in";
  const activeBg = isActive ? "bg-teal-50/40" : "";
  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name,
    session.phone_number
  );
  const { text: time, source: timeSource } = resolveSessionTime(session);

  return (
    <div
      className={`grid grid-cols-[100px_160px_28px_120px_120px_1fr_auto_auto] items-center border-b border-gray-200 last:border-b-0 border-l-[3px] ${borderColor} ${activeBg} transition-colors ${isDone ? "opacity-40" : ""} ${onClick ? "cursor-pointer hover:bg-gray-50/50" : ""}`}
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
      {/* Time column — full height, flush against left border. Icon signals
          whether the time is a scheduled appointment or an on-demand join. */}
      <span className="self-stretch flex items-center justify-center gap-1 text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A] h-12">
        {timeSource === "scheduled" && (
          <Tooltip content="Scheduled appointment">
            <CalendarClock size={12} className="text-gray-400 flex-shrink-0" />
          </Tooltip>
        )}
        {timeSource === "joined" && (
          <Tooltip content="On-demand — joined the waiting room at this time">
            <LogIn size={12} className="text-teal-500 flex-shrink-0" />
          </Tooltip>
        )}
        {time ?? "--:--"}
      </span>

      {/* Patient name column */}
      <div className="flex items-center min-w-0 pl-5 pr-2">
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
      </div>

      {/* Disconnect indicator column — reserves width on every row so the
          status column stays aligned whether or not the icon shows. */}
      <div className="flex items-center justify-center">
        {session.patient_disconnected && (
          <Tooltip content="Patient disconnected">
            <span className="flex-shrink-0 inline-flex items-center text-amber-500">
              <WifiOff size={14} />
            </span>
          </Tooltip>
        )}
      </div>

      {/* Status column */}
      <div className="flex items-center min-w-0 px-2">
        <StatusBadge state={session.derived_state} className="flex-shrink-0" />
      </div>

      {/* Appointment type column */}
      <div className="flex items-center min-w-0 px-2">
        {session.type_name && (
          <span className="text-xs text-gray-500 truncate leading-none">
            {session.type_name}
          </span>
        )}
      </div>

      {/* Flexible spacer — absorbs leftover width so columns pack left and
          the card + action cluster stays right-aligned. */}
      <div />

      {/* Card column */}
      <div className="flex items-center justify-center px-3">
        <CardIndicator hasCard={session.has_card_on_file} />
      </div>

      {/* Action column */}
      <div className="flex items-center justify-end pr-5 pl-3">
        <ActionButton
          state={session.derived_state}
          modality={session.modality}
          sessionId={session.session_id}
          onAction={onAction}
        />
      </div>
    </div>
  );
}

function CardIndicator({ hasCard }: { hasCard: boolean }) {
  if (hasCard) {
    return (
      <Tooltip content="Card on file">
        <span className="flex-shrink-0 inline-flex items-center">
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
