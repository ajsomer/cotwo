"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { markSessionDone } from "@/lib/runsheet/actions";
import { formatPatientName } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/supabase/types";

interface ProcessFlowDoneProps {
  session: EnrichedSession;
  onComplete: () => void;
  onClose: () => void;
  isBulk: boolean;
}

export function ProcessFlowDone({
  session,
  onComplete,
  onClose,
  isBulk,
}: ProcessFlowDoneProps) {
  const hasMarked = useRef(false);

  // Mark session as done on mount
  useEffect(() => {
    if (!hasMarked.current) {
      hasMarked.current = true;
      markSessionDone(session.session_id);
    }
  }, [session.session_id]);

  // Auto-advance for single session processing
  useEffect(() => {
    if (!isBulk) {
      const timer = setTimeout(onClose, 2000);
      return () => clearTimeout(timer);
    }
  }, [isBulk, onClose]);

  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name
  );

  return (
    <div className="p-5 flex flex-col items-center justify-center min-h-[300px] text-center space-y-4">
      {/* Check mark */}
      <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center">
        <svg
          className="h-8 w-8 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      <div>
        <p className="text-base font-semibold text-gray-800">
          Session processed
        </p>
        <p className="text-sm text-gray-500 mt-1">{patientName}</p>
      </div>

      {isBulk ? (
        <Button onClick={onComplete} className="mt-4">
          Next session
        </Button>
      ) : (
        <Button variant="secondary" onClick={onClose} className="mt-4">
          Close
        </Button>
      )}
    </div>
  );
}
