"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/hooks/useRole";

const ROLE_LABELS: Record<string, string> = {
  clinic_owner: "Clinic Owner",
  practice_manager: "Practice Manager",
  receptionist: "Receptionist",
  clinician: "Clinician",
};

export function SidebarUserSection() {
  const { role, fullName } = useRole();
  const router = useRouter();

  const userName = fullName ?? "Staff";
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : "";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-800 truncate">{userName}</div>
        <div className="text-xs text-gray-500">{roleLabel}</div>
      </div>
      <button
        onClick={handleSignOut}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
      >
        Sign out
      </button>
    </div>
  );
}
