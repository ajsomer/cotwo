"use client";

import { createContext, useContext } from "react";
import type { Organisation } from "@/lib/supabase/types";

export interface OrgContextValue {
  org: Organisation | null;
}

export const OrgContext = createContext<OrgContextValue>({
  org: null,
});

export function useOrg() {
  return useContext(OrgContext);
}
