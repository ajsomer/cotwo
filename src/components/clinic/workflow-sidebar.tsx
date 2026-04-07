"use client";

import type { WorkflowDirection } from "@/lib/workflows/types";

interface SidebarItem {
  id: string;
  name: string;
  subtitle: string;
  actionCount: number;
  hasWorkflow: boolean;
}

interface WorkflowSidebarProps {
  direction: WorkflowDirection;
  items: SidebarItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  loading?: boolean;
}

export type { SidebarItem };

export function WorkflowSidebar({
  direction,
  items,
  selectedId,
  onSelect,
  onCreate,
  loading,
}: WorkflowSidebarProps) {
  const isPre = direction === "pre_appointment";
  const headerTitle = isPre ? "Appointment types" : "Post-appointment workflows";

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-gray-200 bg-gray-50/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {headerTitle}
        </h3>
        <button
          onClick={onCreate}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          title={isPre ? "Add appointment type" : "Add post-workflow"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-1 p-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-gray-200/50"
              />
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            {isPre
              ? "No appointment types yet."
              : "No post-appointment workflows yet."}
          </div>
        )}

        {!loading &&
          items.map((item) => {
            const isSelected = item.id === selectedId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? "border-l-2 border-teal-500 bg-white"
                    : "border-l-2 border-transparent hover:bg-gray-100/50"
                }`}
              >
                {/* Status dot */}
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    item.hasWorkflow ? "bg-teal-500" : "bg-gray-300"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-800">
                    {item.name}
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    {item.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
