"use client";

import { useState, useMemo } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/hooks/useOrg";
import { createSessions, deleteSession } from "@/lib/runsheet/mutations";
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

  const todayShort = today.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
  const tomorrowShort = tomorrow.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });

  // Initialize room states
  const [roomStates, setRoomStates] = useState<Record<string, RoomState>>(() => {
    const initial: Record<string, RoomState> = {};

    if (editingSessionId) {
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

  const totalPatients = useMemo(() => {
    return Object.values(roomStates).reduce(
      (acc, rs) => acc + (rs.active ? rs.patients.filter((p) => p.phone.length > 3 && p.time).length : 0),
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
        if (!patient.phone || patient.phone.length <= 3 || !patient.time) continue;

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

  const panelTitle = editingSessionId ? "Edit sessions" : "Add sessions";
  const dayLabel = planningTomorrow ? "tomorrow's" : "today's";

  const header = (
    <div className="border-b border-gray-200">
      <div className="bg-[#F8F8F6] mx-5 mt-4 rounded-xl overflow-hidden">
        {/* Title + close + description */}
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800">{panelTitle}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Select rooms and add patients to build {dayLabel} schedule.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-gray-800 transition-colors rounded flex-shrink-0 -mr-1 -mt-0.5"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Full-width day tabs */}
        <div className="flex">
          <button
            onClick={() => setPlanningTomorrow(false)}
            className={`flex-1 py-2 text-sm font-semibold text-center transition-colors ${
              !planningTomorrow
                ? "bg-teal-500 text-white"
                : "bg-[#F0EFEC] text-gray-500 hover:bg-[#E8E7E4]"
            }`}
          >
            Today &middot; {todayShort}
          </button>
          <button
            onClick={() => setPlanningTomorrow(true)}
            className={`flex-1 py-2 text-sm font-semibold text-center transition-colors ${
              planningTomorrow
                ? "bg-teal-500 text-white"
                : "bg-[#F0EFEC] text-gray-500 hover:bg-[#E8E7E4]"
            }`}
          >
            Tomorrow &middot; {tomorrowShort}
          </button>
        </div>
      </div>
      {/* Spacer below container before room cards */}
      <div className="h-4" />
    </div>
  );

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={panelTitle}
      width="w-[420px]"
      customHeader={header}
    >
      <div className="flex flex-col h-full">

        {/* Room cards */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {rooms.map((room) => {
            const state = roomStates[room.id];
            const isActive = state?.active ?? false;
            const patientCount = isActive ? (state?.patients.length ?? 0) : 0;

            return (
              <div
                key={room.id}
                className={`rounded-xl border border-gray-200 overflow-hidden transition-opacity ${
                  isActive ? "" : "opacity-60"
                }`}
              >
                {/* Room card header */}
                <button
                  onClick={() => toggleRoom(room.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  {/* Checkbox */}
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 transition-colors ${
                      isActive
                        ? "bg-teal-500 border-teal-500"
                        : "border-gray-300"
                    }`}
                  >
                    {isActive && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>

                  {/* Room name */}
                  <span className="flex-1 min-w-0 text-sm font-semibold text-gray-800 truncate">
                    {room.name}
                  </span>

                  {/* Patient count badge */}
                  {isActive && patientCount > 0 && (
                    <span className="text-xs text-teal-500 bg-teal-500/10 rounded-full px-2 py-0.5 flex-shrink-0 font-medium">
                      {patientCount} {patientCount === 1 ? "patient" : "patients"}
                    </span>
                  )}
                </button>

                {/* Expanded: patient entry rows */}
                {isActive && (
                  <div className="border-t border-gray-200">
                    {/* Patient rows */}
                    <div>
                      {state.patients.map((patient, i) => (
                        <div
                          key={patient.id}
                          className={`flex items-center gap-2 px-4 py-2 ${
                            i < state.patients.length - 1 ? "border-b border-gray-100" : ""
                          }`}
                        >
                          {/* Phone input with +61 prefix */}
                          <div className="flex-1 flex">
                            <span className="inline-flex items-center px-2 text-xs text-gray-500 bg-gray-50 border border-r-0 border-gray-200 rounded-l-lg">
                              +61
                            </span>
                            <input
                              type="tel"
                              value={patient.phone.replace(/^\+61\s?/, "")}
                              onChange={(e) =>
                                updatePatientRow(
                                  room.id,
                                  patient.id,
                                  "phone",
                                  "+61" + e.target.value.replace(/^\+61\s?/, "")
                                )
                              }
                              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-r-lg px-2.5 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            />
                          </div>

                          {/* Time input */}
                          <input
                            type="text"
                            value={patient.time}
                            onChange={(e) =>
                              updatePatientRow(
                                room.id,
                                patient.id,
                                "time",
                                e.target.value
                              )
                            }
                            placeholder="9:00 am"
                            className="w-[100px] text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                          />

                          {/* Delete button */}
                          <button
                            onClick={() =>
                              editingSessionId &&
                              sessions.find((s) => s.session_id === patient.id)
                                ? handleDeleteSession(patient.id, room.id)
                                : removePatientRow(room.id, patient.id)
                            }
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                            title="Remove"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* + Add patient — dashed slot */}
                    <div className="px-4 py-2">
                      <button
                        onClick={() => addPatientRow(room.id)}
                        className="w-full py-1.5 border border-dashed border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 font-medium transition-colors"
                      >
                        + Add patient
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Save button — fixed at bottom */}
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
