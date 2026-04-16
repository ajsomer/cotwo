"use client";

import { useEffect, useState, useMemo } from "react";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import { useOrg } from "@/hooks/useOrg";
import type { AppointmentTypeRow } from "@/stores/clinic-store";
import { AppointmentTypeEditor } from "./appointment-type-editor";

/* ── Colours ── */
const IN_FLIGHT_AMBER = "#BA7517";
const IN_FLIGHT_ROW_BG = "#FFFDF8";
const IDLE_GREY = "#B4B2A9";

/* ── Modality pills ── */
function ModalityPill({ modality }: { modality: string }) {
  const isInPerson = modality === "in_person";
  return (
    <span
      className="inline-flex items-center font-medium"
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 10,
        backgroundColor: isInPerson ? "#FAEEDA" : "#E1F5EE",
        color: isInPerson ? "#854F0B" : "#085041",
      }}
    >
      {isInPerson ? "In-person" : "Telehealth"}
    </span>
  );
}

/* ── Runtime state cell ── */
function RuntimeStateCell({ type }: { type: AppointmentTypeRow }) {
  const hasInFlight = type.pre_workflow_template_id && type.in_flight_count > 0;

  if (hasInFlight) {
    return (
      <span
        className="text-xs font-medium cursor-pointer"
        style={{
          color: IN_FLIGHT_AMBER,
          textDecorationLine: "underline",
          textDecorationStyle: "dotted",
          textUnderlineOffset: 3,
        }}
      >
        {type.in_flight_count} in flight ↗
      </span>
    );
  }

  return (
    <span className="text-xs" style={{ color: IDLE_GREY }}>—</span>
  );
}

export function AppointmentTypesSettingsShell() {
  const { org } = useOrg();
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes);
  const workflowsLoaded = useClinicStore((s) => s.workflowsLoaded);

  // Fetch-if-empty
  useEffect(() => {
    if (!org) return;
    if (!getClinicStore().workflowsLoaded) {
      void getClinicStore().refreshWorkflows(org.id);
    }
  }, [org]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingType, setEditingType] = useState<AppointmentTypeRow | null>(null);
  const [editorTerminalType, setEditorTerminalType] = useState<"run_sheet" | "collection_only">("run_sheet");

  const runSheetTypes = useMemo(
    () => appointmentTypes.filter((t) => t.terminal_type !== "collection_only"),
    [appointmentTypes]
  );

  const collectionTypes = useMemo(
    () => appointmentTypes.filter((t) => t.terminal_type === "collection_only"),
    [appointmentTypes]
  );

  const handleRowClick = (type: AppointmentTypeRow) => {
    setEditingType(type);
    setEditorTerminalType(type.terminal_type === "collection_only" ? "collection_only" : "run_sheet");
    setEditorOpen(true);
  };

  const handleNewType = () => {
    setEditingType(null);
    setEditorTerminalType("run_sheet");
    setEditorOpen(true);
  };

  const handleNewCollection = () => {
    setEditingType(null);
    setEditorTerminalType("collection_only");
    setEditorOpen(true);
  };

  const handleEditorClose = () => {
    setEditorOpen(false);
    setEditingType(null);
  };

  const handleSaved = () => {
    setEditorOpen(false);
    setEditingType(null);
    if (org) getClinicStore().refreshWorkflows(org.id);
  };

  if (!workflowsLoaded) {
    return (
      <div className="p-5 space-y-4">
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
    <div className="p-5 space-y-4">
      {/* ── Appointment types section ── */}

      {/* Label + explainer + button */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-gray-800">Appointment types</span>
          <p className="text-[13px] italic mt-1" style={{ color: "#8A8985" }}>
            Pre-appointment workflows are triggered when an appointment of a given type is created. Each appointment type has one intake package attached to it.
          </p>
        </div>
        <button
          onClick={handleNewType}
          className="flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-teal-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-600 active:bg-teal-700 transition-colors"
        >
          + New appointment type
        </button>
      </div>

      {/* Appointment types table (run_sheet only) */}
      {runSheetTypes.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">
          No appointment types yet. Create one to get started.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
          {/* Column headers */}
          <div className="grid grid-cols-5 gap-3 px-5 py-2 border-b border-gray-200">
            <span className="text-[11px] tracking-wide text-gray-500">Appointment type</span>
            <span className="text-[11px] tracking-wide text-gray-500">Actions</span>
            <span className="text-[11px] tracking-wide text-gray-500">Duration</span>
            <span className="text-[11px] tracking-wide text-gray-500">Modality</span>
            <span className="text-[11px] tracking-wide text-gray-500">Status</span>
          </div>

          {/* Rows */}
          {runSheetTypes.map((type, i) => {
            const hasInFlight = type.pre_workflow_template_id && type.in_flight_count > 0;
            const actionLabel = type.action_count > 0
              ? `${type.action_count} action${type.action_count === 1 ? "" : "s"}`
              : "Not configured";

            return (
              <button
                key={type.id}
                onClick={() => handleRowClick(type)}
                className={`grid grid-cols-5 gap-3 w-full px-5 py-2.5 text-left transition-colors hover:bg-gray-50/50 ${
                  i < runSheetTypes.length - 1 ? "border-b border-gray-100" : ""
                }`}
                style={{ backgroundColor: hasInFlight ? IN_FLIGHT_ROW_BG : undefined }}
              >
                {/* Name */}
                <div className="min-w-0 self-center">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{type.name}</span>
                    {type.source === "pms" && (
                      <svg className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <span className="text-xs self-center" style={{ color: IDLE_GREY }}>{actionLabel}</span>

                {/* Duration */}
                <span className="text-sm text-gray-600 self-center">{type.duration_minutes} min</span>

                {/* Modality */}
                <div className="self-center"><ModalityPill modality={type.modality} /></div>

                {/* Status */}
                <div className="self-center"><RuntimeStateCell type={type} /></div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Standalone collections section ── */}

      {/* Label + explainer + button */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <div>
          <span className="text-sm font-medium text-gray-800">Standalone collections</span>
          <p className="text-[13px] italic mt-1" style={{ color: IDLE_GREY }}>
            Send forms to patients outside of an appointment. Terminates when all forms are returned.
          </p>
        </div>
        <button
          onClick={handleNewCollection}
          className="flex-shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 transition-colors"
        >
          + New collection
        </button>
      </div>

      {/* Collections table */}
      {collectionTypes.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500">
          No standalone collections yet.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
          {/* Column headers */}
          <div className="grid grid-cols-3 gap-3 px-5 py-2 border-b border-gray-200">
            <span className="text-[11px] tracking-wide text-gray-500">Collection</span>
            <span className="text-[11px] tracking-wide text-gray-500">Actions</span>
            <span className="text-[11px] tracking-wide text-gray-500">Status</span>
          </div>

          {/* Rows */}
          {collectionTypes.map((type, i) => {
            const hasInFlight = type.pre_workflow_template_id && type.in_flight_count > 0;
            const actionLabel = type.action_count > 0
              ? `${type.action_count} action${type.action_count === 1 ? "" : "s"}`
              : "Not configured";

            return (
              <button
                key={type.id}
                onClick={() => handleRowClick(type)}
                className={`grid grid-cols-3 gap-3 w-full px-5 py-2.5 text-left transition-colors hover:bg-gray-50/50 ${
                  i < collectionTypes.length - 1 ? "border-b border-gray-100" : ""
                }`}
                style={{ backgroundColor: hasInFlight ? IN_FLIGHT_ROW_BG : undefined }}
              >
                {/* Name */}
                <div className="min-w-0 self-center">
                  <span className="text-sm font-medium text-gray-800 truncate block">{type.name}</span>
                </div>

                {/* Actions */}
                <span className="text-xs self-center" style={{ color: IDLE_GREY }}>{actionLabel}</span>

                {/* Status */}
                <div className="self-center"><RuntimeStateCell type={type} /></div>
              </button>
            );
          })}
        </div>
      )}

      {/* Editor slide-out */}
      {editorOpen && (
        <AppointmentTypeEditor
          appointmentType={editingType}
          forceTerminalType={editorTerminalType}
          onClose={handleEditorClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
