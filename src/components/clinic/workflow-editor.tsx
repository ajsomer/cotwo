"use client";

import { useState } from "react";
import type {
  DbWorkflowActionBlock,
  WorkflowDirection,
  ActionType,
} from "@/lib/workflows/types";
import { ActionCard } from "./action-card";
import { AddActionPopover } from "./add-action-popover";

interface WorkflowEditorProps {
  direction: WorkflowDirection;
  blocks: DbWorkflowActionBlock[];
  forms: { id: string; name: string }[];
  onChange: (blocks: DbWorkflowActionBlock[]) => void;
}

/** Sort blocks by fire time. Pre: descending offset (furthest first). Post: ascending. */
function sortBlocks(
  blocks: DbWorkflowActionBlock[],
  direction: WorkflowDirection
): DbWorkflowActionBlock[] {
  return [...blocks].sort((a, b) => {
    if (direction === "pre_appointment") {
      return b.offset_minutes - a.offset_minutes; // 14 days before → 1 day before
    }
    return a.offset_minutes - b.offset_minutes; // immediately → 30 days after
  });
}

export function WorkflowEditor({
  direction,
  blocks,
  forms,
  onChange,
}: WorkflowEditorProps) {
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  const sortedBlocks = sortBlocks(blocks, direction);
  const isPre = direction === "pre_appointment";

  // Build form name lookup
  const formNames: Record<string, string> = {};
  for (const f of forms) {
    formNames[f.id] = f.name;
  }

  const handleApply = (
    blockId: string,
    updates: Partial<DbWorkflowActionBlock>
  ) => {
    const updated = blocks.map((b) =>
      b.id === blockId ? { ...b, ...updates } : b
    );
    onChange(updated);
    setExpandedBlockId(null);
  };

  const handleDelete = (blockId: string) => {
    onChange(blocks.filter((b) => b.id !== blockId));
    setExpandedBlockId(null);
  };

  const handleAdd = (actionType: ActionType) => {
    // Create a new block with temporary ID (no id = new block for the API)
    const newBlock: DbWorkflowActionBlock = {
      id: `temp-${Date.now()}`,
      template_id: blocks[0]?.template_id ?? "",
      action_type: actionType,
      offset_minutes: isPre ? 60 * 24 : 0, // default: 1 day before (pre) or immediately (post)
      offset_direction: isPre ? "before" : "after",
      modality_filter: null,
      form_id: null,
      config: {},
      precondition: null,
      parent_action_block_id: null,
      sort_order: blocks.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    onChange([...blocks, newBlock]);
    setExpandedBlockId(newBlock.id);
  };

  // Appointment anchor element
  const anchor = (
    <div className="flex items-center gap-3 py-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-500 text-white">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="8" cy="8" r="6" />
          <line x1="8" y1="5" x2="8" y2="8" />
          <line x1="8" y1="8" x2="10.5" y2="9.5" />
        </svg>
      </span>
      <span className="text-sm font-semibold text-teal-700">
        {isPre ? "Appointment" : "Appointment processed"}
      </span>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Post: anchor at top */}
      {!isPre && anchor}
      {!isPre && sortedBlocks.length > 0 && (
        <div className="ml-5 border-l-2 border-gray-200 pl-0" />
      )}

      {/* Action cards */}
      {sortedBlocks.map((block) => (
        <div key={block.id} className="relative">
          {/* Timeline connector line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200 -z-10" />
          <ActionCard
            block={block}
            direction={direction}
            forms={forms}
            formNames={formNames}
            isExpanded={expandedBlockId === block.id}
            onExpand={() =>
              setExpandedBlockId(
                expandedBlockId === block.id ? null : block.id
              )
            }
            onApply={(updates) => handleApply(block.id, updates)}
            onDelete={() => handleDelete(block.id)}
          />
        </div>
      ))}

      {/* Add action placeholder */}
      <AddActionPopover direction={direction} onAdd={handleAdd} />

      {/* Pre: anchor at bottom */}
      {isPre && sortedBlocks.length > 0 && (
        <div className="ml-5 border-l-2 border-gray-200 pl-0" />
      )}
      {isPre && anchor}
    </div>
  );
}
