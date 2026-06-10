"use client";

import { useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import { LocationContext } from "@/hooks/useLocation";
import { OrgContext } from "@/hooks/useOrg";
import { RoleContext } from "@/hooks/useRole";
import {
  PmsConnectionContext,
  type PmsConnectionStatus,
} from "@/hooks/usePmsConnection";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ClinicDataProvider } from "./clinic-data-provider";
import type { Location, Organisation, UserRole } from "@/lib/types/domain";

interface StaffAssignmentData {
  location: Location;
  org: Organisation;
  role: UserRole;
  userId: string;
  fullName: string;
}

interface ClinicProvidersProps {
  children: ReactNode;
  assignments: StaffAssignmentData[];
  initialLocationId?: string;
}

export function ClinicProviders({
  children,
  assignments,
  initialLocationId,
}: ClinicProvidersProps) {
  const locations = useMemo(
    () => assignments.map((a) => a.location),
    [assignments]
  );

  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    initialLocationId ?? locations[0]?.id ?? ""
  );

  // Dev switcher overrides
  const [devRole, setDevRole] = useState<UserRole | null>(null);
  const [devUserId, setDevUserId] = useState<string | null>(null);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocationId) ?? null,
    [locations, selectedLocationId]
  );

  const currentAssignment = useMemo(
    () => assignments.find((a) => a.location.id === selectedLocationId) ?? null,
    [assignments, selectedLocationId]
  );

  const locationValue = useMemo(
    () => ({
      selectedLocation,
      locations,
      setSelectedLocationId,
    }),
    [selectedLocation, locations]
  );

  const orgValue = useMemo(
    () => ({ org: currentAssignment?.org ?? null }),
    [currentAssignment]
  );

  const roleValue = useMemo(
    () => ({
      role: devRole ?? currentAssignment?.role ?? null,
      userId: devUserId ?? currentAssignment?.userId ?? null,
      fullName: currentAssignment?.fullName ?? null,
    }),
    [currentAssignment, devRole, devUserId]
  );

  const handleDevSwitch = useCallback((role: UserRole, userId: string) => {
    setDevRole(role);
    setDevUserId(userId);
  }, []);

  // PMS connection status — fetched ONCE per selected location and shared via
  // context, so the Cliniko-dependent UI across the app doesn't each poll
  // /api/pms/connection (which caused it to flicker in after mount).
  const [pms, setPms] = useState<{
    syncActive: boolean;
    providerLabel: string | null;
    accountSubdomain: string | null;
    loaded: boolean;
  }>({ syncActive: false, providerLabel: null, accountSubdomain: null, loaded: false });
  const [pmsRefreshKey, setPmsRefreshKey] = useState(0);
  const refreshPms = useCallback(() => setPmsRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    // All setState lives in the awaited continuation (never synchronously in
    // the effect body) so it doesn't trigger cascading renders.
    (async () => {
      if (!selectedLocationId) {
        if (!cancelled) {
          setPms({ syncActive: false, providerLabel: null, accountSubdomain: null, loaded: true });
        }
        return;
      }
      try {
        const res = await fetch(
          `/api/pms/connection?locationId=${selectedLocationId}`
        );
        const data = res.ok
          ? ((await res.json()) as {
              syncActive?: boolean;
              providerLabel?: string | null;
              accountSubdomain?: string | null;
            })
          : null;
        if (cancelled) return;
        setPms({
          syncActive: Boolean(data?.syncActive),
          providerLabel: data?.providerLabel ?? null,
          accountSubdomain: data?.accountSubdomain ?? null,
          loaded: true,
        });
      } catch {
        if (!cancelled) {
          setPms({ syncActive: false, providerLabel: null, accountSubdomain: null, loaded: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLocationId, pmsRefreshKey]);

  const pmsValue = useMemo<PmsConnectionStatus>(
    () => ({ ...pms, refresh: refreshPms }),
    [pms, refreshPms]
  );

  return (
    <LocationContext value={locationValue}>
      <OrgContext value={orgValue}>
        <RoleContext value={roleValue}>
          <PmsConnectionContext value={pmsValue}>
          <div className="flex h-screen bg-gray-50">
            <Sidebar onDevSwitch={handleDevSwitch} />
            <div className="flex flex-1 flex-col min-w-0">
              <TopBar />
              <main className="flex-1 overflow-y-auto">
                <ClinicDataProvider>
                  {children}
                </ClinicDataProvider>
              </main>
            </div>
          </div>
          </PmsConnectionContext>
        </RoleContext>
      </OrgContext>
    </LocationContext>
  );
}
