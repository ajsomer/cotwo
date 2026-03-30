"use client";

import { StatusBadge } from "./status-badge";
import { ModalityBadge } from "./modality-badge";
import { ActionButton } from "./action-button";
import { Tooltip } from "@/components/ui/tooltip";
import { getRowBackground } from "@/lib/runsheet/derived-state";
import { formatSessionTime, formatPatientName } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/supabase/types";

interface SessionRowProps {
  session: EnrichedSession;
  onAction: (sessionId: string, action: string) => void;
  onClick?: (sessionId: string) => void;
}

export function SessionRow({ session, onAction, onClick }: SessionRowProps) {
  const bg = getRowBackground(session.derived_state);
  const isDone = session.derived_state === "done";
  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name
  );
  const time = formatSessionTime(session.scheduled_at);

  return (
    <div
      className={`flex items-center px-6 py-1.5 border-b border-gray-200 last:border-b-0 transition-colors ${bg} ${isDone ? "opacity-40" : ""} ${onClick ? "cursor-pointer hover:bg-gray-50/50" : ""}`}
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
      {/* Time */}
      <span className="text-sm text-gray-500 whitespace-nowrap w-[60px] flex-shrink-0 mr-5">
        {time}
      </span>

      {/* Modality badge */}
      <span className="mr-4">
        <ModalityBadge modality={session.modality} />
      </span>

      {/* Patient info: two lines */}
      <div className="flex-1 min-w-0">
        {/* Line 1: Patient name + readiness icons */}
        <div className="flex items-center gap-1.5">
          <span className="text-base font-medium text-gray-800 truncate">
            {patientName}
          </span>
          <ReadinessIcons session={session} />
        </div>
        {/* Line 2: Appointment type */}
        {session.type_name && (
          <p className="text-sm text-gray-500 truncate mt-0.5">
            {session.type_name}
          </p>
        )}
      </div>

      {/* Status badge */}
      <div className="ml-3">
        <StatusBadge state={session.derived_state} />
      </div>

      {/* Action */}
      <div className="ml-2">
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

function ReadinessIcons({ session }: { session: EnrichedSession }) {
  if (session.derived_state === "done" || session.derived_state === "queued") {
    return null;
  }

  return (
    <>
      {session.has_card_on_file ? (
        <Tooltip content="Card on file">
          <span className="flex-shrink-0 leading-none inline-flex">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
              <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
              <path d="M1.5 6.5h13" />
              <path d="M4 10h3" />
            </svg>
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="No card stored">
          <span className="flex-shrink-0 leading-none inline-flex">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
              <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
              <path d="M1.5 6.5h13" />
              <path d="M4 10h3" />
              <path d="M13 2L3 14" strokeWidth="1.5" />
            </svg>
          </span>
        </Tooltip>
      )}
    </>
  );
}
