"use client";

import { useState, useMemo } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { useClinicStore } from "@/stores/clinic-store";

interface AddPatientPanelProps {
  locationId: string;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AddPatientPanel({
  locationId,
  orgId,
  onClose,
  onSaved,
}: AddPatientPanelProps) {
  const rooms = useClinicStore((s) => s.rooms);
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [mobile, setMobile] = useState("");
  const [appointmentTypeId, setAppointmentTypeId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingPatient, setExistingPatient] = useState<{
    id: string;
    first_name: string;
    last_name: string;
  } | null>(null);

  const today = new Date().toISOString().split("T")[0];

  // Determine if the selected appointment type needs run sheet fields
  const selectedType = useMemo(
    () => appointmentTypes.find((t) => t.id === appointmentTypeId),
    [appointmentTypes, appointmentTypeId]
  );
  const isRunSheet = selectedType?.terminal_type !== "collection_only";
  const needsScheduling = !!appointmentTypeId && isRunSheet;

  const validate = (): string | null => {
    if (!firstName.trim()) return "First name is required";
    if (!lastName.trim()) return "Last name is required";
    if (!dob) return "Date of birth is required";
    if (new Date(dob) >= new Date(today)) return "Date of birth must be in the past";
    if (!mobile.trim()) return "Mobile number is required";
    if (mobile.replace(/\D/g, "").length < 10)
      return "Mobile number must be at least 10 digits";
    if (!appointmentTypeId) return "Workflow type is required";

    // Run sheet types require room, date, and time
    if (needsScheduling) {
      if (!roomId) return "Room is required";
      if (!date) return "Appointment date is required";
      if (date < today) return "Appointment date cannot be in the past";
      if (!time) return "Appointment time is required";

      const scheduled = new Date(`${date}T${time}`);
      if (scheduled <= new Date()) return "Appointment must be in the future";
    }

    return null;
  };

  const handleSave = async (confirmExisting = false) => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        dob,
        mobile: mobile.trim(),
        appointment_type_id: appointmentTypeId,
        org_id: orgId,
        location_id: locationId,
        confirm_existing: confirmExisting,
      };

      // Only include scheduling fields for run sheet types
      if (needsScheduling) {
        body.scheduled_at = new Date(`${date}T${time}`).toISOString();
        body.room_id = roomId;
      }

      const res = await fetch("/api/readiness/add-patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to add patient");
        return;
      }

      if (data.existing_patient && !confirmExisting) {
        setExistingPatient(data.patient);
        return;
      }

      onSaved();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Add patient"
      width="w-[420px]"
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Existing patient banner */}
          {existingPatient && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-800">
                Patient already exists: {existingPatient.first_name}{" "}
                {existingPatient.last_name}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => handleSave(true)}
                  className="rounded bg-teal-500 px-3 py-1 text-xs font-medium text-white hover:bg-teal-600"
                >
                  Use existing
                </button>
                <button
                  onClick={() => setExistingPatient(null)}
                  className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Create new
                </button>
              </div>
            </div>
          )}

          {/* First name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              First name *
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
            />
          </div>

          {/* Last name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Last name *
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
            />
          </div>

          {/* Date of birth */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Date of birth *
            </label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={today}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
            />
          </div>

          {/* Mobile */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Mobile number *
            </label>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
                +61
              </span>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="412 345 678"
                className="w-full rounded-r-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
              />
            </div>
          </div>

          {/* Workflow type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Workflow type *
            </label>
            <select
              value={appointmentTypeId}
              onChange={(e) => {
                setAppointmentTypeId(e.target.value);
                // Reset scheduling fields when switching types
                if (!e.target.value) {
                  setRoomId("");
                  setDate("");
                  setTime("");
                }
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
            >
              <option value="">Select type...</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Run sheet fields — only shown when a run sheet type is selected */}
          {needsScheduling && (
            <>
              {/* Room */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Room *
                </label>
                <select
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                >
                  <option value="">Select room...</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Appointment date *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={today}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>

              {/* Time */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Appointment time *
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
