"use client";

import { useState, useEffect, useMemo, useCallback, useTransition } from "react";
import dynamic from "next/dynamic";
import { getJson, postJson } from "@/lib/api-client";
import { RunsheetHeader } from "./runsheet-header";
import { RoomContainer } from "./room-container";
import { enrichSessions } from "@/lib/runsheet/derived-state";
import { groupSessionsByRoom, calculateSummary } from "@/lib/runsheet/grouping";
import { useTabNotifications } from "@/hooks/useTabNotifications";
import { useFaviconBadge } from "@/hooks/useFaviconBadge";
import { seedDemoData, nukeSessions } from "@/lib/runsheet/seed";
import { PatientContactCard } from "@/components/clinic/patient/patient-contact-card";
import { PatientSlideOverProvider } from "@/components/clinic/patient/patient-slide-over-context";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { OnboardingState } from "@/stores/clinic-store";
import { useLocation } from "@/hooks/useLocation";
import { useRole } from "@/hooks/useRole";
import { usePmsConnection } from "@/hooks/usePmsConnection";
import { usePmsSync } from "@/hooks/usePmsSync";
import { useNow } from "@/hooks/useNow";
// ONBOARDING DISABLED — the first-login walkthrough is currently turned off.
// To re-enable: uncomment the two mounts in the JSX below (search "ONBOARDING DISABLED")
// and remove the eslint-disable comments on these two imports.
// See docs/plans/remove-runsheet-ctas-and-onboarding.md
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { OnboardingOverlay } from "@/components/clinic/onboarding/onboarding-overlay";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { OnboardingCoachMark } from "@/components/clinic/onboarding/onboarding-coach-mark";
import { RoomContainerSkeleton } from "./room-container-skeleton";

const EMPTY_SUMMARY = {
  total: 0,
  late: 0,
  upcoming: 0,
  waiting: 0,
  active: 0,
  complete: 0,
  done: 0,
};

// Lazy-load heavy modals — only downloaded when first opened
const ProcessFlowDynamic = dynamic(
  () => import("@/components/clinic/process-flow/process-flow").then((mod) => mod.ProcessFlow),
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
  // Read from Zustand store. If a slice isn't loaded yet, the effect below
  // fetches it once per tab via the store's refresh* action.
  const sessions = useClinicStore((s) => s.sessions);
  const rooms = useClinicStore((s) => s.rooms);
  const clinicianRoomIds = useClinicStore((s) => s.clinicianRoomIds);
  const connectedSessions = useClinicStore((s) => s.connectedSessions);
  const sessionsLoaded = useClinicStore((s) => s.sessionsLoaded);
  const roomsLoaded = useClinicStore((s) => s.roomsLoaded);
  const clinicianRoomIdsLoaded = useClinicStore((s) => s.clinicianRoomIdsLoaded);
  const onboardingLoaded = useClinicStore((s) => s.onboardingLoaded);
  // Track what location the store's data is for. The selected-location
  // context can move ahead of the store briefly (between switcher change
  // and ClinicDataProvider's effect resetting the store), so the skeleton
  // gate also checks this matches before unblocking render.
  const storeLocationId = useClinicStore((s) => s.locationId);

  // Context (persists across navigations)
  const { selectedLocation } = useLocation();
  const { role } = useRole();
  const locationId = selectedLocation?.id ?? "";
  const timezone = selectedLocation?.timezone ?? "Australia/Sydney";

  // Refetch helper — delegates to store
  const refetch = useCallback(async () => {
    if (locationId) await getClinicStore().refreshSessions(locationId);
  }, [locationId]);

  // Cold-load fetch error: surfaces a retry affordance instead of leaving
  // the user staring at a skeleton forever when a transient fetch fails.
  const [fetchError, setFetchError] = useState(false);
  // Bumping this triggers the fetch effect to re-run on user retry.
  const [retryKey, setRetryKey] = useState(0);

  // Fetch-if-empty: populate critical slices on first visit (once per tab
  // lifetime). Only rooms, clinician scope, and sessions are pulled here —
  // workflows/forms/files are owned by their consumers (Process flow,
  // Workflows tab, Readiness) so cold-load isn't blocked by config data
  // the user may not need this session.
  useEffect(() => {
    if (!locationId) return;
    const store = getClinicStore();
    setFetchError(false);
    // The store's refresh actions swallow errors (so all fire-and-forget
    // callers across the app don't see unhandled rejections). To detect
    // cold-load failure here, we kick the refreshes off, await settlement,
    // then inspect whether the loaded flags actually flipped. If one or
    // more didn't, we surface the retry affordance.
    let cancelled = false;
    const needSessions = !store.sessionsLoaded;
    const needRooms = !store.roomsLoaded;
    const needClinicianRoomIds = !store.clinicianRoomIdsLoaded;
    const critical: Promise<unknown>[] = [];
    if (needSessions) critical.push(store.refreshSessions(locationId));
    if (needRooms) critical.push(store.refreshRooms(locationId));
    if (needClinicianRoomIds) {
      critical.push(store.refreshClinicianRoomIds(locationId));
    }
    if (critical.length > 0) {
      void Promise.all(critical).then(() => {
        if (cancelled) return;
        const s = getClinicStore();
        // Skip the check if the user has switched locations — the new
        // location's effect run will own its own loaded-flag status.
        if (s.locationId !== locationId) return;
        const failed =
          (needSessions && !s.sessionsLoaded) ||
          (needRooms && !s.roomsLoaded) ||
          (needClinicianRoomIds && !s.clinicianRoomIdsLoaded);
        if (failed) setFetchError(true);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [locationId, retryKey]);

  // Onboarding fetch — replaces the SSR call that used to live in page.tsx.
  // setOnboarding flips onboardingLoaded → true, which un-suppresses the
  // overlay/coach-mark gates added in the same change.
  useEffect(() => {
    if (onboardingLoaded) return;
    let cancelled = false;
    void (async () => {
      // Failures swallowed — onboarding is non-critical for the run sheet itself.
      const result = await getJson<Partial<OnboardingState>>("/api/onboarding/state");
      if (!result.ok || cancelled) return;
      getClinicStore().setOnboarding(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [onboardingLoaded]);

  // Tick `now` every 30s for derived state recalculation
  const now = useNow();

  // Filter rooms for clinician view. The skeleton gate above guarantees
  // clinicianRoomIdsLoaded === true by the time this runs, so an empty array
  // correctly means "zero assigned rooms" (empty filter result) rather than
  // "not loaded yet" (formerly fell through to show all rooms).
  const visibleRooms = useMemo(() => {
    if (role === "clinician") {
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

  // PMS connection — shared from context (fetched once), no per-component poll.
  // The "Sync now" button only appears when the location is sync-active.
  const pms = usePmsConnection();
  const {
    isSyncing,
    syncMsg,
    syncNow: handleSyncNow,
  } = usePmsSync({ locationId, onSynced: refetch });

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

  // Video panel closing is user-driven (Leave or Hold button inside the panel).
  // No auto-close — the clinician controls when the panel dismisses.

  const onboarding = useClinicStore((s) => s.onboarding);

  async function advanceOnboardingStage(to: "call_active" | "call_completed") {
    await postJson("/api/onboarding/advance-stage", { to });
    getClinicStore().setOnboarding({ stage: to });
  }

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
      const { admitPatient } = await import(
        "@/lib/runsheet/actions"
      );

      switch (action) {
        case "admit": {
          const result = await admitPatient(sessionId);
          if (result.success) {
            setActiveCallSessionId(sessionId);
            if (onboarding.testSessionId === sessionId && onboarding.stage === "test_session_sent") {
              void advanceOnboardingStage("call_active");
            }
          }
          break;
        }
      }
    },
    [onboarding.testSessionId, onboarding.stage]
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

  // Show full-page skeleton until room structure and clinician scope are
  // known. Sessions are allowed to render later — rooms paint with skeleton
  // rows inside them until sessionsLoaded flips. `storeLocationId !== locationId`
  // covers the window after the user picks a new location but before
  // ClinicDataProvider has reset the store and refetched, so we don't
  // briefly render the previous location's rooms under the new context.
  //
  // Cold-load failure UX: if rooms or clinician scope failed, the full-page
  // retry is correct — we can't draw structure. If only sessions failed,
  // we fall through and render rooms with an inline sessions-failed banner.
  const structuralLoading =
    storeLocationId !== locationId ||
    !roomsLoaded ||
    !clinicianRoomIdsLoaded;
  const structuralError =
    fetchError && (!roomsLoaded || !clinicianRoomIdsLoaded);
  if (structuralLoading) {
    if (structuralError) {
      return (
        <PatientSlideOverProvider onOpenPatient={handleOpenPatient}>
          <div className="p-6 max-w-[860px] mx-auto">
            <div className="mb-4">
              <RunsheetHeader
                summary={EMPTY_SUMMARY}
                showAddButton={false}
                onSeed={handleSeed}
                isSeeding={isSeeding}
                onNuke={handleNuke}
                isNuking={isNuking}
              />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-4">
              <p className="text-gray-800 font-medium">Couldn&apos;t load the run sheet</p>
              <p className="text-sm text-gray-500">
                Check your connection and try again.
              </p>
              <button
                onClick={() => setRetryKey((k) => k + 1)}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </PatientSlideOverProvider>
      );
    }
    return (
      <PatientSlideOverProvider onOpenPatient={handleOpenPatient}>
        <div className="p-6 max-w-[860px] mx-auto">
          <div className="mb-4">
            <RunsheetHeader
              summary={EMPTY_SUMMARY}
              showAddButton={false}
              onSeed={handleSeed}
              isSeeding={isSeeding}
              onNuke={handleNuke}
              isNuking={isNuking}
            />
          </div>
          <div className="space-y-3">
            <RoomContainerSkeleton />
            <RoomContainerSkeleton />
            <RoomContainerSkeleton />
          </div>
        </div>
      </PatientSlideOverProvider>
    );
  }

  // Sessions-only failure: rooms are drawn, but session fetch didn't land.
  // Surface an inline retry banner above the rooms instead of replacing
  // the page.
  const sessionsFailed = fetchError && !sessionsLoaded;
  const sessionsLoading = !sessionsLoaded;

  return (
    <PatientSlideOverProvider onOpenPatient={handleOpenPatient}>
      {/* ONBOARDING DISABLED — uncomment these two mounts to re-enable the
          first-login walkthrough (also remove the eslint-disable on the imports).
          See docs/plans/remove-runsheet-ctas-and-onboarding.md */}
      {/* <OnboardingOverlay /> */}
      {/* <OnboardingCoachMark /> */}
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
          showSync={isReceptionist && pms.syncActive}
          syncLabel={pms.providerLabel ?? "PMS"}
          isSyncing={isSyncing}
          onSync={handleSyncNow}
        />
        {syncMsg && (
          <p className="mt-2 text-[13px] text-gray-600">{syncMsg}</p>
        )}
      </div>

      {sessionsFailed && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">
            Couldn&apos;t load sessions. Rooms are shown without session data.
          </p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="inline-flex items-center gap-2 rounded-lg bg-white border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

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
            sessionsLoading={sessionsLoading}
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
        // Seed the shell from the run-sheet row so the header (name, avatar,
        // phone) paints instantly — same staged treatment as readiness. Phone
        // comes from the appointment's contact number; /summary makes the
        // authoritative phone list override it.
        patientSeed={
          contactSession?.patient_id
            ? {
                id: contactSession.patient_id,
                firstName: contactSession.patient_first_name ?? "",
                lastName: contactSession.patient_last_name ?? "",
                primaryPhone: contactSession.phone_number,
              }
            : null
        }
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
          onClose={() => {
            setActiveCallSessionId(null);
            if (onboarding.testSessionId === activeCallSession.session_id && onboarding.stage === "call_active") {
              void advanceOnboardingStage("call_completed");
            }
          }}
        />
      )}
    </div>
    </PatientSlideOverProvider>
  );
}
