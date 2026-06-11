"use client";

import { useState } from "react";

interface CopyButtonProps {
  /** The text to copy, or a thunk for values only known in the browser. */
  text: string | (() => string);
  label?: string;
  copiedLabel?: string;
  /** Button chrome. Default is the small bordered pill. */
  className?: string;
}

/** Copies `text` to the clipboard and shows a transient copied state. */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied!",
  className = "shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", value);
    }
  };

  return (
    <button onClick={handleCopy} className={className}>
      {copied ? copiedLabel : label}
    </button>
  );
}
