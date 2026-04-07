"use client";

import { useState, useEffect, useRef } from "react";
import { useOrg } from "@/hooks/useOrg";
import type {
  DbWorkflowTemplate,
  DbWorkflowActionBlock,
  WorkflowDirection,
} from "@/lib/workflows/types";
import { WorkflowSidebar, type SidebarItem } from "./workflow-sidebar";
import { WorkflowMiddlePane } from "./workflow-middle-pane";
import { MidFlightWarningModal } from "./mid-flight-warning-modal";

interface AppointmentTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  default_fee_cents: number;
  modality: string;
  source: string;
  pms_provider: string | null;
  pre_workflow_template_id: string | null;
  action_count: number;
  in_flight_count: number;
}

interface OutcomePathwayRow {
  id: string;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  template: DbWorkflowTemplate | null;
  blocks: DbWorkflowActionBlock[];
  action_count: number;
}

export function WorkflowsShell() {
  const { org } = useOrg();
  const [direction, setDirection] = useState<WorkflowDirection>("pre_appointment");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Sidebar data
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentTypeRow[]>([]);
  const [outcomePathways, setOutcomePathways] = useState<OutcomePathwayRow[]>([]);

  // Detail data
  const [template, setTemplate] = useState<DbWorkflowTemplate | null>(null);
  const [originalBlocks, setOriginalBlocks] = useState<DbWorkflowActionBlock[]>([]);
  const [workingBlocks, setWorkingBlocks] = useState<DbWorkflowActionBlock[]>([]);

  // Metadata edits
  const [metadataEdits, setMetadataEdits] = useState<Record<string, unknown>>({});

  // Forms for pickers
  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);

  // Mid-flight warning
  const [showWarning, setShowWarning] = useState(false);
  const [inFlightCount, setInFlightCount] = useState(0);

  // Dirty tracking
  const isDirty =
    Object.keys(metadataEdits).length > 0 ||
    JSON.stringify(workingBlocks) !== JSON.stringify(originalBlocks);

  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const isPre = direction === "pre_appointment";

  // ---------------------------------------------------------------------------
  // Data fetching — event-driven, not effect-driven
  // ---------------------------------------------------------------------------

  /** Fetch sidebar items. Returns the data directly (does not auto-select). */
  async function fetchSidebar(orgId: string, dir: WorkflowDirection) {
    if (dir === "pre_appointment") {
      const res = await fetch(`/api/appointment-types?org_id=${orgId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return { types: data.appointment_types ?? [] as AppointmentTypeRow[], pathways: [] as OutcomePathwayRow[] };
    } else {
      const res = await fetch(`/api/outcome-pathways?org_id=${orgId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return { types: [] as AppointmentTypeRow[], pathways: data.outcome_pathways ?? [] as OutcomePathwayRow[] };
    }
  }

  /** Fetch published forms for the picker dropdowns. */
  async function fetchForms(orgId: string) {
    const res = await fetch(`/api/forms?org_id=${orgId}`);
    const data = await res.json();
    return (data.forms ?? [])
      .filter((f: { status: string }) => f.status === "published")
      .map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }));
  }

  /** Load detail for a specific item. Called explicitly — not via effects. */
  async function loadDetail(
    itemId: string,
    dir: WorkflowDirection,
    types: AppointmentTypeRow[],
    pathways: OutcomePathwayRow[]
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

      setDetailLoading(true);
      try {
        const res = await fetch(`/api/workflows/${type.pre_workflow_template_id}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setTemplate(data.template);
        setOriginalBlocks(data.blocks ?? []);
        setWorkingBlocks(data.blocks ?? []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDetailLoading(false);
      }
    } else {
      // Post: data already fetched with the pathway
      const pathway = pathways.find((p) => p.id === itemId);
      setTemplate(pathway?.template ?? null);
      setOriginalBlocks(pathway?.blocks ?? []);
      setWorkingBlocks(pathway?.blocks ?? []);
    }
  }

  // ---------------------------------------------------------------------------
  // Initial load — the ONLY useEffect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!org?.id) return;

    let cancelled = false;

    async function loadInitialData() {
      setLoading(true);
      setError(null);

      try {
        // Fetch sidebar + forms in parallel
        const [sidebarData, formsData] = await Promise.all([
          fetchSidebar(org!.id, direction),
          fetchForms(org!.id),
        ]);

        if (cancelled) return;

        setAppointmentTypes(sidebarData.types);
        setOutcomePathways(sidebarData.pathways);
        setForms(formsData);
        setLoading(false);

        // Auto-select first item and load its detail
        const items = direction === "pre_appointment" ? sidebarData.types : sidebarData.pathways;
        if (items.length > 0) {
          const firstId = items[0].id;
          setSelectedId(firstId);
          await loadDetail(firstId, direction, sidebarData.types, sidebarData.pathways);
        } else {
          setSelectedId(null);
          setTemplate(null);
          setOriginalBlocks([]);
          setWorkingBlocks([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }

    loadInitialData();
    return () => { cancelled = true; };
  }, [org?.id, direction]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Event handlers — direct function calls, no effect cascades
  // ---------------------------------------------------------------------------

  const handleDirectionChange = (newDir: WorkflowDirection) => {
    if (dirtyRef.current) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setSelectedId(null);
    setTemplate(null);
    setOriginalBlocks([]);
    setWorkingBlocks([]);
    setMetadataEdits({});
    setDirection(newDir); // Triggers the useEffect to reload
  };

  const handleSelect = (id: string) => {
    if (id === selectedId) return;
    if (dirtyRef.current) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setSelectedId(id);
    // Fire and forget — detail loading skeleton shows via detailLoading state
    loadDetail(id, direction, appointmentTypes, outcomePathways);
  };

  const handleCreateType = async () => {
    if (!org?.id) return;
    try {
      const res = await fetch("/api/appointment-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: org.id, name: "New appointment type" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Refresh sidebar and select the new item
      const sidebarData = await fetchSidebar(org.id, direction);
      setAppointmentTypes(sidebarData.types);
      setSelectedId(data.appointment_type.id);
      await loadDetail(data.appointment_type.id, direction, sidebarData.types, []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreatePathway = async () => {
    if (!org?.id) return;
    try {
      const res = await fetch("/api/outcome-pathways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: org.id, name: "New post-workflow", create_workflow: true }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const sidebarData = await fetchSidebar(org.id, direction);
      setOutcomePathways(sidebarData.pathways);
      setSelectedId(data.outcome_pathway.id);
      await loadDetail(data.outcome_pathway.id, direction, [], sidebarData.pathways);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateWorkflow = async () => {
    if (!selectedId || !org?.id) return;
    try {
      const res = await fetch(`/api/appointment-types/${selectedId}/workflow`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Refresh sidebar to update the workflow status dot
      const sidebarData = await fetchSidebar(org.id, direction);
      setAppointmentTypes(sidebarData.types);

      setTemplate(data.template);
      setOriginalBlocks([]);
      setWorkingBlocks([]);
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
    if (!template || !org?.id) return;
    setIsSaving(true);
    setShowWarning(false);

    try {
      // Save metadata
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

      // Save blocks
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

      // Reconcile with returned blocks
      setOriginalBlocks(data.blocks ?? []);
      setWorkingBlocks(data.blocks ?? []);
      setMetadataEdits({});

      // Refresh sidebar to update counts (single fetch, no cascade)
      const sidebarData = await fetchSidebar(org.id, direction);
      setAppointmentTypes(sidebarData.types);
      setOutcomePathways(sidebarData.pathways);
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

  const sidebarItems: SidebarItem[] = isPre
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
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Workflows</h1>
          <p className="text-sm text-gray-500">
            Configure what happens before and after each appointment
          </p>
        </div>

        {/* Direction toggle */}
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          <button
            onClick={() => handleDirectionChange("pre_appointment")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isPre
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Pre-appointment
          </button>
          <button
            onClick={() => handleDirectionChange("post_appointment")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              !isPre
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Post-appointment
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        <WorkflowSidebar
          direction={direction}
          items={sidebarItems}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={isPre ? handleCreateType : handleCreatePathway}
          loading={loading}
        />

        <WorkflowMiddlePane
          direction={direction}
          preMetadata={preMetadata}
          postMetadata={postMetadata}
          template={template}
          blocks={workingBlocks}
          forms={forms}
          inFlightCount={selectedType?.in_flight_count ?? 0}
          isDirty={isDirty}
          isSaving={isSaving}
          onMetadataChange={(updates) =>
            setMetadataEdits({ ...metadataEdits, ...updates })
          }
          onBlocksChange={setWorkingBlocks}
          onCreateWorkflow={handleCreateWorkflow}
          onSave={handleSave}
          onCancel={handleCancel}
          loading={detailLoading}
        />
      </div>

      {/* Mid-flight warning */}
      <MidFlightWarningModal
        open={showWarning}
        inFlightCount={inFlightCount}
        changeSummary={computeChangeSummary()}
        onConfirm={executeSave}
        onCancel={() => setShowWarning(false)}
      />
    </div>
  );
}
