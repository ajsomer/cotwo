"use client";

import { useState, useEffect } from "react";
import { getJson, postJson } from "@/lib/api-client";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useClinicStore } from "@/stores/clinic-store";
import { getActionTypeMeta, type ActionType } from "@/lib/workflows/types";
import { TextInput } from "@/components/ui/input";
import {
  ActionBlockCard,
  ActionBlockFieldEditor,
  TimelineStartMarker,
} from "./action-block-editor";
import {
  Plus,
  Trash2,
  MessageSquare,
  FileText,
  ClipboardCheck,
  FileUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditorBlock {
  id: string;
  action_type: ActionType;
  offset_minutes: number;
  form_id: string | null;
  config: Record<string, unknown>;
  sort_order: number;
  isNew?: boolean;
}

interface OutcomePathwayEditorProps {
  pathwayId: string | null; // null = create new
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempIdCounter = 0;
function tempId() {
  return `temp-${++tempIdCounter}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OutcomePathwayEditor({
  pathwayId,
  onClose,
}: OutcomePathwayEditorProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!pathwayId); // new pathway = already loaded

  const forms = useClinicStore((s) => s.forms);
  const files = useClinicStore((s) => s.files);
  const orgId = useClinicStore((s) => s.orgId);

  // Load existing pathway data
  useEffect(() => {
    if (!pathwayId) return;
    async function load() {
      const result = await getJson<{
        pathway: { name: string; description: string | null } | null;
        blocks: Array<{
          id: string;
          action_type: string;
          offset_minutes: number;
          form_id: string | null;
          config: unknown;
          sort_order: number;
        }> | null;
      }>(`/api/outcome-pathways/${pathwayId!}`);
      if (result.ok) {
        const { pathway, blocks: blockData } = result.data;
        if (pathway) {
          setName(pathway.name);
          setDescription(pathway.description ?? "");
          setBlocks(
            (blockData ?? []).map((b: {
              id: string;
              action_type: string;
              offset_minutes: number;
              form_id: string | null;
              config: unknown;
              sort_order: number;
            }) => ({
              id: b.id,
              action_type: b.action_type as ActionType,
              offset_minutes: b.offset_minutes,
              form_id: b.form_id,
              config: (b.config as Record<string, unknown>) ?? {},
              sort_order: b.sort_order,
            }))
          );
        }
      }
      setLoaded(true);
    }
    load();
  }, [pathwayId]);

  // Add a new block
  function addBlock(actionType: ActionType) {
    const defaultConfig: Record<string, unknown> = { default_enabled: true };
    if (actionType === "task") {
      defaultConfig.task_title = "";
      defaultConfig.task_description = "";
    }
    if (actionType === "send_sms") {
      defaultConfig.message = "";
    }
    if (actionType === "send_file") {
      defaultConfig.file_id = "";
      defaultConfig.message =
        "Hi {first_name}, your clinician has shared a document with you. Tap here to view it: {file_link}";
    }

    const newId = tempId();
    setBlocks((prev) => [
      ...prev,
      {
        id: newId,
        action_type: actionType,
        offset_minutes: 0,
        form_id: null,
        config: defaultConfig,
        sort_order: prev.length,
        isNew: true,
      },
    ]);
    setShowTypePicker(false);
    setExpandedBlockId(newId);
  }

  // Remove a block
  function removeBlock(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    if (expandedBlockId === blockId) setExpandedBlockId(null);
  }

  // Update block fields
  function updateBlock(blockId: string, updates: Partial<EditorBlock>) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
    );
  }

  function updateBlockConfig(
    blockId: string,
    configUpdates: Record<string, unknown>
  ) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, config: { ...b.config, ...configUpdates } }
          : b
      )
    );
  }

  // Save via configure_outcome_pathway RPC
  async function handleSave() {
    if (!name.trim() || blocks.length === 0) return;
    setSaving(true);

    const result = await postJson("/api/outcome-pathways/configure", {
      org_id: orgId,
      pathway_id: pathwayId,
      name: name.trim(),
      description: description.trim() || null,
      blocks: blocks.map((b, i) => ({
        ...(b.isNew ? {} : { id: b.id }),
        action_type: b.action_type,
        offset_minutes: b.offset_minutes,
        form_id: b.form_id,
        config: b.config,
        sort_order: i,
      })),
    });

    if (!result.ok) {
      console.error("Failed to save pathway:", result.error);
    }

    setSaving(false);
    onClose();
  }

  const isValid = name.trim().length > 0 && blocks.length > 0;
  const title = pathwayId ? `Edit pathway: ${name}` : "Create new pathway";

  return (
    <SlideOver open={true} onClose={onClose} title={title} width="w-[520px]">
      {!loaded ? (
        <div className="p-5 text-sm text-gray-400">Loading...</div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Basic fields */}
          <div className="p-5 space-y-3 border-b border-gray-100">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Pathway name
              </label>
              <TextInput
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Continue treatment"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Description (optional)
              </label>
              <TextInput
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One-line description"
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-y-auto p-5 space-y-0">
            <TimelineStartMarker />

            {/* Blocks */}
            {blocks.map((block, idx) => {
              const isExpanded = expandedBlockId === block.id;
              const meta = getActionTypeMeta(block.action_type);

              return (
                <ActionBlockCard
                  key={block.id}
                  isFirst={idx === 0}
                  isLast={idx === blocks.length - 1}
                  actionType={block.action_type}
                  timingMinutes={block.offset_minutes}
                  typeLabel={meta?.label ?? block.action_type}
                  expanded={isExpanded}
                  onToggleExpand={() =>
                    setExpandedBlockId(isExpanded ? null : block.id)
                  }
                  afterChevron={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBlock(block.id);
                      }}
                      className="text-gray-300 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  }
                >
                  <ActionBlockFieldEditor
                    variant="builder"
                    allowFormReminder
                    actionType={block.action_type}
                    offsetMinutes={block.offset_minutes}
                    onOffsetChange={(minutes) =>
                      updateBlock(block.id, { offset_minutes: minutes })
                    }
                    config={block.config}
                    onConfigChange={(updates) =>
                      updateBlockConfig(block.id, updates)
                    }
                    formId={block.form_id}
                    onFormIdChange={(formId) =>
                      updateBlock(block.id, { form_id: formId })
                    }
                    forms={forms}
                    files={files}
                  >
                    {/* Default enabled toggle */}
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-500">
                        Enabled by default at Process
                      </label>
                      <Toggle
                        checked={block.config.default_enabled !== false}
                        onChange={() =>
                          updateBlockConfig(block.id, {
                            default_enabled:
                              block.config.default_enabled === false,
                          })
                        }
                        aria-label="On by default"
                      />
                    </div>
                  </ActionBlockFieldEditor>
                </ActionBlockCard>
              );
            })}

            {/* Add action button */}
            <div className="flex gap-3 mt-1">
              <div className="flex flex-col items-center w-4 shrink-0">
                {blocks.length > 0 && (
                  <div className="w-px flex-1 bg-gray-200 -mt-1" />
                )}
                <div className="w-2 h-2 rounded-full bg-gray-200 shrink-0" />
              </div>
              <div className="flex-1">
                {showTypePicker ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => addBlock("send_sms")}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:border-teal-400 transition-colors"
                    >
                      <MessageSquare className="h-3 w-3 text-teal-600" />
                      SMS
                    </button>
                    <button
                      onClick={() => addBlock("deliver_form")}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:border-blue-400 transition-colors"
                    >
                      <FileText className="h-3 w-3 text-blue-500" />
                      Send form
                    </button>
                    <button
                      onClick={() => addBlock("send_file")}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:border-violet-400 transition-colors"
                    >
                      <FileUp className="h-3 w-3 text-violet-500" />
                      Send file
                    </button>
                    <button
                      onClick={() => addBlock("task")}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:border-amber-400 transition-colors"
                    >
                      <ClipboardCheck className="h-3 w-3 text-amber-600" />
                      Task
                    </button>
                    <button
                      onClick={() => setShowTypePicker(false)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowTypePicker(true)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-teal-600 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add action
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Save footer */}
          <div className="p-5 border-t border-gray-200 flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <Button
              onClick={handleSave}
              disabled={!isValid || saving}
              size="sm"
            >
              {saving ? "Saving..." : "Save pathway"}
            </Button>
          </div>
        </div>
      )}
    </SlideOver>
  );
}
