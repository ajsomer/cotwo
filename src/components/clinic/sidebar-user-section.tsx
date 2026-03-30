"use client";

import { useRole } from "@/hooks/useRole";

const ROLE_LABELS: Record<string, string> = {
  practice_manager: "Practice Manager",
  receptionist: "Receptionist",
  clinician: "Clinician",
};

// Map seed user IDs to names for the prototype
const USER_NAMES: Record<string, string> = {
  "00000000-0000-0000-0000-000000001001": "Sarah Mitchell",
  "00000000-0000-0000-0000-000000001002": "Dr Smith",
  "00000000-0000-0000-0000-000000001003": "Dr Nguyen",
};

export function SidebarUserSection() {
  const { role, userId } = useRole();

  const userName = userId ? (USER_NAMES[userId] ?? "Staff") : "Staff";
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : "";

  return (
    <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-800 truncate">{userName}</div>
        <div className="text-xs text-gray-500">{roleLabel}</div>
      </div>
      <button
        onClick={() => {
          console.log("Sign out clicked");
        }}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
      >
        Sign out
      </button>
    </div>
  );
}
