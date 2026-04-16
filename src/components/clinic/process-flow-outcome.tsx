"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { selectOutcomePathway, skipOutcomePathway } from "@/lib/runsheet/actions";
import { useClinicStore } from "@/stores/clinic-store";
import {
  getActionTypeMeta,
  formatFireTime,
  type ActionType,
} from "@/lib/workflows/types";
import type { EnrichedSession } from "@/lib/supabase/types";
import {
  MessageSquare,
  FileText,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PathwayWithBlocks {
  id: string;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  action_count: number;
  blocks: ActionBlock[];
}

interface ActionBlock {
  id: string;
  action_type: ActionType;
  offset_minutes: number;
  offset_direction: string;
  form_id: string | null;
  config: Record<string, unknown>;
  sort_order: number;
}

interface CustomisedBlock extends ActionBlock {
  enabled: boolean;
  customConfig: Record<string, unknown>;
  customOffsetMinutes: number;
  customFormId: string | null;
}

interface ProcessFlowOutcomeProps {
  session: EnrichedSession;
  onNext: () => void;
}

// ---------------------------------------------------------------------------
// Icon helper
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

function actionTypeLabel(type: string): string {
  const meta = getActionTypeMeta(type as ActionType);
  return meta?.label ?? type;
}

function blockSummary(
  block: ActionBlock | CustomisedBlock,
  config: Record<string, unknown>,
  formName?: string
): string {
  if (block.action_type === "task") {
    return (config.task_title as string) ?? "Task";
  }
  if (block.action_type === "deliver_form") {
    return formName ?? "Send form";
  }
  if (block.action_type === "send_sms") {
    const msg = (config.message as string) ?? "";
    if (msg.length > 60) return msg.slice(0, 60) + "…";
    return msg || "SMS";
  }
  return actionTypeLabel(block.action_type);
}

function timingLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Same day";
  const days = offsetMinutes / 1440;
  if (Number.isInteger(days)) return `Day ${days}`;
  return formatFireTime(offsetMinutes, "after").label;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcessFlowOutcome({
  session,
  onNext,
}: ProcessFlowOutcomeProps) {
  const [subStep, setSubStep] = useState<"select" | "customise">("select");
  const [pathways, setPathways] = useState<PathwayWithBlocks[]>([]);
  const [selectedPathway, setSelectedPathway] =
    useState<PathwayWithBlocks | null>(null);
  const [customisedBlocks, setCustomisedBlocks] = useState<CustomisedBlock[]>(
    []
  );
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const forms = useClinicStore((s) => s.forms);
  const formNameMap = new Map(forms.map((f) => [f.id, f.name]));

  const patientName = [session.patient_first_name, session.patient_last_name]
    .filter(Boolean)
    .join(" ");

  // Fetch pathways with blocks
  useEffect(() => {
    async function fetchPathways() {
      const supabase = createClient();
      const { data } = await supabase
        .from("outcome_pathways")
        .select("id, name, description, workflow_template_id")
        .is("archived_at", null)
        .order("name");

      const items: PathwayWithBlocks[] = [];
      for (const p of data ?? []) {
        let blocks: ActionBlock[] = [];
        if (p.workflow_template_id) {
          const { data: blockData } = await supabase
            .from("workflow_action_blocks")
            .select(
              "id, action_type, offset_minutes, offset_direction, form_id, config, sort_order"
            )
            .eq("template_id", p.workflow_template_id)
            .order("sort_order");
          blocks = (blockData ?? []) as ActionBlock[];
        }
        items.push({
          ...p,
          action_count: blocks.length,
          blocks,
        });
      }
      setPathways(items);
    }
    fetchPathways();
  }, []);

  // Initialise customised blocks when a pathway is selected
  const selectPathway = useCallback((pathway: PathwayWithBlocks) => {
    setSelectedPathway(pathway);
    setCustomisedBlocks(
      pathway.blocks.map((b) => ({
        ...b,
        enabled: (b.config as Record<string, unknown>)?.default_enabled !== false,
        customConfig: { ...(b.config as Record<string, unknown>) },
        customOffsetMinutes: b.offset_minutes,
        customFormId: b.form_id,
      }))
    );
    setExpandedBlockId(null);
    setSubStep("customise");
  }, []);

  // Confirm handler — build resolved config snapshots and call RPC
  async function handleConfirm() {
    if (!selectedPathway) return;
    setLoading(true);

    const enabledActions = customisedBlocks
      .filter((b) => b.enabled)
      .map((b) => ({
        action_block_id: b.id,
        action_type: b.action_type,
        offset_minutes: b.customOffsetMinutes,
        config: b.customConfig,
        form_id: b.customFormId,
      }));

    await selectOutcomePathway(
      session.session_id,
      selectedPathway.id,
      enabledActions
    );

    setLoading(false);
    onNext();
  }

  // Skip handler
  async function handleSkip() {
    setSkipping(true);
    await skipOutcomePathway(session.session_id);
    setSkipping(false);
    onNext();
  }

  // Update a block's customised fields
  function updateBlock(blockId: string, updates: Partial<CustomisedBlock>) {
    setCustomisedBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
    );
  }

  function updateBlockConfig(
    blockId: string,
    configUpdates: Record<string, unknown>
  ) {
    setCustomisedBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, customConfig: { ...b.customConfig, ...configUpdates } }
          : b
      )
    );
  }

  const enabledCount = customisedBlocks.filter((b) => b.enabled).length;

  // =========================================================================
  // Sub-step: Select
  // =========================================================================
  if (subStep === "select") {
    return (
      <div className="p-5 space-y-4">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            Select outcome pathway
          </p>

          <div className="space-y-2">
            {pathways.map((pathway) => (
              <button
                key={pathway.id}
                onClick={() => selectPathway(pathway)}
                className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-teal-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-800">
                    {pathway.name}
                  </p>
                  <span className="text-xs text-gray-400">
                    {pathway.action_count}{" "}
                    {pathway.action_count === 1 ? "action" : "actions"}
                  </span>
                </div>
                {pathway.description && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pathway.description}
                  </p>
                )}
              </button>
            ))}

            {pathways.length === 0 && (
              <div className="rounded-lg border border-gray-200 p-4 text-center">
                <p className="text-sm text-gray-500">
                  No outcome pathways configured.
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Contact your practice manager to set up pathways.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={handleSkip}
            disabled={skipping}
            className="w-full text-center text-sm text-gray-500 hover:text-gray-800 py-2 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            {skipping ? "Saving..." : "No outcome pathway required"}
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // Sub-step: Customise
  // =========================================================================
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-5 pt-5 pb-0 mb-4 shrink-0">
        <button
          onClick={() => setSubStep("select")}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mb-2"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to pathways
        </button>
        <p className="text-sm font-medium text-gray-800">
          Customise{" "}
          <span className="text-teal-600">{selectedPathway?.name}</span>
          {patientName && (
            <span className="text-gray-500"> for {patientName}</span>
          )}
        </p>
      </div>

      {/* Timeline — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 space-y-0 min-h-0">
        {/* T+0 marker */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-2 h-2 rounded-full bg-gray-300 ml-1" />
          <span className="text-xs text-gray-400 font-medium">
            Session complete
          </span>
        </div>

        {/* Action blocks */}
        {customisedBlocks.map((block, idx) => {
          const isExpanded = expandedBlockId === block.id;
          const formName = block.customFormId
            ? formNameMap.get(block.customFormId)
            : undefined;

          return (
            <div key={block.id} className="flex gap-3">
              {/* Timeline rail */}
              <div className="flex flex-col items-center w-4 shrink-0">
                {idx > 0 && <div className="w-px flex-1 bg-gray-200 -mt-1" />}
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    block.enabled ? "bg-teal-500" : "bg-gray-200"
                  }`}
                />
                {idx < customisedBlocks.length - 1 && (
                  <div className="w-px flex-1 bg-gray-200" />
                )}
              </div>

              {/* Block card */}
              <div
                className={`flex-1 min-w-0 rounded-lg border p-3 mb-2 transition-colors ${
                  block.enabled
                    ? "border-gray-200 bg-white"
                    : "border-gray-100 bg-gray-50 opacity-50"
                }`}
              >
                {/* Card header — clickable to expand/collapse */}
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
                        {timingLabel(block.customOffsetMinutes)}
                      </span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-500">
                        {actionTypeLabel(block.action_type)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 truncate">
                      {blockSummary(block, block.customConfig, formName)}
                    </p>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBlock(block.id, { enabled: !block.enabled });
                    }}
                    className={`shrink-0 w-8 h-5 rounded-full transition-colors ${
                      block.enabled ? "bg-teal-500" : "bg-gray-200"
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                        block.enabled
                          ? "translate-x-3.5"
                          : "translate-x-0.5"
                      }`}
                    />
                  </button>

                  {/* Expand indicator */}
                  <div className="shrink-0 text-gray-400">
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </div>

                {/* Expanded detail editor */}
                {isExpanded && block.enabled && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                    {/* Timing */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">
                        Timing (days after session)
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={block.customOffsetMinutes / 1440}
                          onChange={(e) =>
                            updateBlock(block.id, {
                              customOffsetMinutes:
                                parseInt(e.target.value || "0") * 1440,
                            })
                          }
                          className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                        <div className="flex flex-wrap gap-1">
                          {[1, 3, 7, 14, 30].map((d) => (
                            <button
                              key={d}
                              onClick={() =>
                                updateBlock(block.id, {
                                  customOffsetMinutes: d * 1440,
                                })
                              }
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                block.customOffsetMinutes === d * 1440
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

                    {/* SMS copy */}
                    {block.action_type === "send_sms" && (
                      <div>
                        <label className="text-xs font-medium text-gray-500 block mb-1">
                          SMS message
                        </label>
                        <textarea
                          value={
                            (block.customConfig.message as string) ?? ""
                          }
                          onChange={(e) =>
                            updateBlockConfig(block.id, {
                              message: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                        />
                        <p className="text-xs text-gray-400 mt-1 break-words">
                          Variables: {"{first_name}"}, {"{clinic_name}"},{" "}
                          {"{clinician_name}"}, {"{session_date}"}
                        </p>
                      </div>
                    )}

                    {/* Form picker */}
                    {block.action_type === "deliver_form" && (
                      <div>
                        <label className="text-xs font-medium text-gray-500 block mb-1">
                          Form
                        </label>
                        <select
                          value={block.customFormId ?? ""}
                          onChange={(e) =>
                            updateBlock(block.id, {
                              customFormId: e.target.value || null,
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
                              (block.customConfig.task_title as string) ?? ""
                            }
                            onChange={(e) =>
                              updateBlockConfig(block.id, {
                                task_title: e.target.value,
                              })
                            }
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 block mb-1">
                            Description (optional)
                          </label>
                          <textarea
                            value={
                              (block.customConfig.task_description as string) ??
                              ""
                            }
                            onChange={(e) =>
                              updateBlockConfig(block.id, {
                                task_description: e.target.value,
                              })
                            }
                            rows={2}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
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
      </div>

      {/* Footer — always visible */}
      <div className="px-5 py-4 border-t border-gray-100 space-y-2 shrink-0">
        <p className="text-xs text-gray-500 text-center">
          {enabledCount} {enabledCount === 1 ? "action" : "actions"} will fire.
        </p>
        <Button
          className="w-full"
          disabled={enabledCount === 0 || loading}
          onClick={handleConfirm}
        >
          {loading ? "Scheduling..." : "Confirm"}
        </Button>
        {enabledCount === 0 && (
          <p className="text-xs text-amber-600 text-center">
            Enable at least one action or select &quot;No outcome pathway
            required&quot;.
          </p>
        )}
      </div>
    </div>
  );
}
