"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

interface SidebarNavItemProps {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export function SidebarNavItem({ href, label, icon }: SidebarNavItemProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive =
    pathname === href || (href !== "/runsheet" && pathname.startsWith(href));

  // Intent prefetch: warm the route bundle as soon as the user signals
  // intent (hover or keyboard focus). Next's <Link> auto-prefetches on
  // viewport entry, but on a tall sidebar that fires for every item
  // immediately. Hover/focus is a tighter signal and avoids competing
  // with the current page's critical requests.
  const prefetch = useCallback(() => {
    if (isActive) return;
    router.prefetch(href);
  }, [href, isActive, router]);

  return (
    <Link
      href={href}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? "bg-teal-50 text-teal-700"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {label}
    </Link>
  );
}
