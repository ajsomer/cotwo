"use client";

import { useState, useEffect, useMemo, useCallback, useTransition } from "react";
import { RunsheetHeader } from "./runsheet-header";
import { RoomContainer } from "./room-container";
import { enrichSessions } from "@/lib/runsheet/derived-state";
import { groupSessionsByRoom, calculateSummary } from "@/lib/runsheet/grouping";
import { useRealtimeRunsheet } from "@/hooks/useRealtimeRunsheet";
import { usePatientPresence } from "@/hooks/usePatientPresence";
import { useTabNotifications } from "@/hooks/useTabNotifications";
import { useFaviconBadge } from "@/hooks/useFaviconBadge";
import { seedDemoData, nukeSessions } from "@/lib/runsheet/seed";
import { PatientContactCard } from "./patient-contact-card";
import type { RunsheetSession, Room, UserRole } from "@/lib/supabase/types";

interface RunsheetShellProps {
  initialSessions: RunsheetSession[];
  rooms: Room[];
  locationId: string;
  locationName: string;
  timezone: string;
  role: UserRole;
  clinicianRoomIds?: string[];
}

export function RunsheetShell({
  initialSessions,
  rooms,
  locationId,
  locationName,
  timezone,
  role,
  clinicianRoomIds,
}: RunsheetShellProps) {
  // Real-time session state
  const { sessions, refetch } = useRealtimeRunsheet({
    initialSessions,
    locationId,
  });

  // Patient presence tracking
  const connectedSessions = usePatientPresence(locationId);

  // Tick `now` every 30s for derived state recalculation
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Filter rooms for clinician view
  const visibleRooms = useMemo(() => {
    if (clinicianRoomIds) {
      return rooms.filter((r) => clinicianRoomIds.includes(r.id));
    }
    return rooms;
  }, [rooms, clinicianRoomIds]);

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

  const isReceptionist = role === "receptionist" || role === "practice_manager" || role === "clinic_owner";
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
  const contactSession = useMemo(
    () => contactSessionId ? enriched.find((s) => s.session_id === contactSessionId) ?? null : null,
    [contactSessionId, enriched]
  );

  const handlePatientClick = useCallback((sessionId: string) => {
    const session = enriched.find((s) => s.session_id === sessionId);
    if (session?.patient_id) {
      setContactSessionId(sessionId);
    }
  }, [enriched]);

  // Process flow state
  const [processingSessionId, setProcessingSessionId] = useState<string | null>(null);
  const [bulkProcessQueue, setBulkProcessQueue] = useState<string[]>([]);

  // Action dispatch
  const handleAction = useCallback(
    async (sessionId: string, action: string) => {
      if (action === "process") {
        setProcessingSessionId(sessionId);
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
        case "admit":
          await admitPatient(sessionId);
          break;
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

  // Lazy-load process flow and add session panel
  const ProcessFlow = useMemo(() => {
    if (!processingSessionId) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProcessFlow: PF } = require("./process-flow");
    const session = enriched.find((s) => s.session_id === processingSessionId);
    if (!session) return null;
    return (
      <PF
        session={session}
        onComplete={handleProcessComplete}
        onClose={() => {
          setProcessingSessionId(null);
          setBulkProcessQueue([]);
        }}
        isBulk={bulkProcessQueue.length > 0}
        timezone={timezone}
      />
    );
  }, [processingSessionId, enriched, handleProcessComplete, bulkProcessQueue, timezone]);

  const AddSessionPanel = useMemo(() => {
    if (!addSessionOpen) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AddSessionPanel: ASP } = require("./add-session-panel");
    return (
      <ASP
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
    );
  }, [addSessionOpen, locationId, visibleRooms, editingSessionId, enriched, timezone, refetch]);

  return (
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

      {ProcessFlow}
      {AddSessionPanel}
      <PatientContactCard
        session={contactSession}
        open={!!contactSessionId}
        onClose={() => setContactSessionId(null)}
      />
    </div>
  );
}
