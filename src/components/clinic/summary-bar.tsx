"use client";

import { Button } from "@/components/ui/button";
import type { RunsheetSummary } from "@/lib/supabase/types";

interface SummaryBarProps {
  summary: RunsheetSummary;
  onScrollTo?: (state: string) => void;
  onBulkCall?: () => void;
  onBulkNudge?: () => void;
  onBulkProcess?: () => void;
}

export function SummaryBar({
  summary,
  onScrollTo,
  onBulkCall,
  onBulkNudge,
  onBulkProcess,
}: SummaryBarProps) {
  return (
    <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2.5">
      {/* Informational counts */}
      <div className="flex items-center gap-4" aria-live="polite">
        <CountItem label="Total" count={summary.total} onClick={() => onScrollTo?.("total")} />
        <CountItem
          label="Late"
          count={summary.late}
          color="text-red-500"
          onClick={() => onScrollTo?.("late")}
        />
        <CountItem
          label="Waiting"
          count={summary.waiting}
          color="text-amber-500"
          onClick={() => onScrollTo?.("waiting")}
        />
        <CountItem
          label="Active"
          count={summary.active}
          color="text-teal-500"
          onClick={() => onScrollTo?.("active")}
        />
        <CountItem
          label="Process"
          count={summary.complete}
          color="text-blue-500"
          onClick={() => onScrollTo?.("complete")}
        />
      </div>

      {/* Bulk action buttons */}
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
            variant="primary"
            size="sm"
            className="bg-blue-500 hover:bg-blue-500/90"
            onClick={onBulkProcess}
          >
            Bulk process ({summary.complete})
          </Button>
        )}
      </div>
    </div>
  );
}

function CountItem({
  label,
  count,
  color = "text-gray-800",
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 hover:opacity-80 transition-opacity"
    >
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {count}
      </span>
      <span className="text-xs text-gray-500">{label}</span>
    </button>
  );
}
