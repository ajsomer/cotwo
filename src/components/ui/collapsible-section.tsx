"use client";

import { type ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  hasUnsavedChanges?: boolean;
  hasError?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  summary,
  expanded,
  onToggle,
  hasUnsavedChanges = false,
  hasError = false,
  children,
}: CollapsibleSectionProps) {
  return (
    <div
      className={`border rounded-lg transition-colors ${
        expanded ? "border-gray-300" : "border-gray-200"
      }`}
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center w-full px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
      >
        {/* Chevron */}
        <svg
          className={`h-4 w-4 text-gray-400 mr-3 flex-shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        {/* Title + summary */}
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-gray-800">{title}</span>
          {!expanded && summary && (
            <span className="text-xs text-gray-500 ml-2">· {summary}</span>
          )}
        </div>

        {/* Status dots */}
        {hasError && (
          <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0 ml-2" />
        )}
        {!hasError && hasUnsavedChanges && (
          <span className="h-2 w-2 rounded-full bg-amber-500 flex-shrink-0 ml-2" />
        )}
      </button>

      {/* Content — shown when expanded */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}
