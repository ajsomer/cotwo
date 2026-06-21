"use client";

import type { StandaloneSubmissionRow as StandaloneSubmissionRowType } from "@/stores/clinic-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgoShort } from "./utils";
import { STANDALONE_SOURCE_LABEL } from "./types";

interface StandaloneSubmissionRowProps {
  row: StandaloneSubmissionRowType;
  onPatientClick: () => void;
  /** Warm the patient-card fetches on hover / pointer-down of the name. */
  onPatientIntent?: () => void;
  onReview: () => void;
  /** Warm the detail fetch on hover / pointer-down of the Review control. */
  onReviewIntent?: () => void;
}

export function StandaloneSubmissionRow({
  row,
  onPatientClick,
  onPatientIntent,
  onReview,
  onReviewIntent,
}: StandaloneSubmissionRowProps) {
  const sourceLabel =
    STANDALONE_SOURCE_LABEL[row.submission_source] ?? row.submission_source;

  return (
    <div
      className="border-b border-gray-200 last:border-b-0"
      // Whole-row hover warms the submission-detail fetch ahead of the click.
      onMouseEnter={onReviewIntent}
    >
      <div className="grid grid-cols-[100px_160px_120px_1fr_auto] items-center border-l-[3px] border-l-amber-500 bg-amber-500/[0.03] transition-colors">
        {/* Time column — submission age instead of a scheduled time */}
        <span className="self-stretch flex items-center justify-center text-[13px] font-medium whitespace-nowrap bg-[#FAF9F7] text-[#5F5E5A] h-12">
          {timeAgoShort(row.created_at)}
        </span>

        {/* Patient name column */}
        <div className="flex items-center min-w-0 pl-5 pr-2">
          <button
            onClick={onPatientClick}
            onMouseEnter={onPatientIntent}
            onPointerDown={onPatientIntent}
            className="text-[14px] font-semibold text-gray-800 truncate leading-none hover:underline hover:text-teal-600 transition-colors"
          >
            {row.patient_name}
          </button>
        </div>

        {/* Task type column — form name, with standalone source + duplicate
            note as secondary detail underneath */}
        <div className="flex flex-col justify-center min-w-0 px-2 gap-0.5">
          <span className="text-xs text-gray-500 truncate leading-none">
            {row.form_name}
          </span>
          <span className="text-[11px] text-gray-400 truncate leading-none">
            Standalone · {sourceLabel}
          </span>
          {row.duplicate?.possible_duplicate_patient_name && (
            <span className="text-[11px] text-amber-600 truncate leading-none">
              Possible duplicate of {row.duplicate.possible_duplicate_patient_name}
            </span>
          )}
        </div>

        {/* Status column */}
        <div className="flex items-center min-w-0 px-2">
          <Badge variant="amber" className="flex-shrink-0">
            Form completed
          </Badge>
        </div>

        {/* Action column */}
        <div className="flex items-center justify-end pr-5 pl-3">
          <Button
            variant="accent"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            onMouseEnter={onReviewIntent}
            onPointerDown={onReviewIntent}
          >
            Review
          </Button>
        </div>
      </div>
    </div>
  );
}
