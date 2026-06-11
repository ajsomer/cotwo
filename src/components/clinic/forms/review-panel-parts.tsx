"use client";

import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * Shared pieces of the three submission review panels (form handoff,
 * intake package handoff, standalone submission), which deliberately
 * mirror each other so the staff review experience is consistent.
 */

export interface ReviewField {
  label: string;
  value: string;
}

/** Copy control: bordered pill, or the tiny inline per-field variant. */
export function ReviewCopyButton({
  text,
  small,
  label,
}: {
  text: string;
  small?: boolean;
  label?: string;
}) {
  if (small) {
    return (
      <CopyButton
        text={text}
        label="Copy"
        copiedLabel="✓"
        className="shrink-0 text-[10px] text-gray-400 hover:text-teal-600"
      />
    );
  }
  return (
    <CopyButton
      text={text}
      label={label ?? "Copy all fields"}
      copiedLabel="Copied!"
      className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
    />
  );
}

/** Label/value row with an inline copy button. */
export function FieldRow({ label, value }: ReviewField) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
          {label}
        </p>
        <p className="text-sm text-gray-800 break-words">{value || "—"}</p>
      </div>
      <ReviewCopyButton text={value} small />
    </div>
  );
}

/** Loading skeleton for the field list. */
export function ReviewSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="h-3 bg-gray-100 rounded w-1/3 mb-1" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Bottom action bar. */
export function ReviewFooter({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-gray-200 px-5 py-3 flex gap-2 justify-end">
      {children}
    </div>
  );
}

const FOOTER_BUTTON_STYLES = {
  secondary:
    "rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50",
  primary:
    "rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50",
  tealOutline:
    "rounded-lg border border-teal-500 px-4 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50 disabled:opacity-50",
} as const;

export function ReviewFooterButton({
  variant = "secondary",
  onClick,
  disabled,
  children,
}: {
  variant?: keyof typeof FOOTER_BUTTON_STYLES;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={FOOTER_BUTTON_STYLES[variant]}
    >
      {children}
    </button>
  );
}
