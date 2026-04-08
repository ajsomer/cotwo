"use client";

import { useState, useCallback } from "react";
import { useLocation } from "@/hooks/useLocation";
import { Badge } from "@/components/ui/badge";
import { PatientContactCard } from "./patient-contact-card";
import { PatientSlideOverProvider } from "./patient-slide-over-context";
import { PatientNameLink } from "./patient-name-link";
import { ActionTypeIcon } from "./action-type-icon";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ActionType } from "@/lib/workflows/types";

interface DateSection {
  label: string;
  appointments: ReadinessAppointment[];
}

const ACTION_STATUS_BADGE: Record<string, { label: string; variant: "gray" | "amber" | "teal" | "blue" | "red" | "green" }> = {
  scheduled: { label: "Scheduled", variant: "gray" },
  firing: { label: "Firing", variant: "amber" },
  sent: { label: "Sent", variant: "amber" },
  opened: { label: "Opened", variant: "amber" },
  completed: { label: "Completed", variant: "teal" },
  captured: { label: "Captured", variant: "teal" },
  verified: { label: "Verified", variant: "teal" },
  skipped: { label: "Skipped", variant: "gray" },
  failed: { label: "Failed", variant: "red" },
  pending: { label: "Pending", variant: "gray" },
};

export function ReadinessShell() {
  const { selectedLocation } = useLocation();
  const appointments = useClinicStore((s) => s.readinessAppointments);
  const loading = !useClinicStore((s) => s.readinessLoaded);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contactPatientId, setContactPatientId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const refetchReadiness = useCallback(() => {
    if (selectedLocation) getClinicStore().refreshReadiness(selectedLocation.id);
  }, [selectedLocation]);

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
      // Resend legacy form assignments
      if (appt.outstanding_forms.length > 0) {
        await Promise.all(
          appt.outstanding_forms.map((f) =>
            fetch("/api/forms/assignments/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assignment_id: f.assignment_id }),
            })
          )
        );
      }
    } catch {
      // silent
    }
    setTimeout(() => {
      setResendingId(null);
      refetchReadiness();
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
      refetchReadiness();
    }, 2000);
  };

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
            Outstanding workflow actions for upcoming appointments at {selectedLocation.name}
          </p>
        </div>

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
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {section.label}
                </h2>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {section.appointments.map((appt, idx) => {
                    const isExpanded = expandedIds.has(appt.appointment_id);
                    const isLast = idx === section.appointments.length - 1;
                    const hasWorkflowActions = appt.actions.length > 0;
                    const hasLegacyForms = appt.outstanding_forms.length > 0;

                    return (
                      <div key={appt.appointment_id}>
                        {/* Collapsed row */}
                        <div
                          className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50/50 transition-colors ${
                            !isLast && !isExpanded ? "border-b border-gray-100" : ""
                          }`}
                          onClick={() => toggleExpanded(appt.appointment_id)}
                        >
                          <div className="min-w-0 flex-1">
                            <PatientNameLink patientId={appt.patient_id} className="text-sm">
                              {appt.patient_first_name} {appt.patient_last_name}
                            </PatientNameLink>
                          </div>

                          <span className="text-sm text-gray-500 whitespace-nowrap font-mono">
                            {formatTime(appt.scheduled_at)}
                          </span>

                          {appt.clinician_name && (
                            <span className="hidden sm:block text-sm text-gray-400 truncate max-w-[120px]">
                              {appt.clinician_name}
                            </span>
                          )}

                          {/* Status summary */}
                          {hasWorkflowActions ? (
                            <Badge variant="amber">
                              {appt.completed_actions} of {appt.total_actions} complete
                            </Badge>
                          ) : (
                            <Badge variant="amber">
                              {appt.outstanding_forms.length} form{appt.outstanding_forms.length !== 1 ? "s" : ""}
                            </Badge>
                          )}

                          <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {hasLegacyForms && (
                              <button
                                type="button"
                                onClick={() => handleResendAll(appt)}
                                className="rounded px-2 py-1 text-xs text-teal-600 hover:bg-teal-50 whitespace-nowrap"
                              >
                                {resendingId === appt.appointment_id
                                  ? "Sent!"
                                  : "Resend SMS"}
                              </button>
                            )}
                            {appt.primary_phone && (
                              <a
                                href={`tel:${appt.primary_phone}`}
                                className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                              >
                                Call
                              </a>
                            )}
                          </div>

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

                        {/* Expanded: action timeline or legacy forms */}
                        {isExpanded && (
                          <div
                            className={`bg-gray-50/50 px-4 py-3 space-y-2 ${
                              !isLast ? "border-b border-gray-100" : ""
                            }`}
                          >
                            {/* Workflow actions */}
                            {hasWorkflowActions &&
                              appt.actions
                                .sort((a, b) => b.offset_minutes - a.offset_minutes)
                                .map((action) => {
                                  const badge = ACTION_STATUS_BADGE[action.status] ?? { label: action.status, variant: "gray" as const };
                                  return (
                                    <div
                                      key={action.action_id}
                                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-gray-100"
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400">
                                          <ActionTypeIcon actionType={action.action_type as ActionType} size={14} />
                                        </span>
                                        <div>
                                          <span className="text-sm text-gray-800">
                                            {action.action_label}
                                          </span>
                                          {action.fired_at && (
                                            <span className="ml-2 text-xs text-gray-400">
                                              Fired {relativeTime(action.fired_at)}
                                            </span>
                                          )}
                                          {action.error_message && (
                                            <span className="ml-2 text-xs text-red-500">
                                              {action.error_message}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <Badge variant={badge.variant}>
                                        {badge.label}
                                      </Badge>
                                    </div>
                                  );
                                })}

                            {/* Legacy form assignments */}
                            {!hasWorkflowActions &&
                              appt.outstanding_forms.map((form) => (
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

  if (groups.has("__past__")) {
    sections.push({
      label: "Past \u2014 clinical record incomplete",
      appointments: groups.get("__past__")!,
    });
    groups.delete("__past__");
  }

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
