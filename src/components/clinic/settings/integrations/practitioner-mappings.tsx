"use client";

import { useState } from "react";
import type { MappingDataDTO } from "./types";

interface Props {
  locationId: string;
  data: MappingDataDTO;
  onSaved: () => void;
}

/** Map each PMS practitioner → a Coviu clinician (staff_assignment-scoped). */
export function PractitionerMappings({ locationId, data, onSaved }: Props) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-800">Practitioners</h3>
      <p className="text-xs text-gray-500 mt-1">
        Link each Cliniko practitioner to a clinician at this location.
      </p>
      <div className="mt-3 space-y-2">
        {data.practitioners.map((p) => (
          <PractitionerRow
            key={p.externalId}
            locationId={locationId}
            practitioner={p}
            clinicians={data.clinicians}
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
  clinicians,
  onSaved,
}: {
  locationId: string;
  practitioner: MappingDataDTO["practitioners"][number];
  clinicians: MappingDataDTO["clinicians"];
  onSaved: () => void;
}) {
  const [value, setValue] = useState(practitioner.staffAssignmentId ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (staffAssignmentId: string) => {
    setSaving(true);
    setValue(staffAssignmentId);
    await fetch("/api/pms/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        kind: "practitioner",
        externalId: practitioner.externalId,
        staffAssignmentId: staffAssignmentId || null,
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
        <option value="">— Not mapped —</option>
        {clinicians.map((c) => (
          <option key={c.staffAssignmentId} value={c.staffAssignmentId}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
