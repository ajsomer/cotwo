"use client";

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { useLocation } from "@/hooks/useLocation";
import { useOrg } from "@/hooks/useOrg";
import { createClient } from "@/lib/supabase/client";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface ClinicDataProviderProps {
  children: ReactNode;
}

export function ClinicDataProvider({ children }: ClinicDataProviderProps) {
  const { selectedLocation } = useLocation();
  const { org } = useOrg();
  const locationId = selectedLocation?.id ?? null;
  const orgId = org?.id ?? null;

  const prevLocationIdRef = useRef<string | null>(null);
  const orgDataLoadedRef = useRef(false);
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ------------------------------------------------------------------
  // Realtime subscriptions
  // ------------------------------------------------------------------

  const cleanupSubscriptions = useCallback(() => {
    for (const ch of channelsRef.current) {
      ch.unsubscribe();
    }
    channelsRef.current = [];
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const setupSubscriptions = useCallback(
    (locId: string, oId: string) => {
      cleanupSubscriptions();
      const supabase = createClient();
      const channels: RealtimeChannel[] = [];

      // --- Tier 2: Session changes (volatile) ---
      const sessionsChannel = supabase
        .channel(`runsheet:${locId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "sessions",
            filter: `location_id=eq.${locId}`,
          },
          (payload) => {
            getClinicStore().mergeSessionUpdate(
              payload as {
                eventType: string;
                new: Record<string, unknown>;
                old: Record<string, unknown>;
              }
            );
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
            if (!pollingRef.current) {
              pollingRef.current = setInterval(() => {
                const currentLocId = getClinicStore().locationId;
                if (currentLocId) {
                  getClinicStore().refreshSessions(currentLocId);
                  getClinicStore().refreshReadiness(currentLocId);
                }
              }, 30_000);
            }
          }
        });
      channels.push(sessionsChannel);

      // Session participants changes (patient linked/unlinked — refetch sessions)
      const participantsChannel = supabase
        .channel(`runsheet-participants:${locId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "session_participants",
          },
          () => {
            const currentLocId = getClinicStore().locationId;
            if (currentLocId) getClinicStore().refreshSessions(currentLocId);
          }
        )
        .subscribe();
      channels.push(participantsChannel);

      // --- Tier 3: Patient presence ---
      const presenceChannel = supabase
        .channel(`presence:location:${locId}`)
        .on("presence", { event: "sync" }, () => {
          const state = presenceChannel.presenceState();
          const sessionIds = new Set<string>();
          for (const presences of Object.values(state)) {
            for (const presence of presences as Array<{
              session_id?: string;
            }>) {
              if (presence.session_id) sessionIds.add(presence.session_id);
            }
          }
          getClinicStore().setConnectedSessions(sessionIds);
        })
        .on("presence", { event: "join" }, ({ newPresences }) => {
          const prev = getClinicStore().connectedSessions;
          const next = new Set(prev);
          for (const p of newPresences as Array<{ session_id?: string }>) {
            if (p.session_id) next.add(p.session_id);
          }
          getClinicStore().setConnectedSessions(next);
        })
        .on("presence", { event: "leave" }, ({ leftPresences }) => {
          const prev = getClinicStore().connectedSessions;
          const next = new Set(prev);
          for (const p of leftPresences as Array<{ session_id?: string }>) {
            if (p.session_id) next.delete(p.session_id);
          }
          getClinicStore().setConnectedSessions(next);
        })
        .subscribe();
      channels.push(presenceChannel);

      // --- Tier 1: Config table changes (stable but needs Realtime for multi-user) ---

      const roomsChannel = supabase
        .channel(`config-rooms:${locId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "rooms",
            filter: `location_id=eq.${locId}`,
          },
          () => {
            const currentLocId = getClinicStore().locationId;
            if (currentLocId) getClinicStore().refreshRooms(currentLocId);
          }
        )
        .subscribe();
      channels.push(roomsChannel);

      const apptTypesChannel = supabase
        .channel(`config-appt-types:${oId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "appointment_types",
            filter: `org_id=eq.${oId}`,
          },
          () => {
            const currentOrgId = getClinicStore().orgId;
            if (currentOrgId) getClinicStore().refreshWorkflows(currentOrgId);
          }
        )
        .subscribe();
      channels.push(apptTypesChannel);

      const formsChannel = supabase
        .channel(`config-forms:${oId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "forms",
            filter: `org_id=eq.${oId}`,
          },
          () => {
            const currentOrgId = getClinicStore().orgId;
            if (currentOrgId) getClinicStore().refreshForms(currentOrgId);
          }
        )
        .subscribe();
      channels.push(formsChannel);

      // --- Readiness: appointment_actions changes ---
      // KNOWN LIMITATION (production): Subscribing to all appointment_actions
      // changes means we receive events for actions at other locations. For
      // prototype scale this is fine. Production should filter by location_id
      // (requires a join through appointments → location_id) or use a Postgres
      // function to broadcast to location-specific channels.
      let readinessDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      const debouncedReadinessRefresh = () => {
        // Leading-edge debounce: fire immediately on first event, then suppress
        // for 250ms. This ensures the UI feels responsive while avoiding
        // rapid-fire refetches when the workflow engine fires multiple actions.
        if (readinessDebounceTimer) return;
        const currentLocId = getClinicStore().locationId;
        if (currentLocId) getClinicStore().refreshReadiness(currentLocId);
        readinessDebounceTimer = setTimeout(() => {
          readinessDebounceTimer = null;
        }, 250);
      };

      const actionsChannel = supabase
        .channel(`readiness-actions:${locId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "appointment_actions",
          },
          debouncedReadinessRefresh
        )
        .subscribe();
      channels.push(actionsChannel);

      channelsRef.current = channels;
    },
    [cleanupSubscriptions]
  );

  // ------------------------------------------------------------------
  // Hydration + location change handler
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!locationId || !orgId) return;

    if (prevLocationIdRef.current !== locationId) {
      prevLocationIdRef.current = locationId;
      const store = getClinicStore();

      // Reset location-scoped data and refetch
      store.resetLocationData();
      useClinicStore.setState({ locationId, orgId });

      // Location-scoped fetches — always run on first mount and location switch
      const fetches: Promise<void>[] = [
        store.refreshSessions(locationId),
        store.refreshRooms(locationId),
        store.refreshReadiness(locationId),
        store.refreshPaymentConfig(locationId),
        store.refreshClinicianRoomIds(locationId),
      ];

      // Org-scoped fetches — only on first mount, not on location switch
      if (!orgDataLoadedRef.current) {
        orgDataLoadedRef.current = true;
        fetches.push(
          store.refreshForms(orgId),
          store.refreshWorkflows(orgId),
        );
      }

      Promise.all(fetches);

      // Set up (or re-create) Realtime subscriptions for this location
      setupSubscriptions(locationId, orgId);
    }

    return () => {
      cleanupSubscriptions();
    };
  }, [locationId, orgId, setupSubscriptions, cleanupSubscriptions]);

  return <>{children}</>;
}
