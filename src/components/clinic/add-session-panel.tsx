"use client";

import { useState, useMemo } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/hooks/useOrg";
import { createSessions, deleteSession } from "@/lib/runsheet/mutations";
import { formatSessionTime } from "@/lib/runsheet/format";
import type { Room, EnrichedSession } from "@/lib/supabase/types";

interface AddSessionPanelProps {
  locationId: string;
  rooms: Room[];
  editingSessionId: string | null;
  sessions: EnrichedSession[];
  onClose: () => void;
  timezone: string;
}

interface PatientRow {
  id: string;
  phone: string;
  time: string;
}

interface RoomState {
  active: boolean;
  patients: PatientRow[];
}

export function AddSessionPanel({
  locationId,
  rooms,
  editingSessionId,
  sessions,
  onClose,
  timezone,
}: AddSessionPanelProps) {
  const { org } = useOrg();
  const [planningTomorrow, setPlanningTomorrow] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = planningTomorrow ? tomorrow : today;

  const dateLabel = targetDate.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  });

  // Initialize room states
  const [roomStates, setRoomStates] = useState<Record<string, RoomState>>(() => {
    const initial: Record<string, RoomState> = {};

    if (editingSessionId) {
      // Edit mode: pre-populate from existing sessions
      for (const room of rooms) {
        const roomSessions = sessions.filter(
          (s) => s.room_id === room.id && s.derived_state !== "done"
        );
        initial[room.id] = {
          active: roomSessions.length > 0,
          patients: roomSessions.map((s) => ({
            id: s.session_id,
            phone: s.phone_number ?? "",
            time: s.scheduled_at
              ? new Date(s.scheduled_at).toLocaleTimeString("en-AU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: timezone,
                })
              : "",
          })),
        };
      }
    } else {
      for (const room of rooms) {
        initial[room.id] = {
          active: false,
          patients: [],
        };
      }
    }

    return initial;
  });

  // Count total patients across all active rooms
  const totalPatients = useMemo(() => {
    return Object.values(roomStates).reduce(
      (acc, rs) => acc + (rs.active ? rs.patients.filter((p) => p.phone && p.time).length : 0),
      0
    );
  }, [roomStates]);

  function toggleRoom(roomId: string) {
    setRoomStates((prev) => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        active: !prev[roomId].active,
        patients: prev[roomId].active
          ? prev[roomId].patients
          : prev[roomId].patients.length > 0
            ? prev[roomId].patients
            : [{ id: crypto.randomUUID(), phone: "+61", time: "" }],
      },
    }));
  }

  function addPatientRow(roomId: string) {
    setRoomStates((prev) => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        patients: [
          ...prev[roomId].patients,
          { id: crypto.randomUUID(), phone: "+61", time: "" },
        ],
      },
    }));
  }

  function updatePatientRow(
    roomId: string,
    rowId: string,
    field: "phone" | "time",
    value: string
  ) {
    setRoomStates((prev) => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        patients: prev[roomId].patients.map((p) =>
          p.id === rowId ? { ...p, [field]: value } : p
        ),
      },
    }));
  }

  function removePatientRow(roomId: string, rowId: string) {
    setRoomStates((prev) => ({
      ...prev,
      [roomId]: {
        ...prev[roomId],
        patients: prev[roomId].patients.filter((p) => p.id !== rowId),
      },
    }));
  }

  async function handleSave() {
    setSaving(true);

    const inputs: Array<{
      phone_number: string;
      scheduled_at: string;
      room_id: string;
    }> = [];

    for (const [roomId, state] of Object.entries(roomStates)) {
      if (!state.active) continue;
      for (const patient of state.patients) {
        if (!patient.phone || !patient.time) continue;

        // Build scheduled_at from date + time
        const [hours, minutes] = patient.time.split(":").map(Number);
        const scheduledDate = new Date(targetDate);
        scheduledDate.setHours(hours, minutes, 0, 0);

        inputs.push({
          phone_number: patient.phone,
          scheduled_at: scheduledDate.toISOString(),
          room_id: roomId,
        });
      }
    }

    if (inputs.length > 0 && org) {
      await createSessions(locationId, org.id, inputs);
    }

    setSaving(false);
    onClose();
  }

  async function handleDeleteSession(sessionId: string, roomId: string) {
    if (!confirm("Delete this session? If the patient has been notified, a cancellation SMS will be sent.")) {
      return;
    }
    await deleteSession(sessionId);
    removePatientRow(roomId, sessionId);
  }

  // Get clinician name for a room from existing sessions
  function getRoomClinicianName(roomId: string): string | null {
    return sessions.find((s) => s.room_id === roomId)?.clinician_name ?? null;
  }

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={editingSessionId ? "Edit sessions" : "Add sessions"}
      width="w-[420px]"
    >
      <div className="flex flex-col h-full">
        {/* Date header + Plan tomorrow toggle */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-800">{dateLabel}</span>
          {planningTomorrow ? (
            <button
              onClick={() => setPlanningTomorrow(false)}
              className="text-xs text-teal-500 hover:text-teal-600"
            >
              Back to today
            </button>
          ) : (
            <button
              onClick={() => setPlanningTomorrow(true)}
              className="text-xs text-teal-500 hover:text-teal-600"
            >
              Plan tomorrow
            </button>
          )}
        </div>

        {/* Room list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {rooms.map((room) => {
            const state = roomStates[room.id];
            const clinicianName = getRoomClinicianName(room.id);

            return (
              <div key={room.id} className="space-y-2">
                {/* Room checkbox */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={state?.active ?? false}
                    onChange={() => toggleRoom(room.id)}
                    className="h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-500"
                  />
                  <span className="text-sm font-medium text-gray-800">
                    {room.name}
                  </span>
                  {clinicianName && (
                    <span className="text-xs text-gray-500">
                      {clinicianName}
                    </span>
                  )}
                </label>

                {/* Patient rows */}
                {state?.active && (
                  <div className="ml-6 space-y-2">
                    {state.patients.map((patient) => (
                      <div
                        key={patient.id}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="tel"
                          value={patient.phone}
                          onChange={(e) =>
                            updatePatientRow(
                              room.id,
                              patient.id,
                              "phone",
                              e.target.value
                            )
                          }
                          placeholder="+61..."
                          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        />
                        <input
                          type="time"
                          value={patient.time}
                          onChange={(e) =>
                            updatePatientRow(
                              room.id,
                              patient.id,
                              "time",
                              e.target.value
                            )
                          }
                          className="w-28 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono"
                        />
                        <button
                          onClick={() =>
                            editingSessionId &&
                            sessions.find((s) => s.session_id === patient.id)
                              ? handleDeleteSession(patient.id, room.id)
                              : removePatientRow(room.id, patient.id)
                          }
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addPatientRow(room.id)}
                      className="text-xs text-teal-500 hover:text-teal-600 font-medium"
                    >
                      + Add patient
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Save button */}
        <div className="px-5 py-4 border-t border-gray-200">
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={totalPatients === 0 || saving}
          >
            {saving
              ? "Saving..."
              : `Save sessions (${totalPatients})`}
          </Button>
        </div>
      </div>
    </SlideOver>
  );
}
