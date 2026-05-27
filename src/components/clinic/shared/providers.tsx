"use client";

import { useState, useMemo, useCallback, type ReactNode } from "react";
import { LocationContext } from "@/hooks/useLocation";
import { OrgContext } from "@/hooks/useOrg";
import { RoleContext } from "@/hooks/useRole";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ClinicDataProvider } from "./clinic-data-provider";
import type { Location, Organisation, UserRole } from "@/lib/supabase/types";

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

  return (
    <LocationContext value={locationValue}>
      <OrgContext value={orgValue}>
        <RoleContext value={roleValue}>
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
        </RoleContext>
      </OrgContext>
    </LocationContext>
  );
}
