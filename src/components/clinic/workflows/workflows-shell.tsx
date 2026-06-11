"use client";

import { useState, useEffect, useRef } from "react";
import { getJson, postJson } from "@/lib/api-client";
import { ConfirmModal } from "@/components/ui/modal";
import { useOrg } from "@/hooks/useOrg";
import type {
  DbWorkflowTemplate,
  DbWorkflowActionBlock,
  WorkflowDirection,
} from "@/lib/workflows/types";
// Post-appointment components — retained for upcoming post-appointment spec
// import { WorkflowSidebar, type SidebarItem } from "./workflow-sidebar";
// import { WorkflowMiddlePane } from "./workflow-middle-pane";
// import { MidFlightWarningModal } from "@/components/clinic/shared/mid-flight-warning-modal";
import { AppointmentTypesSettingsShell } from "@/components/clinic/settings/appointment-types-settings-shell";
import { OutcomePathwaysPanel } from "./outcome-pathways-panel";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import { useEnsureSlices } from "@/hooks/useEnsureSlices";
import type {
  AppointmentTypeRow,
  OutcomePathwayRow,
} from "@/stores/clinic-store";

// Post-appointment workflows are hidden for now to simplify the product. The
// engine, schema, store, and OutcomePathwaysPanel all remain — flip this to
// true to bring the post-appointment tab + surface back.
const SHOW_POST_APPOINTMENT = false;

export function WorkflowsShell() {
  const { org } = useOrg();
  const orgId = org?.id ?? "";

  // Fetch-if-empty
  useEnsureSlices(["workflows", "forms"]);

  const [direction, setDirection] = useState<WorkflowDirection>("pre_appointment");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Read from Zustand store (kept fresh by Realtime subscriptions in layout)
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes);
  const outcomePathways = useClinicStore((s) => s.outcomePathways);
  const workflowsLoaded = useClinicStore((s) => s.workflowsLoaded);
  const preTemplatesMap = useClinicStore((s) => s.preWorkflowTemplates);
  const preBlocksMap = useClinicStore((s) => s.preWorkflowBlocks);
  const postTemplatesMap = useClinicStore((s) => s.postWorkflowTemplates);
  const postBlocksMap = useClinicStore((s) => s.postWorkflowBlocks);
  const storeForms = useClinicStore((s) => s.forms);

  // Direction-dependent maps
  const isPre = direction === "pre_appointment";
  const templatesMap = isPre ? preTemplatesMap : postTemplatesMap;
  const blocksMap = isPre ? preBlocksMap : postBlocksMap;
  const loading = !workflowsLoaded;

  // Forms for pickers (just id + name from the store's full FormRow[])
  const forms = storeForms.map((f) => ({ id: f.id, name: f.name }));

  // Detail data for the currently selected item (read from maps)
  const [template, setTemplate] = useState<DbWorkflowTemplate | null>(null);
  const [originalBlocks, setOriginalBlocks] = useState<DbWorkflowActionBlock[]>([]);
  const [workingBlocks, setWorkingBlocks] = useState<DbWorkflowActionBlock[]>([]);

  // Metadata edits
  const [metadataEdits, setMetadataEdits] = useState<Record<string, unknown>>({});

  // Mid-flight warning
  const [showWarning, setShowWarning] = useState(false);
  const [inFlightCount, setInFlightCount] = useState(0);
  const [pendingDiscard, setPendingDiscard] = useState<
    | { kind: "direction"; value: WorkflowDirection }
    | { kind: "select"; value: string }
    | null
  >(null);

  // Dirty tracking
  const isDirty =
    Object.keys(metadataEdits).length > 0 ||
    JSON.stringify(workingBlocks) !== JSON.stringify(originalBlocks);

  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  /**
   * Load detail for a specific item. Synchronous — reads from prefetched maps.
   * Zero network calls on sidebar click.
   */
  function loadDetail(
    itemId: string,
    dir: WorkflowDirection,
    types: AppointmentTypeRow[],
    pathways: OutcomePathwayRow[],
    tplMap: Record<string, DbWorkflowTemplate>,
    blkMap: Record<string, DbWorkflowActionBlock[]>
  ) {
    setMetadataEdits({});

    if (dir === "pre_appointment") {
      const type = types.find((t) => t.id === itemId);
      if (!type?.pre_workflow_template_id) {
        setTemplate(null);
        setOriginalBlocks([]);
        setWorkingBlocks([]);
        return;
      }
      const tpl = tplMap[type.pre_workflow_template_id] ?? null;
      const blocks = blkMap[type.pre_workflow_template_id] ?? [];
      setTemplate(tpl);
      setOriginalBlocks(blocks);
      setWorkingBlocks(blocks);
    } else {
      const pathway = pathways.find((p) => p.id === itemId);
      if (!pathway?.workflow_template_id) {
        setTemplate(null);
        setOriginalBlocks([]);
        setWorkingBlocks([]);
        return;
      }
      const tpl = tplMap[pathway.workflow_template_id] ?? null;
      const blocks = blkMap[pathway.workflow_template_id] ?? [];
      setTemplate(tpl);
      setOriginalBlocks(blocks);
      setWorkingBlocks(blocks);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-select first item when direction or data changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!workflowsLoaded) return;
    const items = isPre ? appointmentTypes : outcomePathways;
    const currentTplMap = isPre ? preTemplatesMap : postTemplatesMap;
    const currentBlkMap = isPre ? preBlocksMap : postBlocksMap;

    if (items.length > 0 && !selectedId) {
      setSelectedId(items[0].id);
      loadDetail(items[0].id, direction, appointmentTypes, outcomePathways, currentTplMap, currentBlkMap);
    }
  }, [workflowsLoaded, direction]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleDirectionChange = (newDir: WorkflowDirection) => {
    if (newDir === direction) return;
    if (dirtyRef.current) {
      setPendingDiscard({ kind: "direction", value: newDir });
      return;
    }
    applyDirectionChange(newDir);
  };

  const applyDirectionChange = (newDir: WorkflowDirection) => {
    // Reset state — useEffect will handle the fetch via direction dep
    setSelectedId(null);
    setTemplate(null);
    setOriginalBlocks([]);
    setWorkingBlocks([]);
    setMetadataEdits({});
    setDirection(newDir);
  };

  const handleSelect = (id: string) => {
    if (id === selectedId) return;
    if (dirtyRef.current) {
      setPendingDiscard({ kind: "select", value: id });
      return;
    }
    applySelect(id);
  };

  const applySelect = (id: string) => {
    setSelectedId(id);
    const store = getClinicStore();
    const currentTplMap = isPre ? store.preWorkflowTemplates : store.postWorkflowTemplates;
    const currentBlkMap = isPre ? store.preWorkflowBlocks : store.postWorkflowBlocks;
    loadDetail(id, direction, store.appointmentTypes, store.outcomePathways, currentTplMap, currentBlkMap);
  };

  /** After mutations, refetch everything to refresh maps + sidebar. */
  async function refreshAll(selectId?: string) {
    try {
      await getClinicStore().refreshWorkflows(orgId);
      const id = selectId ?? selectedId;
      if (id) {
        setSelectedId(id);
        const store = getClinicStore();
        const currentTplMap = isPre ? store.preWorkflowTemplates : store.postWorkflowTemplates;
        const currentBlkMap = isPre ? store.preWorkflowBlocks : store.postWorkflowBlocks;
        loadDetail(id, direction, store.appointmentTypes, store.outcomePathways, currentTplMap, currentBlkMap);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const handleCreateType = async () => {
    const result = await postJson<{
      error?: string;
      appointment_type: { id: string };
    }>("/api/appointment-types", { org_id: orgId, name: "New appointment type" });
    // The route can also report an error in a 200 body.
    const error = result.ok ? result.data?.error : result.error;
    if (error) {
      setError(error);
      return;
    }
    if (result.ok) await refreshAll(result.data.appointment_type.id);
  };

  const handleCreatePathway = async () => {
    const result = await postJson<{
      error?: string;
      outcome_pathway: { id: string };
    }>("/api/outcome-pathways", {
      org_id: orgId,
      name: "New post-workflow",
      create_workflow: true,
    });
    // The route can also report an error in a 200 body.
    const error = result.ok ? result.data?.error : result.error;
    if (error) {
      setError(error);
      return;
    }
    if (result.ok) await refreshAll(result.data.outcome_pathway.id);
  };

  const handleCreateWorkflow = async () => {
    if (!selectedId) return;
    const result = await postJson<{ error?: string; template: DbWorkflowTemplate }>(
      `/api/appointment-types/${selectedId}/workflow`
    );
    // The route can also report an error in a 200 body.
    const error = result.ok ? result.data?.error : result.error;
    if (error || !result.ok) {
      setError(error ?? "Failed to create workflow");
      return;
    }

    // Update store maps locally with the new template
    const store = getClinicStore();
    store.setPreWorkflowTemplates({ ...store.preWorkflowTemplates, [result.data.template.id]: result.data.template });
    store.setPreWorkflowBlocks({ ...store.preWorkflowBlocks, [result.data.template.id]: [] });
    setTemplate(result.data.template);
    setOriginalBlocks([]);
    setWorkingBlocks([]);

    // Refresh workflows to update sidebar counts
    await store.refreshWorkflows(orgId);
  };

  // ---------------------------------------------------------------------------
  // Save flow
  // ---------------------------------------------------------------------------

  const computeChangeSummary = () => {
    const workingIds = new Set(
      workingBlocks.filter((b) => !b.id.startsWith("temp-")).map((b) => b.id)
    );
    const added = workingBlocks.filter((b) => b.id.startsWith("temp-")).length;
    const removed = originalBlocks.filter((b) => !workingIds.has(b.id)).length;
    const retimed = workingBlocks.filter((b) => {
      if (b.id.startsWith("temp-")) return false;
      const orig = originalBlocks.find((o) => o.id === b.id);
      return orig && orig.offset_minutes !== b.offset_minutes;
    }).length;
    return { added, removed, retimed };
  };

  const handleSave = async () => {
    if (!template) return;
    const result = await getJson<{ in_flight_count?: number }>(
      `/api/workflows/in-flight?template_id=${template.id}`
    );
    // On a failed check, continue with save.
    if (result.ok && (result.data?.in_flight_count ?? 0) > 0) {
      setInFlightCount(result.data.in_flight_count ?? 0);
      setShowWarning(true);
      return;
    }
    await executeSave();
  };

  const executeSave = async () => {
    if (!template) return;
    setIsSaving(true);
    setShowWarning(false);

    try {
      if (Object.keys(metadataEdits).length > 0) {
        if (isPre && selectedId) {
          await fetch("/api/appointment-types", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: selectedId, ...metadataEdits }),
          });
        } else if (!isPre && selectedId) {
          await fetch("/api/outcome-pathways", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: selectedId, ...metadataEdits }),
          });
        }
      }

      const deletedIds = originalBlocks
        .filter((ob) => !workingBlocks.some((wb) => wb.id === ob.id))
        .map((b) => b.id);

      const blocksToSend = workingBlocks.map((b, i) => ({
        ...(b.id.startsWith("temp-") ? {} : { id: b.id }),
        action_type: b.action_type,
        offset_minutes: b.offset_minutes,
        offset_direction: b.offset_direction,
        config: b.config,
        precondition: b.precondition,
        form_id: b.form_id,
        sort_order: i,
      }));

      const res = await fetch(`/api/workflows/${template.id}/blocks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: blocksToSend, deleted_ids: deletedIds }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const savedBlocks = data.blocks ?? [];
      setOriginalBlocks(savedBlocks);
      setWorkingBlocks(savedBlocks);
      setMetadataEdits({});

      // Update store maps so next sidebar click sees saved data
      if (isPre) {
        getClinicStore().setPreWorkflowBlocks({ ...getClinicStore().preWorkflowBlocks, [template.id]: savedBlocks });
      } else {
        getClinicStore().setPostWorkflowBlocks({ ...getClinicStore().postWorkflowBlocks, [template.id]: savedBlocks });
      }

      // Refresh workflows to update sidebar counts
      await getClinicStore().refreshWorkflows(orgId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setWorkingBlocks([...originalBlocks]);
    setMetadataEdits({});
  };

  // ---------------------------------------------------------------------------
  // Derived render data
  // ---------------------------------------------------------------------------

  const sidebarItems = isPre
    ? appointmentTypes.map((t) => ({
        id: t.id,
        name: t.name,
        subtitle: `${t.duration_minutes} min · ${t.action_count > 0 ? `${t.action_count} actions` : "No workflow"}`,
        actionCount: t.action_count,
        hasWorkflow: !!t.pre_workflow_template_id,
      }))
    : outcomePathways.map((p) => ({
        id: p.id,
        name: p.name,
        subtitle: p.action_count > 0 ? `${p.action_count} actions` : "No actions yet",
        actionCount: p.action_count,
        hasWorkflow: !!p.workflow_template_id,
      }));

  const selectedType = isPre ? appointmentTypes.find((t) => t.id === selectedId) : null;
  const selectedPathway = !isPre ? outcomePathways.find((p) => p.id === selectedId) : null;

  const preMetadata = selectedType
    ? {
        id: selectedType.id,
        name: metadataEdits.name !== undefined ? (metadataEdits.name as string) : selectedType.name,
        duration_minutes: metadataEdits.duration_minutes !== undefined
          ? (metadataEdits.duration_minutes as number)
          : selectedType.duration_minutes,
        default_fee_cents: metadataEdits.default_fee_cents !== undefined
          ? (metadataEdits.default_fee_cents as number)
          : selectedType.default_fee_cents,
        source: selectedType.source,
        pms_provider: selectedType.pms_provider,
      }
    : null;

  const postMetadata = selectedPathway
    ? {
        id: selectedPathway.id,
        name: metadataEdits.name !== undefined ? (metadataEdits.name as string) : selectedPathway.name,
        description: metadataEdits.description !== undefined
          ? (metadataEdits.description as string)
          : selectedPathway.description,
      }
    : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 px-6 pt-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Workflows</h1>
          <p className="text-sm text-gray-500">
            {SHOW_POST_APPOINTMENT
              ? "Configure what happens before and after each appointment"
              : "Configure what happens before each appointment"}
          </p>
        </div>

        {/* Tab bar — only shown when post-appointment is enabled. */}
        {SHOW_POST_APPOINTMENT && (
          <div className="flex gap-6 mt-4">
            <button
              onClick={() => handleDirectionChange("pre_appointment")}
              className={`pb-2.5 text-sm font-medium transition-colors border-b-2 ${
                isPre
                  ? "border-teal-500 text-teal-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Pre-appointment
            </button>
            <button
              onClick={() => handleDirectionChange("post_appointment")}
              className={`pb-2.5 text-sm font-medium transition-colors border-b-2 ${
                !isPre
                  ? "border-teal-500 text-teal-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Post-appointment
            </button>
          </div>
        )}
      </div>

      {/* Pre-appointment: intake package configuration surface */}
      {isPre && (
        <div className="flex-1 overflow-y-auto">
          <AppointmentTypesSettingsShell />
        </div>
      )}

      {/* Post-appointment: outcome pathways (hidden unless re-enabled). */}
      {SHOW_POST_APPOINTMENT && !isPre && (
        <div className="flex-1 overflow-y-auto">
          <OutcomePathwaysPanel />
        </div>
      )}

      <ConfirmModal
        open={!!pendingDiscard}
        title="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          if (!pendingDiscard) return;
          const action = pendingDiscard;
          setPendingDiscard(null);
          if (action.kind === "direction") applyDirectionChange(action.value);
          else applySelect(action.value);
        }}
        onCancel={() => setPendingDiscard(null)}
      />
    </div>
  );
}
