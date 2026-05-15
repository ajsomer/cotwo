"use client";

import { Button } from "@/components/ui/button";
import type { RunsheetSummary } from "@/lib/supabase/types";

interface SummaryBarProps {
  summary: RunsheetSummary;
  onBulkCall?: () => void;
  onBulkNudge?: () => void;
  onBulkProcess?: () => void;
}

export function SummaryBar({
  summary,
  onBulkCall,
  onBulkNudge,
  onBulkProcess,
}: SummaryBarProps) {
  const hasActions =
    summary.late > 0 || summary.upcoming > 0 || summary.complete > 0;

  return (
    <div className="flex items-center justify-end bg-gray-100/80 rounded-xl border border-gray-200 px-6 py-2.5 min-h-[44px]">
      {hasActions && (
        <div className="flex items-center gap-2">
          {summary.late > 0 && (
            <Button variant="danger" size="sm" onClick={onBulkCall}>
              Call now ({summary.late})
            </Button>
          )}
          {summary.upcoming > 0 && (
            <Button variant="accent" size="sm" onClick={onBulkNudge}>
              Nudge ({summary.upcoming})
            </Button>
          )}
          {summary.complete > 0 && (
            <Button
              variant="blue"
              size="sm"
              onClick={onBulkProcess}
            >
              Bulk process ({summary.complete})
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
