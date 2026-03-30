"use client";

import { useState, useEffect, useCallback } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import type { RoomType } from "@/lib/supabase/types";
import type { RoomWithClinicians } from "./rooms-settings-shell";

interface Clinician {
  staff_assignment_id: string;
  user_id: string;
  full_name: string;
}

interface RoomFormPanelProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  room: RoomWithClinicians | null;
  locationId: string;
}

const ROOM_TYPES: Array<{ value: RoomType; label: string }> = [
  { value: "clinical", label: "Clinical" },
  { value: "reception", label: "Reception" },
  { value: "shared", label: "Shared" },
  { value: "triage", label: "Triage" },
];

export function RoomFormPanel({
  open,
  onClose,
  onSaved,
  room,
  locationId,
}: RoomFormPanelProps) {
  const isEditing = !!room;

  const [name, setName] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("clinical");
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<string[]>(
    []
  );
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset form when panel opens/room changes
  useEffect(() => {
    if (open) {
      setName(room?.name ?? "");
      setRoomType(room?.room_type ?? "clinical");
      setSelectedAssignmentIds(
        room?.clinicians.map((c) => c.staff_assignment_id) ?? []
      );
      setError(null);
      setCopied(false);
    }
  }, [open, room]);

  // Fetch clinicians for the location
  const fetchClinicians = useCallback(async () => {
    const res = await fetch(
      `/api/settings/rooms?location_id=${locationId}&type=clinicians`
    );
    if (res.ok) {
      const data = await res.json();
      setClinicians(data.clinicians);
    }
  }, [locationId]);

  useEffect(() => {
    if (open) {
      fetchClinicians();
    }
  }, [open, fetchClinicians]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Room name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        ...(isEditing ? { id: room.id } : { location_id: locationId }),
        name: name.trim(),
        room_type: roomType,
        clinician_assignment_ids: selectedAssignmentIds,
      };

      const res = await fetch("/api/settings/rooms", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save room.");
        return;
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const toggleClinician = (assignmentId: string) => {
    setSelectedAssignmentIds((prev) =>
      prev.includes(assignmentId)
        ? prev.filter((id) => id !== assignmentId)
        : [...prev, assignmentId]
    );
  };

  const onDemandUrl = room
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/entry/${room.link_token}`
    : null;

  const handleCopy = async () => {
    if (!onDemandUrl) return;
    await navigator.clipboard.writeText(onDemandUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Room" : "Add Room"}
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        <div className="flex-1 p-5 space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Room name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Room name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dr Smith's Room"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Room type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Room type
            </label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value as RoomType)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
            >
              {ROOM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Clinician assignments */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Assigned clinicians
            </label>
            {clinicians.length === 0 ? (
              <p className="text-sm text-gray-400">
                No clinicians at this location.
              </p>
            ) : (
              <div className="space-y-2">
                {clinicians.map((c) => (
                  <label
                    key={c.staff_assignment_id}
                    className="flex items-center gap-2.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAssignmentIds.includes(
                        c.staff_assignment_id
                      )}
                      onChange={() => toggleClinician(c.staff_assignment_id)}
                      className="h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                    />
                    <span className="text-sm text-gray-800">
                      {c.full_name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* On-demand link (edit mode only) */}
          {isEditing && onDemandUrl && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                On-demand link
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={onDemandUrl}
                  readOnly
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleCopy}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-4 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : isEditing ? "Save changes" : "Create room"}
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}
