"use client";

import { useState, useMemo } from "react";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import { useOrg } from "@/hooks/useOrg";
import type { AppointmentTypeRow } from "@/stores/clinic-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppointmentTypeEditor } from "./appointment-type-editor";

const MODALITY_BADGE: Record<string, { label: string; variant: "teal" | "gray" | "blue" }> = {
  telehealth: { label: "Telehealth", variant: "teal" },
  in_person: { label: "In-person", variant: "blue" },
  both: { label: "Both", variant: "gray" },
};

function getIntakePackageSummary(type: AppointmentTypeRow): {
  line1: string;
  line2: string;
  configured: boolean;
} {
  if (!type.pre_workflow_template_id || type.action_count === 0) {
    return {
      line1: "Not configured",
      line2: "Set up intake package →",
      configured: false,
    };
  }
  return {
    line1: `${type.action_count} action${type.action_count === 1 ? "" : "s"}`,
    line2: type.in_flight_count > 0 ? `${type.in_flight_count} in flight` : "No active runs",
    configured: true,
  };
}

export function AppointmentTypesSettingsShell() {
  const { org } = useOrg();
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes);
  const workflowsLoaded = useClinicStore((s) => s.workflowsLoaded);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingType, setEditingType] = useState<AppointmentTypeRow | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "coviu" | "pms">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "configured" | "not_configured">("all");

  const filteredTypes = useMemo(() => {
    let result = appointmentTypes;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (sourceFilter !== "all") {
      result = result.filter((t) => t.source === sourceFilter);
    }
    if (statusFilter === "configured") {
      result = result.filter((t) => t.pre_workflow_template_id && t.action_count > 0);
    } else if (statusFilter === "not_configured") {
      result = result.filter((t) => !t.pre_workflow_template_id || t.action_count === 0);
    }

    return result;
  }, [appointmentTypes, search, sourceFilter, statusFilter]);

  const unconfiguredCount = appointmentTypes.filter(
    (t) => !t.pre_workflow_template_id || t.action_count === 0
  ).length;

  const handleRowClick = (type: AppointmentTypeRow) => {
    setEditingType(type);
    setEditorOpen(true);
  };

  const handleNewType = () => {
    setEditingType(null);
    setEditorOpen(true);
  };

  const handleEditorClose = () => {
    setEditorOpen(false);
    setEditingType(null);
  };

  const handleSaved = () => {
    setEditorOpen(false);
    setEditingType(null);
    // Refresh the store
    if (org) getClinicStore().refreshWorkflows(org.id);
  };

  if (!workflowsLoaded) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-4 w-80 bg-gray-100 rounded animate-pulse" />
        <div className="space-y-2 mt-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Appointment types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure what your clinic offers and what patients need to complete beforehand.
          </p>
        </div>
        <Button onClick={handleNewType}>+ New appointment type</Button>
      </div>

      {/* Unconfigured banner */}
      {unconfiguredCount > 0 && statusFilter !== "not_configured" && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <span className="text-sm text-amber-800">
            ⚠ {unconfiguredCount} appointment type{unconfiguredCount === 1 ? "" : "s"} need{unconfiguredCount === 1 ? "s" : ""} intake packages configured
          </span>
          <button
            onClick={() => setStatusFilter("not_configured")}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 underline"
          >
            Show unconfigured
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mt-4 mb-4">
        <input
          type="text"
          placeholder="Search appointment types"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-[280px] rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as "all" | "coviu" | "pms")}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600"
        >
          <option value="all">All sources</option>
          <option value="coviu">Manually created</option>
          <option value="pms">PMS synced</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "configured" | "not_configured")}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600"
        >
          <option value="all">All statuses</option>
          <option value="configured">Configured</option>
          <option value="not_configured">Not configured</option>
        </select>
        {statusFilter !== "all" && (
          <button
            onClick={() => setStatusFilter("all")}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {filteredTypes.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">
          {appointmentTypes.length === 0
            ? "No appointment types yet. Create one to get started."
            : "No appointment types match your filters."}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_90px_100px_1.5fr_100px] bg-gray-50 border-b border-gray-200 px-4 py-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Name</span>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Duration</span>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Modality</span>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Intake package</span>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide text-right">On completion</span>
          </div>

          {/* Rows */}
          {filteredTypes.map((type) => {
            const pkg = getIntakePackageSummary(type);
            const modalityBadge = MODALITY_BADGE[type.modality] ?? { label: type.modality, variant: "gray" as const };
            const isCollectionOnly = type.terminal_type === "collection_only";

            return (
              <button
                key={type.id}
                onClick={() => handleRowClick(type)}
                className={`grid grid-cols-[2fr_90px_100px_1.5fr_100px] w-full px-4 py-3 text-left border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors ${
                  editorOpen && editingType?.id === type.id ? "bg-gray-50" : ""
                }`}
              >
                {/* Name */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{type.name}</span>
                    {type.source === "pms" && (
                      <svg className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {type.source === "pms" ? "From PMS" : "Manually created"}
                  </span>
                </div>

                {/* Duration */}
                <span className="text-sm text-gray-600 self-center">
                  {isCollectionOnly ? "—" : `${type.duration_minutes} min`}
                </span>

                {/* Modality */}
                <div className="self-center">
                  {isCollectionOnly ? (
                    <span className="text-sm text-gray-400">—</span>
                  ) : (
                    <Badge variant={modalityBadge.variant}>{modalityBadge.label}</Badge>
                  )}
                </div>

                {/* Intake package */}
                <div className="min-w-0 self-center">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${pkg.configured ? "bg-teal-500" : "bg-gray-300"}`} />
                    <span className={`text-xs truncate ${pkg.configured ? "text-gray-700" : "text-gray-500"}`}>
                      {pkg.line1}
                    </span>
                  </div>
                  <span className={`text-xs ml-3.5 ${pkg.configured ? "text-gray-500" : "text-amber-600"}`}>
                    {pkg.line2}
                  </span>
                </div>

                {/* On completion */}
                <div className="self-center text-right">
                  <Badge variant={isCollectionOnly ? "amber" : "gray"}>
                    {isCollectionOnly ? "Collection" : "Run sheet"}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-gray-400 text-center mt-3">
        {filteredTypes.length} appointment type{filteredTypes.length === 1 ? "" : "s"}
      </p>

      {/* Editor slide-out */}
      {editorOpen && (
        <AppointmentTypeEditor
          appointmentType={editingType}
          onClose={handleEditorClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
