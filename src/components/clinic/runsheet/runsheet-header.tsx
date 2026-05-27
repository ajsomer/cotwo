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
  onNuke?: () => void;
  isNuking?: boolean;
  onBulkProcess?: () => void;
}

export function RunsheetHeader({
  summary,
  showAddButton = true,
  onAddSession,
  onSeed,
  isSeeding,
  onNuke,
  isNuking,
  onBulkProcess,
}: RunsheetHeaderProps) {
  const hasLate = summary.late > 0;
  const hasUpcoming = summary.upcoming > 0;
  const hasComplete = summary.complete > 0;
  // `hasAttention` drives the Zap fill/colour — late/upcoming still count as
  // "attention" even though they no longer have a CTA button.
  const hasAttention = hasLate || hasUpcoming || hasComplete;
  // `hasBulkActions` drives the add-session divider — only Bulk process remains
  // as a bulk button, so the divider only shows when there are complete sessions.
  const hasBulkActions = hasComplete;

  const boltColor = hasLate
    ? "text-red-500"
    : hasUpcoming
      ? "text-amber-500"
      : hasComplete
        ? "text-blue-500"
        : "text-gray-400";

  return (
    <div className="flex items-center bg-white rounded-xl border border-gray-200 px-6 py-2.5">
      {/* Left: lightning bolt + seed */}
      <div className="flex items-center gap-2">
        <button
          onClick={onNuke}
          disabled={isNuking}
          className="p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
          title="Clear all sessions"
        >
          <Zap
            size={16}
            className={`flex-shrink-0 transition-colors ${isNuking ? "text-red-500 animate-pulse" : boltColor} hover:text-red-500`}
            fill={hasAttention ? "currentColor" : "none"}
            strokeWidth={2}
          />
        </button>
        {onSeed && (
          <button
            onClick={onSeed}
            disabled={isSeeding}
            className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
          >
            {isSeeding ? "Seeding..." : "Seed data"}
          </button>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: bulk actions + add session */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {hasComplete && (
          <Button
            variant="blue"
            size="sm"
            onClick={onBulkProcess}
          >
            Bulk process ({summary.complete})
          </Button>
        )}
        {showAddButton && hasBulkActions && (
          <div className="w-px h-5 bg-gray-200" />
        )}
        {showAddButton && (
          <Button size="sm" onClick={onAddSession}>+ Add session</Button>
        )}
      </div>
    </div>
  );
}
