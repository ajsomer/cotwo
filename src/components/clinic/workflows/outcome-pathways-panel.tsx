"use client";

import { useState, useEffect } from "react";
import { useClinicStore } from "@/stores/clinic-store";
import { Button } from "@/components/ui/button";
import { OutcomePathwayEditor } from "./outcome-pathway-editor";
import { Plus, Archive, MessageSquare, FileText, ClipboardCheck } from "lucide-react";

function blockTypeIcon(type: string) {
  switch (type) {
    case "send_sms":
      return <MessageSquare className="h-3 w-3" />;
    case "deliver_form":
      return <FileText className="h-3 w-3" />;
    case "task":
      return <ClipboardCheck className="h-3 w-3" />;
    default:
      return null;
  }
}

export function OutcomePathwaysPanel() {
  const outcomePathways = useClinicStore((s) => s.outcomePathways);
  const orgId = useClinicStore((s) => s.orgId);
  const refreshWorkflowsFn = useClinicStore((s) => s.refreshWorkflows);
  const refreshWorkflows = () => {
    if (orgId) refreshWorkflowsFn(orgId);
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);

  // Filter to active pathways
  const activePathways = outcomePathways.filter((p) => !p.archived_at);

  async function handleArchive(pathwayId: string) {
    setArchiving(pathwayId);
    try {
      await fetch("/api/outcome-pathways", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pathwayId,
          archived_at: new Date().toISOString(),
        }),
      });
      await refreshWorkflows();
    } catch (e) {
      console.error("Failed to archive pathway:", e);
    }
    setArchiving(null);
  }

  function handleEditorClose() {
    setEditingId(null);
    setCreating(false);
    refreshWorkflows();
  }

  // Empty state
  if (activePathways.length === 0 && !creating) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-800 mb-1">
            No outcome pathways yet
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Create your first pathway to define what happens after a session.
          </p>
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New pathway
          </Button>
        </div>

        {creating && (
          <OutcomePathwayEditor
            pathwayId={null}
            onClose={handleEditorClose}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-gray-800">Outcome pathways</p>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New pathway
        </Button>
      </div>
      <p className="text-xs text-gray-500 italic mb-4">
        Post-appointment workflows are triggered when the receptionist selects
        an outcome pathway at Process. Each pathway is a timeline of actions
        that fire on their configured schedule.
      </p>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_120px_100px_40px] gap-4 px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
          <span className="text-xs font-medium text-gray-500">
            Pathway name
          </span>
          <span className="text-xs font-medium text-gray-500">Actions</span>
          <span className="text-xs font-medium text-gray-500">Status</span>
          <span />
        </div>

        {/* Rows */}
        {activePathways.map((pathway) => {
          const blockCount = pathway.action_count ?? (pathway.blocks?.length ?? 0);
          return (
            <div
              key={pathway.id}
              onClick={() => setEditingId(pathway.id)}
              className="grid grid-cols-[1fr_120px_100px_40px] gap-4 px-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {pathway.name}
                </p>
                {pathway.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {pathway.description}
                  </p>
                )}
              </div>
              <div className="flex items-center">
                <span className="text-xs text-gray-500">
                  {blockCount} {blockCount === 1 ? "action" : "actions"}
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-xs text-gray-400">—</span>
              </div>
              <div className="flex items-center justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleArchive(pathway.id);
                  }}
                  disabled={archiving === pathway.id}
                  className="text-gray-300 hover:text-red-400 transition-colors"
                  title="Archive pathway"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor slide-over */}
      {(editingId || creating) && (
        <OutcomePathwayEditor
          pathwayId={editingId}
          onClose={handleEditorClose}
        />
      )}
    </div>
  );
}
