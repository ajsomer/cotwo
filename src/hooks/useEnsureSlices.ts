'use client';

import { useEffect } from 'react';
import {
  useClinicStore,
  getClinicStore,
  type ClinicStore,
} from '@/stores/clinic-store';

interface SliceSpec {
  scope: 'location' | 'org';
  isLoaded: (s: ClinicStore) => boolean;
  refresh: (s: ClinicStore, id: string) => Promise<void>;
}

const SLICE_SPECS = {
  sessions: {
    scope: 'location',
    isLoaded: (s) => s.sessionsLoaded,
    refresh: (s, id) => s.refreshSessions(id),
  },
  rooms: {
    scope: 'location',
    isLoaded: (s) => s.roomsLoaded,
    refresh: (s, id) => s.refreshRooms(id),
  },
  readiness: {
    scope: 'location',
    isLoaded: (s) => s.readinessLoadedPre && s.readinessLoadedPost,
    refresh: (s, id) => s.refreshReadiness(id),
  },
  paymentConfig: {
    scope: 'location',
    isLoaded: (s) => s.paymentConfigLoaded,
    refresh: (s, id) => s.refreshPaymentConfig(id),
  },
  clinicianRoomIds: {
    scope: 'location',
    isLoaded: (s) => s.clinicianRoomIdsLoaded,
    refresh: (s, id) => s.refreshClinicianRoomIds(id),
  },
  forms: {
    scope: 'org',
    isLoaded: (s) => s.formsLoaded,
    refresh: (s, id) => s.refreshForms(id),
  },
  files: {
    scope: 'org',
    isLoaded: (s) => s.filesLoaded,
    refresh: (s, id) => s.refreshFiles(id),
  },
  standaloneSubmissions: {
    scope: 'org',
    isLoaded: (s) => s.standaloneSubmissionsLoaded,
    refresh: (s, id) => s.refreshStandaloneSubmissions(id),
  },
  workflows: {
    scope: 'org',
    isLoaded: (s) => s.workflowsLoaded,
    refresh: (s, id) => s.refreshWorkflows(id),
  },
} satisfies Record<string, SliceSpec>;

export type EnsurableSlice = keyof typeof SLICE_SPECS;

/**
 * Fetch-if-empty for clinic-store slices: ensures each named slice has been
 * loaded for the store's current location/org, fetching any that haven't.
 * Replaces the fetch-if-empty effect previously copy-pasted across shells.
 * The store's loaded flags make repeat calls no-ops in a warm tab.
 */
export function useEnsureSlices(slices: EnsurableSlice[]) {
  const locationId = useClinicStore((s) => s.locationId);
  const orgId = useClinicStore((s) => s.orgId);
  const key = slices.join('|');

  useEffect(() => {
    const store = getClinicStore();
    for (const name of key.split('|') as EnsurableSlice[]) {
      const spec: SliceSpec = SLICE_SPECS[name];
      const id = spec.scope === 'location' ? locationId : orgId;
      if (!id || spec.isLoaded(store)) continue;
      void spec.refresh(store, id);
    }
  }, [key, locationId, orgId]);
}
