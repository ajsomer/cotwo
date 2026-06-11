"use client";

import { useState } from "react";
import { postJson } from "@/lib/api-client";
import type { ReadinessAppointment } from "@/stores/clinic-store";

interface ReadinessActionsProps {
  appointment: ReadinessAppointment;
  onDeleted: () => void;
}

export function ReadinessActions({
  appointment,
  onDeleted,
}: ReadinessActionsProps) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const result = await postJson("/api/tasks/delete-appointment", {
      appointment_id: appointment.appointment_id,
    });
    if (result.ok) {
      onDeleted();
    } else {
      console.error("Failed to delete:", result.error);
    }
    setDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <div className="pt-1">
      {confirmDelete ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Delete appointment?</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg px-2.5 py-1 text-xs font-medium bg-red-500 text-white hover:bg-red-500/90 disabled:opacity-50 transition-colors"
          >
            {deleting ? "..." : "Yes"}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-lg px-2.5 py-1 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Delete appointment
        </button>
      )}
    </div>
  );
}
