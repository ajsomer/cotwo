"use client";

import type { StandaloneSubmissionRow as StandaloneSubmissionRowType } from "@/stores/clinic-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgoShort } from "./utils";
import { STANDALONE_SOURCE_LABEL } from "./types";

interface StandaloneSubmissionRowProps {
  row: StandaloneSubmissionRowType;
  onPatientClick: () => void;
  onReview: () => void;
}

export function StandaloneSubmissionRow({
  row,
  onPatientClick,
  onReview,
}: StandaloneSubmissionRowProps) {
  const sourceLabel =
    STANDALONE_SOURCE_LABEL[row.submission_source] ?? row.submission_source;

  return (
    <div className="border-b border-gray-200 last:border-b-0">
      <div className="flex items-stretch border-l-[3px] border-l-amber-500 bg-amber-500/[0.03] transition-colors">
        {/* Time column — submission age instead of a scheduled time */}
        <span className="flex items-center justify-center w-[94px] flex-shrink-0 text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A]">
          {timeAgoShort(row.created_at)}
        </span>

        {/* Content */}
        <div className="flex items-center flex-1 min-w-0 px-5 h-12">
          {/* Patient name — clickable, opens the patient contact card */}
          <button
            onClick={onPatientClick}
            className="text-[14px] font-semibold text-gray-800 truncate leading-none hover:underline hover:text-teal-600 transition-colors"
          >
            {row.patient_name}
          </button>
          <span className="mx-2 text-gray-300 leading-none flex-shrink-0">
            &middot;
          </span>
          <span className="text-xs text-gray-500 truncate min-w-0 leading-none">
            {row.form_name}
          </span>
          <span className="mx-2 text-gray-300 leading-none flex-shrink-0">
            &middot;
          </span>
          <span className="text-xs text-gray-400 truncate flex-shrink-0 leading-none">
            Standalone submission · {sourceLabel}
          </span>
          {row.duplicate?.possible_duplicate_patient_name && (
            <>
              <span className="mx-2 text-gray-300 leading-none flex-shrink-0">
                &middot;
              </span>
              <span className="text-xs text-amber-600 truncate flex-shrink-0 leading-none">
                Possible duplicate of {row.duplicate.possible_duplicate_patient_name}
              </span>
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Status badge — matches the Form Completed appointment treatment */}
          <Badge variant="amber" className="flex-shrink-0">
            Form completed
          </Badge>

          {/* Review action — opens the standalone submission detail panel,
              same affordance as the appointment-bound Form Completed row */}
          <div className="ml-2 flex-shrink-0">
            <Button
              variant="accent"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onReview();
              }}
            >
              Review
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
