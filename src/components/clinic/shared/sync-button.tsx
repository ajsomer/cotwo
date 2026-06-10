"use client";

import { Button } from "@/components/ui/button";

/**
 * The "Sync now" header button shared by the run-sheet and readiness shells.
 * The hand-drawn refresh SVG was previously copy-pasted alongside each copy
 * of the sync handler — see usePmsSync for the state/request half.
 */
export function SyncButton({
  isSyncing,
  onClick,
  title,
}: {
  isSyncing: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={isSyncing}
      title={title}
    >
      <RefreshIcon spinning={isSyncing} />
      {isSyncing ? "Syncing…" : "Sync now"}
    </Button>
  );
}

export function RefreshIcon({ spinning }: { spinning?: boolean }) {
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
