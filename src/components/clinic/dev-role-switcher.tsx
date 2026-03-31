"use client";

import { useRole } from "@/hooks/useRole";
import type { UserRole } from "@/lib/supabase/types";

interface DevRoleSwitcherProps {
  onSwitch: (role: UserRole, userId: string) => void;
}

const DEV_USERS: Array<{ label: string; role: UserRole; userId: string }> = [
  {
    label: "Owner",
    role: "clinic_owner",
    userId: "00000000-0000-0000-0000-000000001001",
  },
  {
    label: "Receptionist",
    role: "receptionist",
    userId: "00000000-0000-0000-0000-000000001001",
  },
  {
    label: "Clinician",
    role: "clinician",
    userId: "00000000-0000-0000-0000-000000001002",
  },
  {
    label: "PM",
    role: "practice_manager",
    userId: "00000000-0000-0000-0000-000000001001",
  },
];

export function DevRoleSwitcher({ onSwitch }: DevRoleSwitcherProps) {
  const { role } = useRole();

  if (process.env.NODE_ENV !== "development") return null;

  return (
    <div className="mx-3 mb-2 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1.5 text-center">
        Dev Switcher
      </div>
      <div className="flex gap-1">
        {DEV_USERS.map((u) => (
          <button
            key={u.role}
            onClick={() => onSwitch(u.role, u.userId)}
            className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors ${
              role === u.role
                ? "bg-amber-500 text-white"
                : "bg-white text-amber-700 hover:bg-amber-100"
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>
    </div>
  );
}
