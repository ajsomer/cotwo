"use client";

import { Tooltip } from "@/components/ui/tooltip";

/**
 * Card-on-file indicator. Green card = stored, amber struck-through card =
 * none. Shared across the run sheet row, appointment list, and calendar.
 */
export function CardIndicator({ hasCard }: { hasCard: boolean }) {
  if (hasCard) {
    return (
      <Tooltip content="Card on file">
        <span className="flex-shrink-0 inline-flex items-center">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
            <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
            <path d="M1.5 6.5h13" />
            <path d="M4 10h3" />
          </svg>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content="No card stored">
      <span className="flex-shrink-0 inline-flex items-center">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
          <path d="M1.5 6.5h13" />
          <path d="M4 10h3" />
          <path d="M13 2L3 14" strokeWidth="1.5" />
        </svg>
      </span>
    </Tooltip>
  );
}
