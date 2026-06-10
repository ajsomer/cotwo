"use client";

import { useState } from "react";
import type { MappingDataDTO } from "./types";

interface Props {
  locationId: string;
  /** Human label for the connected provider, e.g. "Cliniko" / "Nookal". */
  providerLabel: string;
  data: MappingDataDTO;
  onSaved: () => void;
}

/** Map a PMS business → this Coviu location (one connection ↔ one location). */
export function BusinessMappings({ locationId, providerLabel, data, onSaved }: Props) {
  const current = data.businesses.find((b) => b.locationId === locationId);
  const [value, setValue] = useState(current?.externalId ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (externalId: string) => {
    setSaving(true);
    setValue(externalId);
    await fetch("/api/pms/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        kind: "business",
        externalId: externalId || null,
      }),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-800">Clinic / business</h3>
      <p className="text-xs text-gray-500 mt-1">
        Which {providerLabel} business feeds this location&apos;s run sheet.
      </p>
      <select
        value={value}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className="mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm"
      >
        <option value="">— Not mapped —</option>
        {data.businesses.map((b) => (
          <option key={b.externalId} value={b.externalId}>
            {b.name}
          </option>
        ))}
      </select>
    </section>
  );
}
