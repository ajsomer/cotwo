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
    const onConnect = () => {
      socket.emit("join:location", locationId);
      void getClinicStore().refreshSessions(locationId);
      void getClinicStore().refreshReadiness(locationId);
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
