"use client";

import { useEffect, useState } from "react";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import { useOrg } from "@/hooks/useOrg";
import { useLocation } from "@/hooks/useLocation";
import { usePmsConnection } from "@/hooks/usePmsConnection";
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

  const { selectedLocation } = useLocation();

  // Fetch-if-empty
  useEffect(() => {
    if (!org) return;
    if (!getClinicStore().workflowsLoaded) {
      void getClinicStore().refreshWorkflows(org.id);
    }
  }, [org]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingType, setEditingType] = useState<AppointmentTypeRow | null>(null);

  // PMS refresh — only meaningful when the selected location has a SYNC-ACTIVE
  // connection (credentials present + a real adapter). A stubbed Gentu marker
  // or no PMS reports syncActive:false, so the button stays hidden and we never
  // attempt to pull appointment types.
  // Shared from context (fetched once) — no per-component poll.
  const pms = usePmsConnection();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const handleRefreshFromPms = async () => {
    const locationId = selectedLocation?.id;
    if (!locationId) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/pms/import-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        imported?: number;
        total?: number;
        detail?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setRefreshMsg(
          data.imported && data.imported > 0
            ? `Imported ${data.imported} new appointment type${data.imported === 1 ? "" : "s"}.`
            : "No new appointment types — you're up to date."
        );
        if (org) await getClinicStore().refreshWorkflows(org.id);
      } else {
        setRefreshMsg(data.detail ?? data.error ?? "Couldn't refresh from the PMS.");
      }
    } catch {
      setRefreshMsg("Couldn't reach the server.");
    } finally {
      setRefreshing(false);
    }
  };

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
      {/* Label + explainer + button */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-gray-800">Appointment types</span>
          <p className="text-[13px] italic mt-1" style={{ color: "#8A8985" }}>
            Pre-appointment workflows are triggered when an appointment of a given type is created. Each appointment type has one intake package attached to it.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* PMS refresh — only when the location has a sync-active connection.
              Hidden for stubbed Gentu / no PMS (syncActive false). */}
          {pms.syncActive && (
            <button
              onClick={handleRefreshFromPms}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50"
              title={`Pull appointment types from ${pms.providerLabel ?? "PMS"}`}
            >
              <svg
                className={`h-3.5 w-3.5 text-gray-400 ${refreshing ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? "Refreshing…" : `Refresh from ${pms.providerLabel ?? "PMS"}`}
            </button>
          )}
          <button
            onClick={handleNewType}
            className="inline-flex items-center justify-center rounded-lg bg-teal-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-600 active:bg-teal-700 transition-colors"
          >
            + New appointment type
          </button>
        </div>
      </div>

      {refreshMsg && (
        <p className="text-[13px] text-gray-600">{refreshMsg}</p>
      )}

      {/* Appointment types table */}
      {appointmentTypes.length === 0 ? (
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
          {appointmentTypes.map((type, i) => {
            const hasInFlight = type.pre_workflow_template_id && type.in_flight_count > 0;
            const actionLabel = type.action_count > 0
              ? `${type.action_count} action${type.action_count === 1 ? "" : "s"}`
              : "Not configured";

            return (
              <button
                key={type.id}
                onClick={() => handleRowClick(type)}
                className={`grid grid-cols-5 gap-3 w-full px-5 py-2.5 text-left transition-colors hover:bg-gray-50/50 ${
                  i < appointmentTypes.length - 1 ? "border-b border-gray-100" : ""
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
                  {type.is_pms_unconfirmed && (
                    <span className="text-[11px] text-amber-600">
                      Needs setup — open this type to confirm modality &amp; turn on sync
                    </span>
                  )}
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
