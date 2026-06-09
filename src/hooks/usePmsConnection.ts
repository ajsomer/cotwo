"use client";

import { createContext, useContext } from "react";

/**
 * Shared PMS connection status for the selected location, fetched ONCE in the
 * clinic providers (like auth/location context) instead of every component
 * polling /api/pms/connection independently. That independent polling caused
 * Cliniko-dependent UI (run-sheet/tasks "Sync now", the patient slideout
 * "Open in {PMS}", intake-handoff "Sync to {PMS}") to flicker in after mount.
 */
export interface PmsConnectionStatus {
  /** True when the location has a sync-active connection (creds + adapter). */
  syncActive: boolean;
  /** Display label, e.g. "Cliniko". Null when no connection. */
  providerLabel: string | null;
  /** Account subdomain for web deep links (Cliniko). */
  accountSubdomain: string | null;
  /** False while the first fetch is in flight (avoids a flash of "no PMS"). */
  loaded: boolean;
  /** Re-fetch (after connect/disconnect/subdomain edit). */
  refresh: () => void;
}

export const PmsConnectionContext = createContext<PmsConnectionStatus>({
  syncActive: false,
  providerLabel: null,
  accountSubdomain: null,
  loaded: false,
  refresh: () => {},
});

export function usePmsConnection() {
  return useContext(PmsConnectionContext);
}
