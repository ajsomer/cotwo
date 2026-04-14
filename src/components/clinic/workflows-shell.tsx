"use client";

import { useState, useEffect, useRef } from "react";
import { useOrg } from "@/hooks/useOrg";
import type {
  DbWorkflowTemplate,
  DbWorkflowActionBlock,
  WorkflowDirection,
} from "@/lib/workflows/types";
// Post-appointment components — retained for upcoming post-appointment spec
// import { WorkflowSidebar, type SidebarItem } from "./workflow-sidebar";
// import { WorkflowMiddlePane } from "./workflow-middle-pane";
// import { MidFlightWarningModal } from "./mid-flight-warning-modal";
import { AppointmentTypesSettingsShell } from "./appointment-types-settings-shell";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { AppointmentTypeRow, OutcomePathwayRow } from "@/stores/clinic-store";

export function WorkflowsShell() {
  const { org } = useOrg();
  const orgId = org?.id ?? "";

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
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
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
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
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
    try {
      const res = await fetch("/api/appointment-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId, name: "New appointment type" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await refreshAll(data.appointment_type.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreatePathway = async () => {
    try {
      const res = await fetch("/api/outcome-pathways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId, name: "New post-workflow", create_workflow: true }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await refreshAll(data.outcome_pathway.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateWorkflow = async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/appointment-types/${selectedId}/workflow`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Update store maps locally with the new template
      const store = getClinicStore();
      store.setPreWorkflowTemplates({ ...store.preWorkflowTemplates, [data.template.id]: data.template });
      store.setPreWorkflowBlocks({ ...store.preWorkflowBlocks, [data.template.id]: [] });
      setTemplate(data.template);
      setOriginalBlocks([]);
      setWorkingBlocks([]);

      // Refresh workflows to update sidebar counts
      await store.refreshWorkflows(orgId);
    } catch (err) {
      setError((err as Error).message);
    }
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
    try {
      const res = await fetch(`/api/workflows/in-flight?template_id=${template.id}`);
      const data = await res.json();
      if ((data.in_flight_count ?? 0) > 0) {
        setInFlightCount(data.in_flight_count);
        setShowWarning(true);
        return;
      }
    } catch {
      // Continue with save
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
            Configure what happens before and after each appointment
          </p>
        </div>

        {/* Tab bar */}
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
      </div>

      {/* Pre-appointment: new intake package configuration surface */}
      {isPre && (
        <div className="flex-1 overflow-y-auto">
          <AppointmentTypesSettingsShell />
        </div>
      )}

      {/* Post-appointment: placeholder for future spec */}
      {!isPre && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-400">Post-appointment workflows coming soon.</p>
        </div>
      )}
    </div>
  );
}
