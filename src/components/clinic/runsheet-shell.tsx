"use client";

import { useState, useEffect, useMemo, useCallback, useTransition } from "react";
import dynamic from "next/dynamic";
import { RunsheetHeader } from "./runsheet-header";
import { RoomContainer } from "./room-container";
import { enrichSessions } from "@/lib/runsheet/derived-state";
import { groupSessionsByRoom, calculateSummary } from "@/lib/runsheet/grouping";
import { useTabNotifications } from "@/hooks/useTabNotifications";
import { useFaviconBadge } from "@/hooks/useFaviconBadge";
import { seedDemoData, nukeSessions } from "@/lib/runsheet/seed";
import { PatientContactCard } from "./patient-contact-card";
import { PatientSlideOverProvider } from "./patient-slide-over-context";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import { useLocation } from "@/hooks/useLocation";
import { useRole } from "@/hooks/useRole";

// Lazy-load heavy modals — only downloaded when first opened
const ProcessFlowDynamic = dynamic(
  () => import("./process-flow").then((mod) => mod.ProcessFlow),
  { ssr: false }
);
const AddSessionPanelDynamic = dynamic(
  () => import("./add-session-panel").then((mod) => mod.AddSessionPanel),
  { ssr: false }
);
const VideoCallPanelDynamic = dynamic(
  () => import("./video-call-panel").then((mod) => mod.VideoCallPanel),
  { ssr: false }
);

export function RunsheetShell() {
  // Read from Zustand store (kept fresh by Realtime subscriptions in layout)
  const sessions = useClinicStore((s) => s.sessions);
  const rooms = useClinicStore((s) => s.rooms);
  const clinicianRoomIds = useClinicStore((s) => s.clinicianRoomIds);
  const connectedSessions = useClinicStore((s) => s.connectedSessions);
  const sessionsLoaded = useClinicStore((s) => s.sessionsLoaded);

  // Context (persists across navigations)
  const { selectedLocation } = useLocation();
  const { role } = useRole();
  const locationId = selectedLocation?.id ?? "";
  const timezone = selectedLocation?.timezone ?? "Australia/Sydney";

  // Refetch helper — delegates to store
  const refetch = useCallback(async () => {
    if (locationId) await getClinicStore().refreshSessions(locationId);
  }, [locationId]);

  // Tick `now` every 30s for derived state recalculation
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Filter rooms for clinician view
  const visibleRooms = useMemo(() => {
    if (clinicianRoomIds.length > 0 && (role === "clinician")) {
      return rooms.filter((r) => clinicianRoomIds.includes(r.id));
    }
    return rooms;
  }, [rooms, clinicianRoomIds, role]);

  // Enrich sessions with derived state and group by room
  const enriched = useMemo(() => enrichSessions(sessions, now, connectedSessions), [sessions, now, connectedSessions]);
  const groups = useMemo(
    () => groupSessionsByRoom(enriched, visibleRooms),
    [enriched, visibleRooms]
  );
  const summary = useMemo(() => calculateSummary(groups), [groups]);

  // Background notifications
  useTabNotifications(summary);
  useFaviconBadge(summary);

  const isReceptionist = (role === "receptionist" || role === "practice_manager" || role === "clinic_owner");
  const isClinician = role === "clinician" || role === "clinic_owner";
  const singleRoom = false;

  // Seed state
  const [isSeeding, startSeeding] = useTransition();
  const handleSeed = useCallback(() => {
    startSeeding(async () => {
      const result = await seedDemoData();
      if (result.success) {
        window.location.reload();
      } else {
        console.error("Seed failed:", result.error);
      }
    });
  }, []);

  // Nuke state
  const [isNuking, startNuking] = useTransition();
  const handleNuke = useCallback(() => {
    startNuking(async () => {
      const result = await nukeSessions();
      if (result.success) {
        refetch();
      } else {
        console.error("Nuke failed:", result.error);
      }
    });
  }, [refetch]);

  // Add session panel state
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  // Patient contact card state
  const [contactSessionId, setContactSessionId] = useState<string | null>(null);
  const [contactPatientId, setContactPatientId] = useState<string | null>(null);
  const contactSession = useMemo(
    () => contactSessionId ? enriched.find((s) => s.session_id === contactSessionId) ?? null : null,
    [contactSessionId, enriched]
  );

  const handlePatientClick = useCallback((sessionId: string) => {
    const session = enriched.find((s) => s.session_id === sessionId);
    if (session?.patient_id) {
      setContactSessionId(sessionId);
      setContactPatientId(null);
    }
  }, [enriched]);

  const handleOpenPatient = useCallback((patientId: string) => {
    setContactPatientId(patientId);
    setContactSessionId(null);
  }, []);

  // Process flow state
  const [processingSessionId, setProcessingSessionId] = useState<string | null>(null);
  const [bulkProcessQueue, setBulkProcessQueue] = useState<string[]>([]);

  // Video call panel state
  const [activeCallSessionId, setActiveCallSessionId] = useState<string | null>(null);
  const activeCallSession = useMemo(
    () => activeCallSessionId ? enriched.find((s) => s.session_id === activeCallSessionId) ?? null : null,
    [activeCallSessionId, enriched]
  );

  // Auto-close the panel if the session leaves in_session (ended elsewhere,
  // e.g. the clinician hung up in another tab, or a realtime update).
  useEffect(() => {
    if (!activeCallSessionId) return;
    if (!activeCallSession) return; // session gone (rare)
    const state = activeCallSession.derived_state;
    if (state !== "in_session" && state !== "running_over") {
      setActiveCallSessionId(null);
    }
  }, [activeCallSessionId, activeCallSession]);

  // Action dispatch
  const handleAction = useCallback(
    async (sessionId: string, action: string) => {
      if (action === "process") {
        setProcessingSessionId(sessionId);
        return;
      }

      if (action === "rejoin") {
        setActiveCallSessionId(sessionId);
        return;
      }

      // Import and call server actions dynamically
      const { callPatient, nudgePatient, admitPatient } = await import(
        "@/lib/runsheet/actions"
      );

      switch (action) {
        case "call":
          await callPatient(sessionId);
          break;
        case "nudge":
          await nudgePatient(sessionId);
          break;
        case "admit": {
          const result = await admitPatient(sessionId);
          if (result.success) {
            setActiveCallSessionId(sessionId);
          }
          break;
        }
      }
    },
    []
  );

  // Session row click handler
  const handleSessionClick = useCallback(
    (sessionId: string) => {
      if (isReceptionist) {
        setEditingSessionId(sessionId);
        setAddSessionOpen(true);
      }
    },
    [isReceptionist]
  );

  // Bulk process
  const handleBulkProcess = useCallback(() => {
    const completeSessionIds = enriched
      .filter((s) => s.derived_state === "complete")
      .map((s) => s.session_id);

    if (completeSessionIds.length > 0) {
      setBulkProcessQueue(completeSessionIds.slice(1));
      setProcessingSessionId(completeSessionIds[0]);
    }
  }, [enriched]);

  // Process flow completion
  const handleProcessComplete = useCallback(() => {
    if (bulkProcessQueue.length > 0) {
      setProcessingSessionId(bulkProcessQueue[0]);
      setBulkProcessQueue((prev) => prev.slice(1));
    } else {
      setProcessingSessionId(null);
    }
  }, [bulkProcessQueue]);

  // Process flow and add session panel rendered via next/dynamic (code-split)
  const processingSession = processingSessionId
    ? enriched.find((s) => s.session_id === processingSessionId) ?? null
    : null;

  return (
    <PatientSlideOverProvider onOpenPatient={handleOpenPatient}>
    <div className="p-6 max-w-[860px] mx-auto">
      <div className="mb-4">
        <RunsheetHeader
          summary={summary}
          showAddButton={isReceptionist}
          onAddSession={() => {
            setEditingSessionId(null);
            setAddSessionOpen(true);
          }}
          onSeed={handleSeed}
          isSeeding={isSeeding}
          onNuke={handleNuke}
          isNuking={isNuking}
          onBulkProcess={handleBulkProcess}
        />
      </div>

      <div className="space-y-3">
        {groups.map((group, index) => (
          <RoomContainer
            key={group.room_id}
            group={group}
            roomIndex={index}
            onAction={handleAction}
            onSessionClick={handleSessionClick}
            onPatientClick={handlePatientClick}
            singleRoom={singleRoom}
            totalRooms={groups.length}
          />
        ))}

        {groups.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
            <p className="text-gray-500">No rooms configured for this location</p>
            <button
              onClick={handleSeed}
              disabled={isSeeding}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
            >
              {isSeeding ? "Seeding..." : "Seed demo data"}
            </button>
          </div>
        )}

      </div>

      {processingSession && (
        <ProcessFlowDynamic
          session={processingSession}
          onComplete={handleProcessComplete}
          onClose={() => {
            setProcessingSessionId(null);
            setBulkProcessQueue([]);
          }}
          isBulk={bulkProcessQueue.length > 0}
          timezone={timezone}
        />
      )}
      {addSessionOpen && (
        <AddSessionPanelDynamic
          locationId={locationId}
          rooms={visibleRooms}
          editingSessionId={editingSessionId}
          sessions={enriched}
          onClose={() => {
            setAddSessionOpen(false);
            setEditingSessionId(null);
          }}
          onRefetch={refetch}
          timezone={timezone}
        />
      )}
      <PatientContactCard
        session={contactSession}
        patientId={contactPatientId}
        open={!!contactSessionId || !!contactPatientId}
        onClose={() => {
          setContactSessionId(null);
          setContactPatientId(null);
        }}
      />
      {activeCallSession && (
        <VideoCallPanelDynamic
          sessionId={activeCallSession.session_id}
          patientName={
            [activeCallSession.patient_first_name, activeCallSession.patient_last_name]
              .filter(Boolean)
              .join(" ") || "Patient"
          }
          onClose={() => setActiveCallSessionId(null)}
        />
      )}
    </div>
    </PatientSlideOverProvider>
  );
}
