"use client";

import { useState } from "react";
import { postJson } from "@/lib/api-client";
import { SlideOver } from "@/components/ui/slide-over";
import { useClinicStore } from "@/stores/clinic-store";
import { Button } from "@/components/ui/button";
import { TextInput, Select } from "@/components/ui/input";

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
  // Hide legacy collection_only types from creation. The DB enum still
  // permits the value, but new appointments must be run-sheet only.
  const appointmentTypes = useClinicStore((s) => s.appointmentTypes).filter(
    (t) => t.terminal_type !== "collection_only"
  );

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

  const validate = (): string | null => {
    if (!firstName.trim()) return "First name is required";
    if (!lastName.trim()) return "Last name is required";
    if (!dob) return "Date of birth is required";
    if (new Date(dob) >= new Date(today)) return "Date of birth must be in the past";
    if (!mobile.trim()) return "Mobile number is required";
    if (mobile.replace(/\D/g, "").length < 10)
      return "Mobile number must be at least 10 digits";
    if (!appointmentTypeId) return "Workflow type is required";
    if (!roomId) return "Room is required";
    if (!date) return "Appointment date is required";
    if (date < today) return "Appointment date cannot be in the past";
    if (!time) return "Appointment time is required";

    const scheduled = new Date(`${date}T${time}`);
    if (scheduled <= new Date()) return "Appointment must be in the future";

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

    const body: Record<string, unknown> = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      dob,
      mobile: mobile.trim(),
      appointment_type_id: appointmentTypeId,
      org_id: orgId,
      location_id: locationId,
      confirm_existing: confirmExisting,
      scheduled_at: new Date(`${date}T${time}`).toISOString(),
      room_id: roomId,
    };

    const result = await postJson<{
      existing_patient?: boolean;
      patient: { id: string; first_name: string; last_name: string };
    }>("/api/tasks/add-patient", body, "Failed to add patient");
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.data.existing_patient && !confirmExisting) {
      setExistingPatient(result.data.patient);
      return;
    }

    onSaved();
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
            <TextInput
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>

          {/* Last name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Last name *
            </label>
            <TextInput
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>

          {/* Date of birth */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Date of birth *
            </label>
            <TextInput
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={today}
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
            <Select
              value={appointmentTypeId}
              onChange={(e) => setAppointmentTypeId(e.target.value)}
            >
              <option value="">Select type...</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Room */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Room *
            </label>
            <Select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <option value="">Select room...</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
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

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => handleSave(false)} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </SlideOver>
  );
}
