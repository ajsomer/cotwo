"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "@/hooks/useLocation";
import { Badge } from "@/components/ui/badge";
import { PatientContactCard } from "./patient-contact-card";
import { PatientSlideOverProvider } from "./patient-slide-over-context";
import { PatientNameLink } from "./patient-name-link";

interface OutstandingForm {
  assignment_id: string;
  form_name: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

interface ReadinessAppointment {
  appointment_id: string;
  scheduled_at: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  clinician_name: string | null;
  primary_phone: string | null;
  outstanding_forms: OutstandingForm[];
}

interface DateSection {
  label: string;
  appointments: ReadinessAppointment[];
}

export function ReadinessShell() {
  const { selectedLocation } = useLocation();
  const [appointments, setAppointments] = useState<ReadinessAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contactPatientId, setContactPatientId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedLocation) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/readiness?location_id=${selectedLocation.id}`);
      const data = await res.json();
      if (res.ok) {
        setAppointments(data.appointments);
      } else {
        setError(data.error);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedLocation]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Optional polling every 30s
  useEffect(() => {
    if (!selectedLocation) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData, selectedLocation]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResendAll = async (appt: ReadinessAppointment) => {
    setResendingId(appt.appointment_id);
    try {
      await Promise.all(
        appt.outstanding_forms.map((f) =>
          fetch("/api/forms/assignments/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignment_id: f.assignment_id }),
          })
        )
      );
    } catch {
      // silent
    }
    setTimeout(() => {
      setResendingId(null);
      fetchData();
    }, 2000);
  };

  const handleResendOne = async (assignmentId: string) => {
    setResendingId(assignmentId);
    try {
      await fetch("/api/forms/assignments/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_id: assignmentId }),
      });
    } catch {
      // silent
    }
    setTimeout(() => {
      setResendingId(null);
      fetchData();
    }, 2000);
  };

  // Group appointments by date
  const sections = groupByDate(appointments);

  if (!selectedLocation) {
    return (
      <div className="p-6 text-sm text-gray-500">No location selected.</div>
    );
  }

  return (
    <PatientSlideOverProvider onOpenPatient={setContactPatientId}>
      <div className="p-6 max-w-[860px] mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-800">Readiness</h1>
          <p className="mt-1 text-sm text-gray-500">
            Outstanding forms for upcoming appointments at {selectedLocation.name}
          </p>
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
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        ) : appointments.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
              <svg
                className="h-6 w-6 text-teal-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-500">
              All upcoming appointments are ready.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.label}>
                {/* Section header */}
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {section.label}
                </h2>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {section.appointments.map((appt, idx) => {
                    const isExpanded = expandedIds.has(appt.appointment_id);
                    const isLast = idx === section.appointments.length - 1;
                    return (
                      <div key={appt.appointment_id}>
                        {/* Collapsed row */}
                        <div
                          className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50/50 transition-colors ${
                            !isLast && !isExpanded ? "border-b border-gray-100" : ""
                          }`}
                          onClick={() => toggleExpanded(appt.appointment_id)}
                        >
                          {/* Patient name */}
                          <div className="min-w-0 flex-1">
                            <PatientNameLink patientId={appt.patient_id} className="text-sm">
                              {appt.patient_first_name} {appt.patient_last_name}
                            </PatientNameLink>
                          </div>

                          {/* Time */}
                          <span className="text-sm text-gray-500 whitespace-nowrap font-mono">
                            {formatTime(appt.scheduled_at)}
                          </span>

                          {/* Clinician */}
                          {appt.clinician_name && (
                            <span className="hidden sm:block text-sm text-gray-400 truncate max-w-[120px]">
                              {appt.clinician_name}
                            </span>
                          )}

                          {/* Outstanding count */}
                          <Badge variant="amber">
                            {appt.outstanding_forms.length} form{appt.outstanding_forms.length !== 1 ? "s" : ""}
                          </Badge>

                          {/* Actions */}
                          <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleResendAll(appt)}
                              className="rounded px-2 py-1 text-xs text-teal-600 hover:bg-teal-50 whitespace-nowrap"
                            >
                              {resendingId === appt.appointment_id
                                ? "Sent!"
                                : "Resend SMS"}
                            </button>
                            {appt.primary_phone && (
                              <a
                                href={`tel:${appt.primary_phone}`}
                                className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                              >
                                Call
                              </a>
                            )}
                          </div>

                          {/* Expand indicator */}
                          <svg
                            className={`h-4 w-4 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                            />
                          </svg>
                        </div>

                        {/* Expanded form details */}
                        {isExpanded && (
                          <div
                            className={`bg-gray-50/50 px-4 py-3 space-y-2 ${
                              !isLast ? "border-b border-gray-100" : ""
                            }`}
                          >
                            {appt.outstanding_forms.map((form) => (
                              <div
                                key={form.assignment_id}
                                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-gray-100"
                              >
                                <div>
                                  <span className="text-sm text-gray-800">
                                    {form.form_name}
                                  </span>
                                  {form.sent_at && (
                                    <span className="ml-2 text-xs text-gray-400">
                                      Sent {relativeTime(form.sent_at)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={
                                      form.status === "opened"
                                        ? "amber"
                                        : form.status === "sent"
                                          ? "amber"
                                          : "gray"
                                    }
                                  >
                                    {form.status === "opened"
                                      ? "Opened"
                                      : form.status === "sent"
                                        ? "Sent"
                                        : "Pending"}
                                  </Badge>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleResendOne(form.assignment_id)
                                    }
                                    className="text-xs text-teal-600 hover:text-teal-700"
                                  >
                                    {resendingId === form.assignment_id
                                      ? "Sent!"
                                      : "Resend"}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <PatientContactCard
          patientId={contactPatientId}
          open={!!contactPatientId}
          onClose={() => setContactPatientId(null)}
        />
      </div>
    </PatientSlideOverProvider>
  );
}

// --- Helpers ---

function groupByDate(appointments: ReadinessAppointment[]): DateSection[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const groups = new Map<string, ReadinessAppointment[]>();

  for (const appt of appointments) {
    const date = new Date(appt.scheduled_at);
    date.setHours(0, 0, 0, 0);

    let key: string;
    if (date < today) {
      key = "__past__";
    } else {
      key = date.toISOString().split("T")[0];
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(appt);
  }

  const sections: DateSection[] = [];

  // Past first
  if (groups.has("__past__")) {
    sections.push({
      label: "Past \u2014 clinical record incomplete",
      appointments: groups.get("__past__")!,
    });
    groups.delete("__past__");
  }

  // Remaining dates in order
  const sortedKeys = [...groups.keys()].sort();
  for (const key of sortedKeys) {
    const date = new Date(key + "T00:00:00");
    let label: string;
    if (date.getTime() === today.getTime()) {
      label = "Today";
    } else if (date.getTime() === tomorrow.getTime()) {
      label = "Tomorrow";
    } else {
      label = date.toLocaleDateString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "long",
      });
    }
    sections.push({ label, appointments: groups.get(key)! });
  }

  return sections;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
