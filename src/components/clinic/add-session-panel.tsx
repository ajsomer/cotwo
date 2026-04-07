"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/hooks/useOrg";
import { createSessions, updateSession, deleteSession } from "@/lib/runsheet/mutations";
import type { Room, EnrichedSession } from "@/lib/supabase/types";

interface AddSessionPanelProps {
  locationId: string;
  rooms: Room[];
  editingSessionId: string | null;
  sessions: EnrichedSession[];
  onClose: () => void;
  onRefetch?: () => Promise<void>;
  timezone: string;
}

interface AppointmentTypeOption {
  id: string;
  name: string;
}

interface PatientRow {
  id: string;
  phone: string;
  time: string;
  appointment_type_id: string;
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
  onRefetch,
  timezone,
}: AddSessionPanelProps) {
  const { org } = useOrg();
  const [planningTomorrow, setPlanningTomorrow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentTypeOption[]>([]);

  // Fetch appointment types for Complete tier orgs
  useEffect(() => {
    if (!org?.id || org.tier !== "complete") return;
    fetch(`/api/appointment-types?org_id=${org.id}`)
      .then((r) => r.json())
      .then((data) => {
        setAppointmentTypes(
          (data.appointment_types ?? []).map((t: { id: string; name: string }) => ({
            id: t.id,
            name: t.name,
          }))
        );
      })
      .catch(() => {});
  }, [org?.id, org?.tier]);

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

  // Track which rows are existing sessions vs newly added
  const [existingSessionIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.derived_state !== "done") ids.add(s.session_id);
    }
    return ids;
  });

  // Snapshot original values for change detection
  const [originalValues] = useState<Map<string, { phone: string; time: string }>>(() => {
    const map = new Map<string, { phone: string; time: string }>();
    for (const s of sessions) {
      if (s.derived_state === "done") continue;
      map.set(s.session_id, {
        phone: s.phone_number ?? "",
        time: s.scheduled_at
          ? new Date(s.scheduled_at).toLocaleTimeString("en-AU", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: timezone,
            })
          : "",
      });
    }
    return map;
  });

  // Initialize room states — always show existing sessions
  const [roomStates, setRoomStates] = useState<Record<string, RoomState>>(() => {
    const initial: Record<string, RoomState> = {};

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
          appointment_type_id: s.appointment_type_id ?? "",
        })),
      };
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
            : [{ id: crypto.randomUUID(), phone: "+61", time: "", appointment_type_id: "" }],
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
          { id: crypto.randomUUID(), phone: "+61", time: "", appointment_type_id: "" },
        ],
      },
    }));
  }

  function updatePatientRow(
    roomId: string,
    rowId: string,
    field: "phone" | "time" | "appointment_type_id",
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

    const newInputs: Array<{
      phone_number: string;
      scheduled_at: string;
      room_id: string;
      appointment_type_id?: string;
    }> = [];

    const updates: Array<{
      sessionId: string;
      phone_number: string;
      scheduled_at: string;
    }> = [];

    for (const [roomId, state] of Object.entries(roomStates)) {
      if (!state.active) continue;
      for (const patient of state.patients) {
        if (!patient.phone || patient.phone.length <= 3 || !patient.time) continue;

        const [hours, minutes] = patient.time.split(":").map(Number);
        if (isNaN(hours) || isNaN(minutes)) continue;
        const scheduledDate = new Date(targetDate);
        scheduledDate.setHours(hours, minutes, 0, 0);

        if (existingSessionIds.has(patient.id)) {
          // Existing session — only update if changed
          const original = originalValues.get(patient.id);
          if (original && (original.phone !== patient.phone || original.time !== patient.time)) {
            updates.push({
              sessionId: patient.id,
              phone_number: patient.phone,
              scheduled_at: scheduledDate.toISOString(),
            });
          }
        } else {
          // New row
          newInputs.push({
            phone_number: patient.phone,
            scheduled_at: scheduledDate.toISOString(),
            room_id: roomId,
            ...(patient.appointment_type_id
              ? { appointment_type_id: patient.appointment_type_id }
              : {}),
          });
        }
      }
    }

    // Create new sessions
    if (newInputs.length > 0 && org) {
      const result = await createSessions(locationId, org.id, org.name, newInputs);
      if (result.links?.length) {
        console.log(
          `%c[Patient Entry Links]`,
          "color: #2ABFBF; font-weight: bold",
          ...result.links.flatMap((link) => ["\n  →", link])
        );
      }
    }

    // Update changed existing sessions
    for (const u of updates) {
      await updateSession(u.sessionId, {
        phone_number: u.phone_number,
        scheduled_at: u.scheduled_at,
      });
    }

    if (newInputs.length > 0 || updates.length > 0) {
      await onRefetch?.();
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
    await onRefetch?.();
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
                          className={`px-4 py-2 ${
                            i < state.patients.length - 1 ? "border-b border-gray-100" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {/* Phone input with +61 prefix */}
                            <div className="flex min-w-0 flex-shrink">
                              <span className="inline-flex items-center px-2 text-xs text-gray-500 bg-gray-50 border border-r-0 border-gray-200 rounded-l-lg flex-shrink-0">
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
                                className="w-full min-w-0 text-sm border border-gray-200 rounded-r-lg px-2.5 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                              />
                            </div>

                            {/* Time input — hour : minute AM/PM */}
                            <TimeInput
                              value={patient.time}
                              onChange={(val) =>
                                updatePatientRow(room.id, patient.id, "time", val)
                              }
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

                          {/* Appointment type (Complete tier, new patients only) */}
                          {org?.tier === "complete" &&
                            appointmentTypes.length > 0 &&
                            !existingSessionIds.has(patient.id) && (
                              <select
                                value={patient.appointment_type_id}
                                onChange={(e) =>
                                  updatePatientRow(
                                    room.id,
                                    patient.id,
                                    "appointment_type_id",
                                    e.target.value
                                  )
                                }
                                className="mt-1.5 w-full rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              >
                                <option value="">No appointment type</option>
                                {appointmentTypes.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            )}
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

/** Structured time input: hour, minute, AM/PM. Stores value as "HH:MM" in 24-hour format. */
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const minuteRef = useRef<HTMLInputElement>(null);

  // Parse 24h "HH:MM" into 12h parts for initial state
  function parse24h(v: string) {
    if (!v) return { hour: "", minute: "", period: "AM" as "AM" | "PM" };
    const [h, m] = v.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return { hour: "", minute: "", period: "AM" as "AM" | "PM" };
    const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return { hour: String(h12), minute: String(m).padStart(2, "0"), period };
  }

  const initial = parse24h(value);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState(initial.period);

  // Sync local state when value changes externally
  const lastValue = useRef(value);
  useEffect(() => {
    if (value !== lastValue.current) {
      const parsed = parse24h(value);
      setHour(parsed.hour);
      setMinute(parsed.minute);
      setPeriod(parsed.period);
      lastValue.current = value;
    }
  }, [value]);

  function commit(h: string, m: string, p: "AM" | "PM") {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (isNaN(hNum) || isNaN(mNum)) {
      onChange("");
      return;
    }
    let h24 = hNum;
    if (p === "AM" && hNum === 12) h24 = 0;
    else if (p === "PM" && hNum !== 12) h24 = hNum + 12;
    const result = `${String(h24).padStart(2, "0")}:${String(mNum).padStart(2, "0")}`;
    lastValue.current = result;
    onChange(result);
  }

  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={hour}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setHour(v);
          // Auto-advance to minute after 2 digits or a digit >= 2 (can't be 20+)
          if (v.length === 2 || (v.length === 1 && parseInt(v) >= 2)) {
            minuteRef.current?.focus();
            minuteRef.current?.select();
          }
        }}
        onBlur={() => commit(hour, minute || "0", period)}
        placeholder="9"
        className="w-9 text-sm text-center border border-gray-200 rounded-lg py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
      />
      <span className="text-sm text-gray-400 font-medium">:</span>
      <input
        ref={minuteRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={minute}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          setMinute(v);
        }}
        onBlur={() => {
          // Pad single digit on blur (e.g. "3" → "30")
          const padded = minute.length === 1 ? minute + "0" : minute;
          setMinute(padded);
          commit(hour || "12", padded || "0", period);
        }}
        placeholder="00"
        className="w-9 text-sm text-center border border-gray-200 rounded-lg py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
      />
      <select
        value={period}
        onChange={(e) => {
          const p = e.target.value as "AM" | "PM";
          setPeriod(p);
        }}
        onBlur={() => commit(hour || "12", minute || "0", period)}
        className="text-sm font-medium border border-gray-200 rounded-lg px-1.5 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white text-gray-700"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
