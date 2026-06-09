"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { MappingDataDTO } from "./types";

interface Props {
  locationId: string;
  data: MappingDataDTO;
  onSaved: () => void;
}

type Modality = "telehealth" | "in_person";

/**
 * Confirm each PMS appointment type's modality + target room + sync toggle.
 * Only confirmed telehealth + sync_enabled + room types reach the run sheet
 * (plan §5). Surfaces a warning when a type lacks a pre-workflow link.
 */
export function AppointmentTypeMappings({ locationId, data, onSaved }: Props) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-800">Appointment types</h3>
      <p className="text-xs text-gray-500 mt-1">
        Confirm each type. Telehealth types with a room and sync on will appear
        on the run sheet when their appointments arrive.
      </p>
      <div className="mt-3 space-y-2">
        {data.appointmentTypes.map((t) => (
          <TypeRow
            key={t.externalId}
            locationId={locationId}
            type={t}
            rooms={data.rooms}
            onSaved={onSaved}
          />
        ))}
        {data.appointmentTypes.length === 0 && (
          <p className="text-sm text-gray-500">No appointment types found.</p>
        )}
      </div>
    </section>
  );
}

function TypeRow({
  locationId,
  type,
  rooms,
  onSaved,
}: {
  locationId: string;
  type: MappingDataDTO["appointmentTypes"][number];
  rooms: MappingDataDTO["rooms"];
  onSaved: () => void;
}) {
  const [modality, setModality] = useState<Modality | "">(
    type.confirmedModality ?? ""
  );
  const [roomId, setRoomId] = useState(type.roomId ?? "");
  const [syncEnabled, setSyncEnabled] = useState(type.syncEnabled);
  const [saving, setSaving] = useState(false);

  const save = async (next: {
    modality?: Modality | "";
    roomId?: string;
    syncEnabled?: boolean;
  }) => {
    const m = next.modality ?? modality;
    const r = next.roomId ?? roomId;
    const s = next.syncEnabled ?? syncEnabled;
    setSaving(true);
    await fetch("/api/pms/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        kind: "appointment_type",
        externalId: type.externalId,
        externalName: type.name,
        durationMinutes: type.durationMinutes,
        confirmedModality: m || null,
        roomId: r || null,
        syncEnabled: s,
      }),
    });
    setSaving(false);
    onSaved();
  };

  const willReachRunSheet =
    modality === "telehealth" && syncEnabled && Boolean(roomId);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-medium text-sm text-gray-800">{type.name}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={modality}
            disabled={saving}
            onChange={(e) => {
              const m = e.target.value as Modality | "";
              setModality(m);
              void save({ modality: m });
            }}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
          >
            <option value="">Unconfirmed</option>
            <option value="telehealth">Telehealth</option>
            <option value="in_person">In-person</option>
          </select>

          <select
            value={roomId}
            disabled={saving || modality !== "telehealth"}
            onChange={(e) => {
              setRoomId(e.target.value);
              void save({ roomId: e.target.value });
            }}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:opacity-40"
          >
            <option value="">— Room —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={syncEnabled}
              disabled={saving}
              onChange={(e) => {
                setSyncEnabled(e.target.checked);
                void save({ syncEnabled: e.target.checked });
              }}
            />
            Sync
          </label>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {willReachRunSheet ? (
          <Badge variant="teal">On run sheet</Badge>
        ) : (
          <Badge variant="gray">Not synced</Badge>
        )}
        {willReachRunSheet && !type.hasWorkflowLink && (
          <span className="text-xs text-amber-600">
            ⚠ No pre-appointment workflow linked — appointments won&apos;t spawn
            sessions until one is attached in Workflows.
          </span>
        )}
      </div>
    </div>
  );
}
