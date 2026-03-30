"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "@/hooks/useLocation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RoomFormPanel } from "./room-form-panel";
import type { RoomType } from "@/lib/supabase/types";

interface RoomClinician {
  staff_assignment_id: string;
  full_name: string;
}

export interface RoomWithClinicians {
  id: string;
  location_id: string;
  name: string;
  room_type: RoomType;
  link_token: string;
  sort_order: number;
  clinicians: RoomClinician[];
}

const ROOM_TYPE_BADGE: Record<
  RoomType,
  { label: string; variant: "teal" | "blue" | "amber" | "gray" }
> = {
  clinical: { label: "Clinical", variant: "teal" },
  reception: { label: "Reception", variant: "blue" },
  shared: { label: "Shared", variant: "amber" },
  triage: { label: "Triage", variant: "gray" },
};

export function RoomsSettingsShell() {
  const { selectedLocation } = useLocation();
  const [rooms, setRooms] = useState<RoomWithClinicians[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomWithClinicians | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    if (!selectedLocation) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/rooms?location_id=${selectedLocation.id}`
      );
      const data = await res.json();
      if (res.ok) {
        setRooms(data.rooms);
      } else {
        setError(data.error);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedLocation]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const handleDelete = async (roomId: string, roomName: string) => {
    if (!confirm(`Delete "${roomName}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/settings/rooms?id=${roomId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Failed to delete room");
      return;
    }

    fetchRooms();
  };

  const handleEdit = (room: RoomWithClinicians) => {
    setEditingRoom(room);
    setPanelOpen(true);
  };

  const handleAdd = () => {
    setEditingRoom(null);
    setPanelOpen(true);
  };

  const handlePanelClose = () => {
    setPanelOpen(false);
    setEditingRoom(null);
  };

  const handleSaved = () => {
    handlePanelClose();
    fetchRooms();
  };

  if (!selectedLocation) {
    return (
      <div className="p-6 text-sm text-gray-500">No location selected.</div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Rooms</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage rooms for {selectedLocation.name}
          </p>
        </div>
        <Button onClick={handleAdd}>+ Add room</Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-xl border border-gray-200 bg-white animate-pulse"
            />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No rooms configured for this location. Create your first room to get
            started.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Room Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 w-28">
                  Type
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Clinicians
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 w-32">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const typeConfig = ROOM_TYPE_BADGE[room.room_type] ?? {
                  label: room.room_type,
                  variant: "gray" as const,
                };
                const hasClinicians = room.clinicians.length > 0;
                const isClinicianExpected = room.room_type === "clinical";

                return (
                  <tr
                    key={room.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {room.name}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={typeConfig.variant}>
                        {typeConfig.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {hasClinicians ? (
                        <span className="text-gray-600">
                          {room.clinicians
                            .map((c) => c.full_name)
                            .join(", ")}
                        </span>
                      ) : (
                        <span
                          className={
                            isClinicianExpected
                              ? "text-amber-500 font-medium"
                              : "text-gray-400"
                          }
                        >
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(room)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDelete(room.id, room.name)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RoomFormPanel
        open={panelOpen}
        onClose={handlePanelClose}
        onSaved={handleSaved}
        room={editingRoom}
        locationId={selectedLocation.id}
      />
    </div>
  );
}
