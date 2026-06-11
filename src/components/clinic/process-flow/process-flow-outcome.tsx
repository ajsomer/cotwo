"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { selectOutcomePathway, skipOutcomePathway } from "@/lib/runsheet/actions";
import { useClinicStore } from "@/stores/clinic-store";
import { getActionTypeMeta, type ActionType } from "@/lib/workflows/types";
import type { EnrichedSession } from "@/lib/types/domain";
import {
  ActionBlockCard,
  ActionBlockFieldEditor,
  TimelineStartMarker,
} from "@/components/clinic/workflows/action-block-editor";
import { ArrowLeft } from "lucide-react";
import { useEnsureSlices } from "@/hooks/useEnsureSlices";

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

function actionTypeLabel(type: string): string {
  const meta = getActionTypeMeta(type as ActionType);
  return meta?.label ?? type;
}

function blockSummary(
  block: ActionBlock | CustomisedBlock,
  config: Record<string, unknown>,
  formName?: string,
  fileName?: string
): string {
  if (block.action_type === "task") {
    return (config.task_title as string) ?? "Task";
  }
  if (block.action_type === "deliver_form") {
    return formName ?? "Send form";
  }
  if (block.action_type === "send_file") {
    return fileName ?? "Send file";
  }
  if (block.action_type === "send_sms") {
    const msg = (config.message as string) ?? "";
    if (msg.length > 60) return msg.slice(0, 60) + "…";
    return msg || "SMS";
  }
  return actionTypeLabel(block.action_type);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcessFlowOutcome({
  session,
  onNext,
}: ProcessFlowOutcomeProps) {
  const [subStep, setSubStep] = useState<"select" | "customise">("select");
  const [selectedPathway, setSelectedPathway] =
    useState<PathwayWithBlocks | null>(null);
  const [customisedBlocks, setCustomisedBlocks] = useState<CustomisedBlock[]>(
    []
  );
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const forms = useClinicStore((s) => s.forms);
  const files = useClinicStore((s) => s.files);
  const formNameMap = new Map(forms.map((f) => [f.id, f.name]));
  const fileNameMap = new Map(files.map((f) => [f.id, f.name]));
  const locationId = useClinicStore((s) => s.locationId);
  const refreshReadiness = useClinicStore((s) => s.refreshReadiness);
  const refreshSessions = useClinicStore((s) => s.refreshSessions);

  // Fetch-if-empty: outcome pathways, workflow templates/blocks, form names,
  // and file names are all needed to render this step's summary lines and
  // customisation panel. The run sheet no longer prewarms these on cold load,
  // so the Process flow owns its own dependencies.
  useEnsureSlices(["workflows", "forms", "files"]);

  const patientName = [session.patient_first_name, session.patient_last_name]
    .filter(Boolean)
    .join(" ");

  // Outcome pathways come from the workflows store slice (populated by
  // refreshWorkflows above). Pathway list renders empty until the fetch
  // lands; selection is gated by user action so an empty initial state
  // simply shows no pathways for a moment, not a broken flow.
  const storePathways = useClinicStore((s) => s.outcomePathways);
  const pathways: PathwayWithBlocks[] = storePathways
    .filter((p) => !p.archived_at)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      workflow_template_id: p.workflow_template_id,
      action_count: p.blocks.length,
      blocks: p.blocks.map((b) => ({
        id: b.id,
        action_type: b.action_type as ActionType,
        offset_minutes: b.offset_minutes,
        offset_direction: b.offset_direction,
        form_id: b.form_id,
        config: (b.config as Record<string, unknown>) ?? {},
        sort_order: b.sort_order,
      })),
    }));

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

    // Refresh readiness + sessions so the post-appointment tab and run sheet update immediately
    if (locationId) {
      refreshReadiness(locationId);
      refreshSessions(locationId);
    }

    setLoading(false);
    onNext();
  }

  // Skip handler
  async function handleSkip() {
    setSkipping(true);
    await skipOutcomePathway(session.session_id);

    if (locationId) {
      refreshSessions(locationId);
    }

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
        <TimelineStartMarker />

        {/* Action blocks */}
        {customisedBlocks.map((block, idx) => {
          const isExpanded = expandedBlockId === block.id;
          const formName = block.customFormId
            ? formNameMap.get(block.customFormId)
            : undefined;
          const fileId = (block.customConfig.file_id as string) || (block.config.file_id as string);
          const fileName = fileId ? fileNameMap.get(fileId) : undefined;

          return (
            <ActionBlockCard
              key={block.id}
              isFirst={idx === 0}
              isLast={idx === customisedBlocks.length - 1}
              actionType={block.action_type}
              timingMinutes={block.customOffsetMinutes}
              typeLabel={actionTypeLabel(block.action_type)}
              summary={blockSummary(block, block.customConfig, formName, fileName)}
              enabled={block.enabled}
              expanded={isExpanded}
              onToggleExpand={() =>
                setExpandedBlockId(isExpanded ? null : block.id)
              }
              beforeChevron={
                <Toggle
                  checked={block.enabled}
                  onChange={() =>
                    updateBlock(block.id, { enabled: !block.enabled })
                  }
                  aria-label="Enabled"
                />
              }
            >
              {block.enabled && (
                <ActionBlockFieldEditor
                  variant="customise"
                  actionType={block.action_type}
                  offsetMinutes={block.customOffsetMinutes}
                  onOffsetChange={(minutes) =>
                    updateBlock(block.id, { customOffsetMinutes: minutes })
                  }
                  config={block.customConfig}
                  onConfigChange={(updates) =>
                    updateBlockConfig(block.id, updates)
                  }
                  formId={block.customFormId}
                  onFormIdChange={(formId) =>
                    updateBlock(block.id, { customFormId: formId })
                  }
                  forms={forms}
                  files={files}
                />
              )}
            </ActionBlockCard>
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
