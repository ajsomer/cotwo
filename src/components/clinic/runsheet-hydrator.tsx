"use client";

import { useState, type ReactNode } from "react";
import { getClinicStore } from "@/stores/clinic-store";
import type { RunsheetSession } from "@/lib/supabase/types";
import type { RoomWithClinicians } from "@/stores/clinic-store";

interface RunsheetHydratorProps {
  locationId: string;
  orgId: string;
  initialData: {
    sessions: RunsheetSession[];
    rooms: RoomWithClinicians[];
    clinicianRoomIds: string[];
  };
  children: ReactNode;
}

/**
 * Synchronously hydrates the runsheet's required slices into the Zustand
 * store before children render. Eliminates the cold-load fetch + flicker
 * that would otherwise happen when RunsheetShell's fetch-if-empty effect
 * sees `sessionsLoaded: false`.
 *
 * Location guard: if the store already holds a *different* locationId
 * (e.g., the user switched location in another tab and the layout context
 * picked something else), this hydrator skips. The shell's existing
 * fetch-if-empty path will populate slices for the actually-selected
 * location.
 */
export function RunsheetHydrator({
  locationId,
  orgId,
  initialData,
  children,
}: RunsheetHydratorProps) {
  // useState initializer runs exactly once on mount, before children
  // render. The returned value is unused — we use the initializer for its
  // side effect on the external Zustand store.
  useState(() => {
    const store = getClinicStore();
    const storeLocationId = store.locationId;
    const before = {
      locationId,
      storeLocationId,
      sessionsLoaded: store.sessionsLoaded,
      sessionsFetchedAt: store.sessionsFetchedAt,
    };
    if (storeLocationId == null || storeLocationId === locationId) {
      store.hydrateRunsheetSlices(locationId, orgId, initialData);
    }
    const after = getClinicStore();
    console.log("[RunsheetHydrator]", {
      ...before,
      hydrated: storeLocationId == null || storeLocationId === locationId,
      afterSessionsLoaded: after.sessionsLoaded,
      afterSessionsFetchedAt: after.sessionsFetchedAt,
      afterStoreLocationId: after.locationId,
    });
    return null;
  });

  return <>{children}</>;
}
