"use client";

import { useState } from "react";
import type { MappingDataDTO } from "./types";

interface Props {
  locationId: string;
  data: MappingDataDTO;
  onSaved: () => void;
}

/**
 * Map each PMS practitioner (the appointment-book column) → a Coviu room. A
 * synced appointment lands the patient in its practitioner's room (§025).
 */
export function PractitionerMappings({ locationId, data, onSaved }: Props) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-800">Practitioners → rooms</h3>
      <p className="text-xs text-gray-500 mt-1">
        Send each Cliniko practitioner&apos;s appointments to the right room. A
        synced appointment can only reach the run sheet once its practitioner has
        a room here.
      </p>
      <div className="mt-3 space-y-2">
        {data.practitioners.map((p) => (
          <PractitionerRow
            key={p.externalId}
            locationId={locationId}
            practitioner={p}
            rooms={data.rooms}
            onSaved={onSaved}
          />
        ))}
        {data.practitioners.length === 0 && (
          <p className="text-sm text-gray-500">No practitioners found.</p>
        )}
      </div>
    </section>
  );
}

function PractitionerRow({
  locationId,
  practitioner,
  rooms,
  onSaved,
}: {
  locationId: string;
  practitioner: MappingDataDTO["practitioners"][number];
  rooms: MappingDataDTO["rooms"];
  onSaved: () => void;
}) {
  const [value, setValue] = useState(practitioner.roomId ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (roomId: string) => {
    setSaving(true);
    setValue(roomId);
    await fetch("/api/pms/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        kind: "practitioner",
        externalId: practitioner.externalId,
        roomId: roomId || null,
      }),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="font-medium text-sm text-gray-800">
        {practitioner.displayName}
      </div>
      <select
        value={value}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
      >
        <option value="">— No room —</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}
