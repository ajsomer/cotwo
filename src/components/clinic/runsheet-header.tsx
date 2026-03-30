"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunsheetSummary } from "@/lib/supabase/types";

interface RunsheetHeaderProps {
  summary: RunsheetSummary;
  showAddButton?: boolean;
  onAddSession?: () => void;
  onSeed?: () => void;
  isSeeding?: boolean;
  onBulkCall?: () => void;
  onBulkNudge?: () => void;
  onBulkProcess?: () => void;
}

export function RunsheetHeader({
  summary,
  showAddButton = true,
  onAddSession,
  onSeed,
  isSeeding,
  onBulkCall,
  onBulkNudge,
  onBulkProcess,
}: RunsheetHeaderProps) {
  const hasLate = summary.late > 0;
  const hasUpcoming = summary.upcoming > 0;
  const hasComplete = summary.complete > 0;
  const hasActions = hasLate || hasUpcoming || hasComplete;

  const boltColor = hasLate
    ? "text-red-500"
    : hasUpcoming
      ? "text-amber-500"
      : hasComplete
        ? "text-blue-500"
        : "text-gray-400";

  return (
    <div className="flex items-center bg-white rounded-xl border border-gray-200 px-6 py-2.5">
      {/* Lightning bolt + bulk actions */}
      <div className="flex items-center gap-2">
        <Zap
          size={16}
          className={`flex-shrink-0 transition-colors ${boltColor}`}
          fill={hasActions ? "currentColor" : "none"}
          strokeWidth={2}
        />

        {hasLate && (
          <Button variant="danger" size="sm" onClick={onBulkCall}>
            Call now ({summary.late})
          </Button>
        )}
        {hasUpcoming && (
          <Button variant="accent" size="sm" onClick={onBulkNudge}>
            Nudge ({summary.upcoming})
          </Button>
        )}
        {hasComplete && (
          <Button
            variant="blue"
            size="sm"
            onClick={onBulkProcess}
          >
            Bulk process ({summary.complete})
          </Button>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: seed + add session */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {onSeed && (
          <button
            onClick={onSeed}
            disabled={isSeeding}
            className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
          >
            {isSeeding ? "Seeding..." : "Seed data"}
          </button>
        )}
        {showAddButton && (
          <Button size="sm" onClick={onAddSession}>+ Add session</Button>
        )}
      </div>
    </div>
  );
}
