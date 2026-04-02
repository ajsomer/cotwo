"use client";

import { useOrg } from "@/hooks/useOrg";
import { useLocation } from "@/hooks/useLocation";

export function TopBar() {
  const { org } = useOrg();
  const { selectedLocation, locations, setSelectedLocationId } = useLocation();

  return (
    <div className="h-14 flex items-center justify-between border-b border-gray-200 bg-white px-5 flex-shrink-0">
      {/* Left: org logo + name */}
      <div className="flex items-center gap-2.5">
        {org?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt={org.name}
            className="h-7 w-7 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500 text-white text-xs font-semibold flex-shrink-0">
            {org?.name?.charAt(0) ?? "C"}
          </div>
        )}
        <span className="text-sm font-semibold text-gray-800">
          {org?.name ?? "Organisation"}
        </span>
      </div>

      {/* Right: location switcher (only shown for multi-location orgs) */}
      {locations.length > 1 && (
        <div className="flex items-center">
          <div className="relative">
            <select
              value={selectedLocation?.id ?? ""}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="appearance-none bg-transparent pr-5 text-sm text-gray-500 hover:text-gray-700 focus:outline-none cursor-pointer"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
