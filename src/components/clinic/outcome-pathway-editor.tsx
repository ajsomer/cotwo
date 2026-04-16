"use client";

import { useState, useEffect } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { useClinicStore } from "@/stores/clinic-store";
import { createClient } from "@/lib/supabase/client";
import {
  getActionTypeMeta,
  formatFireTime,
  type ActionType,
} from "@/lib/workflows/types";
import {
  Plus,
  Trash2,
  MessageSquare,
  FileText,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
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

function ActionTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "send_sms":
      return <MessageSquare className="h-4 w-4 text-teal-600" />;
    case "deliver_form":
      return <FileText className="h-4 w-4 text-blue-500" />;
    case "task":
      return <ClipboardCheck className="h-4 w-4 text-amber-600" />;
    default:
      return <MessageSquare className="h-4 w-4 text-gray-400" />;
  }
}

function timingLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Same day";
  const days = offsetMinutes / 1440;
  if (Number.isInteger(days)) return `Day ${days}`;
  return formatFireTime(offsetMinutes, "after").label;
}

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
  const orgId = useClinicStore((s) => s.orgId);
  const formNameMap = new Map(forms.map((f) => [f.id, f.name]));

  // Load existing pathway data
  useEffect(() => {
    if (!pathwayId) return;
    async function load() {
      const supabase = createClient();

      const { data: pathway } = await supabase
        .from("outcome_pathways")
        .select("name, description, workflow_template_id")
        .eq("id", pathwayId!)
        .single();

      if (pathway) {
        setName(pathway.name);
        setDescription(pathway.description ?? "");

        if (pathway.workflow_template_id) {
          const { data: blockData } = await supabase
            .from("workflow_action_blocks")
            .select(
              "id, action_type, offset_minutes, offset_direction, form_id, config, sort_order"
            )
            .eq("template_id", pathway.workflow_template_id)
            .order("sort_order");

          setBlocks(
            (blockData ?? []).map((b) => ({
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

    try {
      const res = await fetch("/api/outcome-pathways/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Failed to save pathway:", data.error);
      }
    } catch (e) {
      console.error("Failed to save pathway:", e);
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
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Continue treatment"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One-line description"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-y-auto p-5 space-y-0">
            {/* T+0 marker */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full bg-gray-300 ml-1" />
              <span className="text-xs text-gray-400 font-medium">
                Session complete
              </span>
            </div>

            {/* Blocks */}
            {blocks.map((block, idx) => {
              const isExpanded = expandedBlockId === block.id;
              const formName = block.form_id
                ? formNameMap.get(block.form_id)
                : undefined;
              const meta = getActionTypeMeta(block.action_type);

              return (
                <div key={block.id} className="flex gap-3">
                  {/* Rail */}
                  <div className="flex flex-col items-center w-4 shrink-0">
                    {idx > 0 && (
                      <div className="w-px flex-1 bg-gray-200 -mt-1" />
                    )}
                    <div className="w-2.5 h-2.5 rounded-full bg-teal-500 shrink-0" />
                    {idx < blocks.length - 1 && (
                      <div className="w-px flex-1 bg-gray-200" />
                    )}
                  </div>

                  {/* Card */}
                  <div className="flex-1 rounded-lg border border-gray-200 bg-white p-3 mb-2">
                    <div
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() =>
                        setExpandedBlockId(isExpanded ? null : block.id)
                      }
                    >
                      <ActionTypeIcon type={block.action_type} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-400">
                            {timingLabel(block.offset_minutes)}
                          </span>
                          <span className="text-xs text-gray-300">·</span>
                          <span className="text-xs text-gray-500">
                            {meta?.label ?? block.action_type}
                          </span>
                        </div>
                      </div>
                      <div className="text-gray-400">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBlock(block.id);
                        }}
                        className="text-gray-300 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Expanded editor */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                        {/* Timing */}
                        <div>
                          <label className="text-xs font-medium text-gray-500 block mb-1">
                            Timing (days after session)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              value={block.offset_minutes / 1440}
                              onChange={(e) =>
                                updateBlock(block.id, {
                                  offset_minutes:
                                    parseInt(e.target.value || "0") * 1440,
                                })
                              }
                              className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                            <div className="flex gap-1">
                              {[1, 3, 7, 14, 30].map((d) => (
                                <button
                                  key={d}
                                  onClick={() =>
                                    updateBlock(block.id, {
                                      offset_minutes: d * 1440,
                                    })
                                  }
                                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                    block.offset_minutes === d * 1440
                                      ? "border-teal-500 bg-teal-50 text-teal-700"
                                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                                  }`}
                                >
                                  {d}d
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Default enabled toggle */}
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-gray-500">
                            Enabled by default at Process
                          </label>
                          <button
                            onClick={() =>
                              updateBlockConfig(block.id, {
                                default_enabled:
                                  block.config.default_enabled === false,
                              })
                            }
                            className={`w-8 h-5 rounded-full transition-colors ${
                              block.config.default_enabled !== false
                                ? "bg-teal-500"
                                : "bg-gray-200"
                            }`}
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                                block.config.default_enabled !== false
                                  ? "translate-x-3.5"
                                  : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </div>

                        {/* SMS fields */}
                        {block.action_type === "send_sms" && (
                          <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">
                              SMS message
                            </label>
                            <textarea
                              value={(block.config.message as string) ?? ""}
                              onChange={(e) =>
                                updateBlockConfig(block.id, {
                                  message: e.target.value,
                                })
                              }
                              rows={3}
                              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                              placeholder="Hi {first_name}, ..."
                            />
                            <p className="text-xs text-gray-400 mt-1">
                              Variables: {"{first_name}"}, {"{clinic_name}"},{" "}
                              {"{clinician_name}"}, {"{session_date}"}
                            </p>
                          </div>
                        )}

                        {/* Form fields */}
                        {block.action_type === "deliver_form" && (
                          <>
                            <div>
                              <label className="text-xs font-medium text-gray-500 block mb-1">
                                Form
                              </label>
                              <select
                                value={block.form_id ?? ""}
                                onChange={(e) =>
                                  updateBlock(block.id, {
                                    form_id: e.target.value || null,
                                  })
                                }
                                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              >
                                <option value="">Select a form...</option>
                                {forms
                                  .filter((f) => f.status === "published")
                                  .map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-500 block mb-1">
                                Reminder SMS (optional)
                              </label>
                              <textarea
                                value={
                                  (block.config.reminder_sms as string) ?? ""
                                }
                                onChange={(e) =>
                                  updateBlockConfig(block.id, {
                                    reminder_sms: e.target.value,
                                  })
                                }
                                rows={2}
                                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                                placeholder="Your clinician has sent you a form..."
                              />
                            </div>
                          </>
                        )}

                        {/* Task fields */}
                        {block.action_type === "task" && (
                          <>
                            <div>
                              <label className="text-xs font-medium text-gray-500 block mb-1">
                                Task title
                              </label>
                              <input
                                type="text"
                                value={
                                  (block.config.task_title as string) ?? ""
                                }
                                onChange={(e) =>
                                  updateBlockConfig(block.id, {
                                    task_title: e.target.value,
                                  })
                                }
                                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                                placeholder="e.g. Send referral"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-500 block mb-1">
                                Description (optional)
                              </label>
                              <textarea
                                value={
                                  (block.config.task_description as string) ??
                                  ""
                                }
                                onChange={(e) =>
                                  updateBlockConfig(block.id, {
                                    task_description: e.target.value,
                                  })
                                }
                                rows={2}
                                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                                placeholder="Additional context..."
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
