"use client";

import { useLocation } from "@/hooks/useLocation";

export function LocationSwitcher() {
  const { selectedLocation, locations, setSelectedLocationId } = useLocation();

  // Single location: plain text, no interactivity
  if (locations.length <= 1) {
    return (
      <div className="text-xs text-gray-500 truncate pl-[42px]">
        {selectedLocation?.name ?? "No location"}
      </div>
    );
  }

  // Multiple locations: dropdown with chevron affordance
  return (
    <div className="relative pl-[42px]">
      <select
        value={selectedLocation?.id ?? ""}
        onChange={(e) => setSelectedLocationId(e.target.value)}
        className="w-full appearance-none bg-transparent pr-5 text-xs text-gray-500 hover:text-gray-700 focus:outline-none cursor-pointer truncate"
      >
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>
            {loc.name}
          </option>
        ))}
      </select>
      {/* Chevron */}
      <svg
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
