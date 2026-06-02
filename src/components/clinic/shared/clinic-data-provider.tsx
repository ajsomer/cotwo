"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "@/hooks/useLocation";
import { useOrg } from "@/hooks/useOrg";
import { getSocket } from "@/lib/socket-client";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";

interface ClinicDataProviderProps {
  children: ReactNode;
}

export function ClinicDataProvider({ children }: ClinicDataProviderProps) {
  const { selectedLocation } = useLocation();
  const { org } = useOrg();
  const locationId = selectedLocation?.id ?? null;
  const orgId = org?.id ?? null;

  // Seed locationId/orgId so store selectors that read them return sane
  // values. Each page populates its own slices via fetch-if-empty hooks.
  const seededRef = useRef(false);
  if (!seededRef.current && locationId && orgId) {
    useClinicStore.setState({ locationId, orgId });
    seededRef.current = true;
  }

  // Socket.IO: join this location's room and listen for live events.
  //  - `session_changed` → refresh the sessions slice
  //  - `presence:update` → update the connected-sessions set (patient tabs
  //    that are currently in the waiting room, for the "connected" dot on
  //    the run sheet).
  useEffect(() => {
    if (!locationId) return;
    const socket = getSocket();

    // On every (re)connect: join the location room AND resync sessions +
    // readiness, since we may have missed events while disconnected.
    //
    // Per-slice freshness gate: skip the resync for any slice that was
    // hydrated/fetched within the last 30s. This suppresses the cold-load
    // race where the first socket `connect` fires moments after SSR
    // hydration and would otherwise refetch what we just received. Real
    // post-disconnect reconnects have stale timestamps and refresh as before.
    const FRESH_WINDOW_MS = 30_000;
    const onConnect = () => {
      socket.emit("join:location", locationId);
      const store = getClinicStore();
      const now = Date.now();
      // Location must match too — a recent timestamp for a different
      // location must not suppress a real refresh.
      const locationMatches = store.locationId === locationId;
      const sessionsFresh =
        locationMatches &&
        store.sessionsLoaded &&
        store.sessionsFetchedAt != null &&
        now - store.sessionsFetchedAt < FRESH_WINDOW_MS;
      const readinessFresh =
        locationMatches &&
        store.readinessLoadedPre &&
        store.readinessFetchedAt != null &&
        now - store.readinessFetchedAt < FRESH_WINDOW_MS;
      if (!sessionsFresh) void store.refreshSessions(locationId);
      if (!readinessFresh) void store.refreshReadiness(locationId);
    };
    if (socket.connected) socket.emit("join:location", locationId);
    socket.on("connect", onConnect);

    const onSessionChanged = () => {
      const currentLocId = getClinicStore().locationId;
      if (currentLocId) {
        void getClinicStore().refreshSessions(currentLocId);
      }
    };
    socket.on("session_changed", onSessionChanged);

    const onReadinessChanged = () => {
      const currentLocId = getClinicStore().locationId;
      if (currentLocId) {
        void getClinicStore().refreshReadiness(currentLocId);
      }
    };
    socket.on("readiness_changed", onReadinessChanged);

    const onPresenceUpdate = (payload: { sessionIds: string[] }) => {
      getClinicStore().setConnectedSessions(new Set(payload.sessionIds ?? []));
    };
    socket.on("presence:update", onPresenceUpdate);

    return () => {
      socket.off("connect", onConnect);
      socket.off("session_changed", onSessionChanged);
      socket.off("readiness_changed", onReadinessChanged);
      socket.off("presence:update", onPresenceUpdate);
    };
  }, [locationId]);

  // Org-wide socket room. Used for events that don't belong to a single
  // location — currently `submission_changed` fired by the standalone form
  // submit route. The server's join:org handler authorises against the
  // user's staff_assignments → locations.org_id chain, so anonymous /
  // foreign-org clients can't subscribe.
  useEffect(() => {
    if (!orgId) return;
    const socket = getSocket();

    const onConnect = () => {
      socket.emit("join:org", orgId);
      const store = getClinicStore();
      if (store.orgId === orgId) {
        void store.refreshStandaloneSubmissions(orgId);
      }
    };
    if (socket.connected) socket.emit("join:org", orgId);
    socket.on("connect", onConnect);

    const onSubmissionChanged = () => {
      const currentOrgId = getClinicStore().orgId;
      if (currentOrgId) {
        void getClinicStore().refreshStandaloneSubmissions(currentOrgId);
      }
    };
    socket.on("submission_changed", onSubmissionChanged);

    return () => {
      socket.off("connect", onConnect);
      socket.off("submission_changed", onSubmissionChanged);
    };
  }, [orgId]);

  // Location switch handler — only fires when the user actually changes
  // location (multi-location switcher). Resets location-scoped slices and
  // re-fetches via the store's refresh* actions. First render is a no-op
  // because each page hydrates its own slice.
  const prevLocationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!locationId || !orgId) return;

    if (prevLocationIdRef.current === null) {
      prevLocationIdRef.current = locationId;
      return;
    }

    if (prevLocationIdRef.current === locationId) return;

    prevLocationIdRef.current = locationId;
    const store = getClinicStore();

    store.resetLocationData();
    useClinicStore.setState({ locationId, orgId });
    void Promise.all([
      store.refreshSessions(locationId),
      store.refreshRooms(locationId),
      store.refreshReadiness(locationId),
      store.refreshPaymentConfig(locationId),
      store.refreshClinicianRoomIds(locationId),
    ]);
  }, [locationId, orgId]);

  return <>{children}</>;
}
