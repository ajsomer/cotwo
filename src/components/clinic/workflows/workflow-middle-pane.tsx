"use client";

import type {
  DbWorkflowTemplate,
  DbWorkflowActionBlock,
  WorkflowDirection,
} from "@/lib/workflows/types";
import { WorkflowEditor } from "./workflow-editor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PreMetadata {
  id: string;
  name: string;
  duration_minutes: number;
  default_fee_cents: number;
  source: string;
  pms_provider: string | null;
}

interface PostMetadata {
  id: string;
  name: string;
  description: string | null;
}

interface WorkflowMiddlePaneProps {
  direction: WorkflowDirection;
  preMetadata?: PreMetadata | null;
  postMetadata?: PostMetadata | null;
  template: DbWorkflowTemplate | null;
  blocks: DbWorkflowActionBlock[];
  forms: { id: string; name: string }[];
  files?: { id: string; name: string; file_size_bytes: number }[];
  inFlightCount: number;
  isDirty: boolean;
  isSaving: boolean;
  onMetadataChange: (updates: Record<string, unknown>) => void;
  onBlocksChange: (blocks: DbWorkflowActionBlock[]) => void;
  onCreateWorkflow: () => void;
  onSave: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function WorkflowMiddlePane({
  direction,
  preMetadata,
  postMetadata,
  template,
  blocks,
  forms,
  files,
  inFlightCount,
  isDirty,
  isSaving,
  onMetadataChange,
  onBlocksChange,
  onCreateWorkflow,
  onSave,
  onCancel,
  loading,
}: WorkflowMiddlePaneProps) {
  const isPre = direction === "pre_appointment";

  // No item selected
  if (!preMetadata && !postMetadata) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        {isPre
          ? "Select an appointment type to configure its workflow."
          : "Select a post-appointment workflow to edit."}
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="flex-1 p-6">
        <div className="space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="mt-6 h-px bg-gray-200" />
          <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header with Save/Cancel */}
      <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
        <div className="min-w-0 flex-1">
          {/* Pre-appointment metadata */}
          {isPre && preMetadata && (
            <div>
              <div className="flex items-center gap-2">
                {preMetadata.source === "pms" && (
                  <Badge variant="gray">
                    Synced from {preMetadata.pms_provider ?? "PMS"}
                  </Badge>
                )}
                {preMetadata.source === "pms" ? (
                  <h2 className="text-xl font-semibold text-gray-800">
                    {preMetadata.name}
                  </h2>
                ) : (
                  <input
                    type="text"
                    value={preMetadata.name}
                    onChange={(e) =>
                      onMetadataChange({ name: e.target.value })
                    }
                    className="text-xl font-semibold text-gray-800 bg-transparent border-none outline-none focus:ring-0 p-0 w-full"
                    placeholder="Appointment type name"
                  />
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                {preMetadata.source === "pms" ? (
                  <span>{preMetadata.duration_minutes} min</span>
                ) : (
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      value={preMetadata.duration_minutes}
                      onChange={(e) =>
                        onMetadataChange({
                          duration_minutes: parseInt(e.target.value) || 30,
                        })
                      }
                      className="w-12 bg-transparent border-none outline-none text-sm text-gray-500 p-0"
                    />
                    min
                  </span>
                )}
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  $
                  <input
                    type="number"
                    step="0.01"
                    value={(preMetadata.default_fee_cents / 100).toFixed(2)}
                    onChange={(e) =>
                      onMetadataChange({
                        default_fee_cents: Math.round(
                          parseFloat(e.target.value) * 100
                        ) || 0,
                      })
                    }
                    className="w-16 bg-transparent border-none outline-none text-sm text-gray-500 p-0"
                  />
                </span>
              </div>
            </div>
          )}

          {/* Post-appointment metadata */}
          {!isPre && postMetadata && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Post-appointment workflow
              </div>
              <input
                type="text"
                value={postMetadata.name}
                onChange={(e) => onMetadataChange({ name: e.target.value })}
                className="mt-1 text-xl font-semibold text-gray-800 bg-transparent border-none outline-none focus:ring-0 p-0 w-full"
                placeholder="Workflow name"
              />
              <input
                type="text"
                value={postMetadata.description ?? ""}
                onChange={(e) =>
                  onMetadataChange({ description: e.target.value })
                }
                className="mt-1 text-sm text-gray-500 bg-transparent border-none outline-none focus:ring-0 p-0 w-full"
                placeholder="Description (shown to receptionists during processing)"
              />
            </div>
          )}
        </div>

        {/* Save/Cancel buttons */}
        {isDirty && (
          <div className="ml-4 flex shrink-0 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      {/* Workflow section */}
      <div className="flex-1 px-6 py-4">
        {/* Workflow header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              {isPre ? "Pre-appointment workflow" : "Workflow actions"}
            </h3>
            <p className="text-xs text-gray-400">
              {blocks.length} action{blocks.length !== 1 ? "s" : ""}{" "}
              {isPre ? "running before each appointment" : "running after the appointment is processed"}
            </p>
          </div>
          {inFlightCount > 0 && (
            <span className="text-xs text-amber-600">
              {inFlightCount} patient{inFlightCount !== 1 ? "s" : ""} currently in this workflow
            </span>
          )}
        </div>

        {/* Editor or empty state */}
        {template ? (
          <WorkflowEditor
            direction={direction}
            blocks={blocks}
            forms={forms}
            files={files}
            onChange={onBlocksChange}
          />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              {isPre
                ? "No pre-appointment workflow configured for this appointment type."
                : "No workflow actions configured yet."}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateWorkflow}
              className="mt-3"
            >
              + Create workflow
            </Button>
          </div>
        )}

        {/* Post-workflow v1 notice */}
        {!isPre && template && (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
            Post-appointment workflows are configured here but will begin executing in a future release.
          </div>
        )}
      </div>
    </div>
  );
}
