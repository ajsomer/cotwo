"use client";

import { useOrg } from "@/hooks/useOrg";
import { useRole } from "@/hooks/useRole";
import { SidebarNavItem } from "./sidebar-nav-item";
import { SidebarUserSection } from "./sidebar-user-section";
import { DevRoleSwitcher } from "./dev-role-switcher";
import type { UserRole, OrgTier } from "@/lib/supabase/types";

interface NavItemDef {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
  tiers: OrgTier[];
}

// 20x20 viewBox, 1.5px stroke, currentColor, rounded caps/joins
const icons = {
  runsheet: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  ),
  readiness: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10l2.5 2.5L14 7" />
      <circle cx="10" cy="10" r="7" />
    </svg>
  ),
  workflows: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="2" />
      <circle cx="15" cy="10" r="2" />
      <circle cx="5" cy="15" r="2" />
      <path d="M7 5h4.5a2 2 0 012 2v1M7 15h4.5a2 2 0 002-2v-1" />
    </svg>
  ),
  forms: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h8a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path d="M7 7h6M7 10h6M7 13h3" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 3v1.5M10 15.5V17M17 10h-1.5M4.5 10H3M14.95 5.05l-1.06 1.06M6.11 13.89l-1.06 1.06M14.95 14.95l-1.06-1.06M6.11 6.11L5.05 5.05" />
    </svg>
  ),
};

const NAV_ITEMS: NavItemDef[] = [
  {
    href: "/runsheet",
    label: "Run Sheet",
    icon: icons.runsheet,
    roles: ["clinic_owner", "practice_manager", "receptionist", "clinician"],
    tiers: ["core", "complete"],
  },
  {
    href: "/readiness",
    label: "Readiness",
    icon: icons.readiness,
    roles: ["clinic_owner", "practice_manager", "receptionist"],
    tiers: ["complete"],
  },
  {
    href: "/workflows",
    label: "Workflows",
    icon: icons.workflows,
    roles: ["clinic_owner", "practice_manager"],
    tiers: ["complete"],
  },
  {
    href: "/forms",
    label: "Forms & Files",
    icon: icons.forms,
    roles: ["clinic_owner", "practice_manager"],
    tiers: ["complete"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: icons.settings,
    roles: ["clinic_owner", "practice_manager"],
    tiers: ["core", "complete"],
  },
];

interface SidebarProps {
  onDevSwitch: (role: UserRole, userId: string) => void;
}

export function Sidebar({ onDevSwitch }: SidebarProps) {
  const { org } = useOrg();
  const { role } = useRole();

  const tier = org?.tier ?? "core";

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      role &&
      item.roles.includes(role) &&
      item.tiers.includes(tier)
  );

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-200 bg-white">
      {/* Coviu wordmark */}
      <div className="px-4 pt-5 mb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/images.png"
          alt="Coviu"
          className="h-5 w-auto"
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {visibleItems.map((item) => (
          <SidebarNavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </nav>

      {/* Dev role switcher */}
      <DevRoleSwitcher onSwitch={onDevSwitch} />

      {/* User section */}
      <SidebarUserSection />
    </aside>
  );
}
