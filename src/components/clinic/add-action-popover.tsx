"use client";

import { useState, useRef, useEffect } from "react";
import type { ActionType, WorkflowDirection } from "@/lib/workflows/types";
import { getActionTypesForDirection } from "@/lib/workflows/types";
import { ActionTypeIcon } from "./action-type-icon";

interface AddActionPopoverProps {
  direction: WorkflowDirection;
  onAdd: (actionType: ActionType) => void;
}

/**
 * Dashed placeholder with "+" icon. Clicking opens a popover menu of
 * available action types for the current direction.
 *
 * Action types exposed per direction are defined in ACTION_TYPE_META.
 * See src/lib/workflows/types.ts for documentation of which enum values
 * are intentionally not exposed in v1.
 */
export function AddActionPopover({ direction, onAdd }: AddActionPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const actionTypes = getActionTypesForDirection(direction);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm text-gray-400 transition-colors hover:border-teal-300 hover:text-teal-500"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
        Add action
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {actionTypes.map((meta) => (
            <button
              key={meta.type}
              onClick={() => {
                onAdd(meta.type);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">
                <ActionTypeIcon actionType={meta.type} size={16} />
              </span>
              <div>
                <div className="text-sm font-medium text-gray-800">
                  {meta.label}
                </div>
                <div className="text-xs text-gray-400">{meta.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
