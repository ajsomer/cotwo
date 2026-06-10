"use client";

import { Button } from "@/components/ui/button";
import type { RunsheetSummary } from "@/lib/types/domain";

interface SummaryBarProps {
  summary: RunsheetSummary;
  onBulkProcess?: () => void;
}

export function SummaryBar({
  summary,
  onBulkProcess,
}: SummaryBarProps) {
  const hasActions = summary.complete > 0;

  return (
    <div className="flex items-center justify-end bg-gray-100/80 rounded-xl border border-gray-200 px-6 py-2.5 min-h-[44px]">
      {hasActions && (
        <div className="flex items-center gap-2">
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
