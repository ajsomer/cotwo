"use client";

import { createContext, useContext } from "react";
import type { UserRole } from "@/lib/supabase/types";

export interface RoleContextValue {
  role: UserRole | null;
  userId: string | null;
}

export const RoleContext = createContext<RoleContextValue>({
  role: null,
  userId: null,
});

export function useRole() {
  return useContext(RoleContext);
}
