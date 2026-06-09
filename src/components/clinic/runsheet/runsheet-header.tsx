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
  // PMS "Sync now" — only rendered when the location has a sync-active PMS
  // (gating decided by the shell). Pulls sessions from the appointment book.
  showSync?: boolean;
  syncLabel?: string;
  isSyncing?: boolean;
  onSync?: () => void;
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
  showSync = false,
  syncLabel = "PMS",
  isSyncing = false,
  onSync,
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
      {/* Left: heading + lightning bolt + seed */}
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Runsheet</h1>
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

      {/* Right: bulk actions + sync + add session */}
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
        {showSync && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onSync}
            disabled={isSyncing}
            title={`Pull sessions from ${syncLabel}`}
          >
            <RefreshIcon spinning={isSyncing} />
            {isSyncing ? "Syncing…" : "Sync now"}
          </Button>
        )}
        {showAddButton && (hasBulkActions || showSync) && (
          <div className="w-px h-5 bg-gray-200" />
        )}
        {showAddButton && (
          <Button size="sm" onClick={onAddSession}>+ Add session</Button>
        )}
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}
