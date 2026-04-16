"use client";

import { useState } from "react";
import type {
  DbWorkflowActionBlock,
  WorkflowDirection,
  PreconditionConfig,
  ActionType,
} from "@/lib/workflows/types";
import {
  getActionTypeMeta,
  getActionDisplayName,
  getPreconditionLabel,
  MESSAGE_VARIABLES,
} from "@/lib/workflows/types";
import { ActionTypeIcon } from "./action-type-icon";
import { FireTimePicker, FireTimePill } from "./fire-time-picker";
import { PreconditionPicker } from "./precondition-picker";
import { Button } from "@/components/ui/button";

interface ActionCardProps {
  block: DbWorkflowActionBlock;
  direction: WorkflowDirection;
  forms: { id: string; name: string }[];
  files?: { id: string; name: string; file_size_bytes: number }[];
  formNames: Record<string, string>;
  isExpanded: boolean;
  onExpand: () => void;
  onApply: (updates: Partial<DbWorkflowActionBlock>) => void;
  onDelete: () => void;
}

export function ActionCard({
  block,
  direction,
  forms,
  files,
  formNames,
  isExpanded,
  onExpand,
  onApply,
  onDelete,
}: ActionCardProps) {
  const meta = getActionTypeMeta(block.action_type);

  // Local editing state (only used when expanded)
  const [editOffsetMinutes, setEditOffsetMinutes] = useState(block.offset_minutes);
  const [editPrecondition, setEditPrecondition] = useState<PreconditionConfig>(
    block.precondition as PreconditionConfig
  );
  const [editFormId, setEditFormId] = useState(block.form_id);
  const [editConfig, setEditConfig] = useState(
    block.config as Record<string, unknown>
  );

  const handleApply = () => {
    onApply({
      offset_minutes: editOffsetMinutes,
      offset_direction: direction === "pre_appointment" ? "before" : "after",
      precondition: editPrecondition as unknown as typeof block.precondition,
      form_id: editFormId,
      config: editConfig as typeof block.config,
    });
  };

  const handleCancel = () => {
    // Reset local state
    setEditOffsetMinutes(block.offset_minutes);
    setEditPrecondition(block.precondition as PreconditionConfig);
    setEditFormId(block.form_id);
    setEditConfig(block.config as Record<string, unknown>);
    onExpand(); // toggle closed
  };

  const displayName = getActionDisplayName(block, formNames[block.form_id ?? ""]);
  const preconditionLabel = getPreconditionLabel(
    block.precondition as PreconditionConfig,
    block.precondition &&
      (block.precondition as PreconditionConfig)?.type === "form_not_completed"
      ? formNames[(block.precondition as { form_id: string }).form_id]
      : undefined
  );

  // Collapsed state
  if (!isExpanded) {
    return (
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50/50"
        aria-expanded={false}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">
          <ActionTypeIcon actionType={block.action_type} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-800 truncate">
            {displayName}
          </div>
          <div className="text-xs text-gray-400 truncate">
            {preconditionLabel}
          </div>
        </div>
        <FireTimePill
          offsetMinutes={block.offset_minutes}
          offsetDirection={block.offset_direction}
        />
      </button>
    );
  }

  // Expanded state
  return (
    <div
      className="rounded-xl border border-teal-200 bg-white shadow-sm"
      aria-expanded={true}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">
          <ActionTypeIcon actionType={block.action_type} />
        </span>
        <div className="flex-1 text-sm font-medium text-gray-800">
          {meta?.label ?? block.action_type}
        </div>
        <FireTimePill
          offsetMinutes={editOffsetMinutes}
          offsetDirection={direction === "pre_appointment" ? "before" : "after"}
        />
      </div>

      {/* Config form */}
      <div className="space-y-4 px-4 py-4">
        {/* Fire time */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Fire time
          </label>
          <FireTimePicker
            direction={direction}
            offsetMinutes={editOffsetMinutes}
            onChange={setEditOffsetMinutes}
          />
        </div>

        {/* Precondition */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Precondition
          </label>
          <PreconditionPicker
            direction={direction}
            value={editPrecondition}
            forms={forms}
            onChange={setEditPrecondition}
          />
        </div>

        {/* Form picker (deliver_form) */}
        {meta?.needsForm && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Form
            </label>
            <select
              value={editFormId ?? ""}
              onChange={(e) => setEditFormId(e.target.value || null)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select a form...</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Message textarea (send_reminder, send_sms, send_rebooking_nudge) */}
        {meta?.hasMessage && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Message
            </label>
            <textarea
              value={(editConfig.message as string) ?? ""}
              onChange={(e) =>
                setEditConfig({ ...editConfig, message: e.target.value })
              }
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              placeholder="Enter message text..."
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {MESSAGE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() =>
                    setEditConfig({
                      ...editConfig,
                      message: ((editConfig.message as string) ?? "") + v.key,
                    })
                  }
                  className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200"
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* File picker (send_file) */}
        {meta?.hasFile && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              File
            </label>
            <select
              value={(editConfig.file_id as string) ?? ""}
              onChange={(e) =>
                setEditConfig({ ...editConfig, file_id: e.target.value || "" })
              }
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select a file...</option>
              {(files ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({Math.round(f.file_size_bytes / 1024)} KB)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Rebooking link (send_rebooking_nudge) */}
        {block.action_type === "send_rebooking_nudge" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Rebooking link (optional)
            </label>
            <input
              type="url"
              value={(editConfig.rebooking_url as string) ?? ""}
              onChange={(e) =>
                setEditConfig({ ...editConfig, rebooking_url: e.target.value })
              }
              placeholder="https://..."
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
        <Button variant="danger" size="sm" onClick={onDelete}>
          Delete
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
