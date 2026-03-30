"use client";

import { createContext, useContext } from "react";
import type { Location } from "@/lib/supabase/types";

export interface LocationContextValue {
  selectedLocation: Location | null;
  locations: Location[];
  setSelectedLocationId: (id: string) => void;
}

export const LocationContext = createContext<LocationContextValue>({
  selectedLocation: null,
  locations: [],
  setSelectedLocationId: () => {},
});

export function useLocation() {
  return useContext(LocationContext);
}
