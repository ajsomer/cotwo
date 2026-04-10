"use client";

import { useEffect, useState } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./status-badge";
import { ActionTypeIcon } from "./action-type-icon";
import { formatPhoneNumber } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/supabase/types";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ActionType } from "@/lib/workflows/types";

interface PatientContactCardProps {
  session?: EnrichedSession | null;
  patientId?: string | null;
  open: boolean;
  onClose: () => void;
  // Readiness-specific (optional — omit for run sheet usage)
  appointment?: ReadinessAppointment | null;
  onOpenFormHandoff?: (actionId: string, formName: string) => void;
  onDeleted?: () => void;
}

interface PatientDetails {
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  };
  phone_numbers: { phone_number: string; is_primary: boolean }[];
  payment_methods: {
    card_brand: string;
    card_last_four: string;
    card_expiry: string | null;
    is_default: boolean;
  }[];
  current_session: {
    status: string;
    scheduled_at: string | null;
    type_name: string | null;
    room_name: string | null;
  } | null;
  visit_history: { date: string; type_name: string | null }[];
  form_assignments: {
    id: string;
    form_name: string;
    status: string;
    sent_at: string | null;
    completed_at: string | null;
    created_at: string;
    submission_id: string | null;
  }[];
}

const ACTION_STATUS_BADGE: Record<string, { label: string; variant: string }> = {
  scheduled: { label: "Scheduled", variant: "gray" },
  pending: { label: "Pending", variant: "gray" },
  firing: { label: "Firing", variant: "amber" },
  sent: { label: "Sent", variant: "amber" },
  opened: { label: "Opened", variant: "amber" },
  completed: { label: "Completed", variant: "teal" },
  captured: { label: "Captured", variant: "teal" },
  verified: { label: "Verified", variant: "teal" },
  transcribed: { label: "Transcribed", variant: "teal" },
  skipped: { label: "Skipped", variant: "gray" },
  failed: { label: "Failed", variant: "red" },
};

export function PatientContactCard({
  session,
  patientId: propPatientId,
  open,
  onClose,
  appointment,
  onOpenFormHandoff,
  onDeleted,
}: PatientContactCardProps) {
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolvedPatientId = propPatientId || appointment?.patient_id || session?.patient_id || null;
  const isReadinessMode = !!appointment;

  useEffect(() => {
    if (!open || !resolvedPatientId) {
      setDetails(null);
      return;
    }

    setLoading(true);
    const url = session?.session_id
      ? `/api/patient/${resolvedPatientId}?session_id=${session.session_id}`
      : `/api/patient/${resolvedPatientId}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => setDetails(data))
      .catch((err) => console.error("[ContactCard] fetch failed:", err))
      .finally(() => setLoading(false));
  }, [open, resolvedPatientId, session?.session_id]);

  // Reset delete confirm when panel closes
  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  const handleDelete = async () => {
    if (!appointment) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/readiness/delete-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appointment.appointment_id }),
      });
      if (res.ok) {
        onDeleted?.();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Readiness: completed form actions for the handoff section
  const formActions = appointment?.actions.filter(
    (a) =>
      a.action_type === "deliver_form" &&
      (a.status === "completed" || a.status === "transcribed")
  ) ?? [];

  // Readiness: all actions sorted by offset for the workflow timeline
  const sortedActions = appointment
    ? [...appointment.actions].sort((a, b) => b.offset_minutes - a.offset_minutes)
    : [];

  return (
    <SlideOver open={open} onClose={onClose} title="Patient details">
      {loading || !details ? (
        <div className="p-5 space-y-4">
          {/* Skeleton */}
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 animate-pulse" />
            <div className="h-5 w-32 rounded bg-gray-100 animate-pulse" />
            <div className="h-4 w-40 rounded bg-gray-100 animate-pulse" />
          </div>
          <div className="h-px bg-gray-200" />
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
            <div className="h-10 w-full rounded-lg bg-gray-100 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Header: Avatar + Name + DOB */}
          <div className="flex flex-col items-center gap-2">
            <div className="h-12 w-12 rounded-full bg-teal-50 flex items-center justify-center">
              <span className="text-base font-semibold text-teal-600">
                {details.patient.first_name[0]}
                {details.patient.last_name[0]}
              </span>
            </div>
            <h3 className="text-xl font-semibold text-gray-800">
              {details.patient.first_name} {details.patient.last_name}
            </h3>
            {details.patient.date_of_birth && (
              <p className="text-sm text-gray-500">
                DOB: {formatDob(details.patient.date_of_birth)}
              </p>
            )}

            {/* Quick actions */}
            <div className="flex items-center gap-2 pt-1">
              {details.payment_methods.length > 0 && (
                <QuickActionButton
                  icon={<CreditCardIcon />}
                  label="Take payment"
                  onClick={() => {
                    console.log("[ContactCard] Take payment stub — patient:", details.patient.id, "session:", session?.session_id);
                  }}
                />
              )}
              <QuickActionButton
                icon={<SmsIcon />}
                label="Send SMS"
                onClick={() => {
                  console.log("[ContactCard] Send SMS stub — patient:", details.patient.id, "phone:", details.phone_numbers[0]?.phone_number);
                }}
              />
            </div>

            {/* Delete button (readiness only) */}
            {isReadinessMode && onDeleted && (
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
            )}
          </div>

          <div className="h-px bg-gray-200" />

          {/* Contact */}
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
              Contact
            </h4>
            <div className="space-y-1.5">
              {details.phone_numbers.map((p) => (
                <div
                  key={p.phone_number}
                  className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
                >
                  <PhoneIcon />
                  <span className="text-sm text-gray-800">
                    {formatPhoneNumber(p.phone_number)}
                  </span>
                  {details.phone_numbers.length > 1 && p.is_primary && (
                    <span className="text-[10px] font-medium uppercase text-gray-400 ml-auto">
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <div className="h-px bg-gray-200" />

          {/* Appointment details (readiness only) */}
          {isReadinessMode && appointment && (
            <>
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                  Appointment
                </h4>
                <div className="rounded-lg bg-gray-50 px-3 py-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {appointment.scheduled_at && (
                      <span className="text-sm font-medium text-gray-800">
                        {new Date(appointment.scheduled_at).toLocaleDateString("en-AU", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        at{" "}
                        {formatTime(appointment.scheduled_at)}
                      </span>
                    )}
                  </div>
                  {appointment.appointment_type_name && (
                    <p className="text-xs text-gray-500">{appointment.appointment_type_name}</p>
                  )}
                  {appointment.room_name && (
                    <p className="text-xs text-gray-500">{appointment.room_name}</p>
                  )}
                </div>
              </section>

              <div className="h-px bg-gray-200" />
            </>
          )}

          {/* Workflow timeline (readiness only) */}
          {isReadinessMode && sortedActions.length > 0 && (
            <>
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                  Workflow
                </h4>
                <div className="relative space-y-3 pl-5">
                  {/* Vertical line */}
                  <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />

                  {sortedActions.map((action) => {
                    const badge = ACTION_STATUS_BADGE[action.status] ?? {
                      label: action.status,
                      variant: "gray",
                    };
                    return (
                      <div key={action.action_id} className="relative flex items-start gap-2">
                        <div className="absolute left-[-16px] top-1 w-2 h-2 rounded-full bg-gray-300 border-2 border-white" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <ActionTypeIcon
                              actionType={action.action_type as ActionType}
                              size={14}
                              className="text-gray-400 shrink-0"
                            />
                            <span className="text-xs text-gray-700 truncate">
                              {action.action_label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge
                              variant={badge.variant as "red" | "amber" | "teal" | "gray" | "faded"}
                            >
                              {badge.label}
                            </Badge>
                            {action.fired_at && (
                              <span className="text-[10px] text-gray-400">
                                {new Date(action.fired_at).toLocaleString("en-AU", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </div>
                          {action.error_message && (
                            <p className="text-[10px] text-red-500 mt-0.5">
                              {action.error_message}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="h-px bg-gray-200" />
            </>
          )}

          {/* Completed forms with handoff (readiness only) */}
          {isReadinessMode && formActions.length > 0 && (
            <>
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                  Completed Forms
                </h4>
                <div className="space-y-1.5">
                  {formActions.map((action) => (
                    <div
                      key={action.action_id}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                    >
                      <span className="text-sm text-gray-800 truncate">
                        {action.form_name ?? "Form"}
                      </span>
                      {action.status === "transcribed" ? (
                        <Badge variant="teal">Transcribed</Badge>
                      ) : onOpenFormHandoff ? (
                        <button
                          onClick={() =>
                            onOpenFormHandoff(
                              action.action_id,
                              action.form_name ?? "Form"
                            )
                          }
                          className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/25"
                        >
                          Review
                        </button>
                      ) : (
                        <Badge variant="teal">Completed</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <div className="h-px bg-gray-200" />
            </>
          )}

          {/* Payment */}
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
              Payment
            </h4>
            {details.payment_methods.length > 0 ? (
              <div className="space-y-1.5">
                {details.payment_methods.map((pm, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
                  >
                    <CreditCardIcon />
                    <div>
                      <span className="text-sm text-gray-800">
                        {capitalise(pm.card_brand)} ending {pm.card_last_four}
                      </span>
                      {pm.card_expiry && (
                        <p className="text-xs text-gray-400">
                          Expires {pm.card_expiry}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No card on file</p>
            )}
          </section>

          <div className="h-px bg-gray-200" />

          {/* Today's Session (run sheet only) */}
          {session && (
            <section>
              <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                Today&apos;s session
              </h4>
              <div className="rounded-lg bg-gray-50 px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  {session.scheduled_at && (
                    <span className="text-sm font-medium text-gray-800">
                      {formatTime(session.scheduled_at)}
                    </span>
                  )}
                  {session.type_name && (
                    <>
                      <span className="text-gray-300">&middot;</span>
                      <span className="text-sm text-gray-600">{session.type_name}</span>
                    </>
                  )}
                </div>
                {session.room_name && (
                  <p className="text-xs text-gray-500">{session.room_name}</p>
                )}
                <div className="flex items-center gap-2">
                  <StatusBadge state={session.derived_state} />
                  {session.modality && (
                    <span className="text-xs text-gray-400 capitalize">
                      {session.modality === "telehealth" ? "Telehealth" : "In-person"}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {session && <div className="h-px bg-gray-200" />}

          {/* Visit History */}
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
              Visit history
            </h4>
            {details.visit_history.length > 0 ? (
              <div className="space-y-1">
                {details.visit_history.map((v, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-800">
                      {formatDate(v.date)}
                    </span>
                    {v.type_name && (
                      <span className="text-xs text-gray-400">{v.type_name}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">First visit</p>
            )}
            {isReadinessMode && (
              <p className="text-[10px] text-gray-400 italic mt-1">
                Coviu appointments only — not a complete clinical history
              </p>
            )}
          </section>

          <div className="h-px bg-gray-200" />

          {/* Forms (run sheet / legacy) */}
          {!isReadinessMode && (
            <section>
              <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                Forms
              </h4>
              {details.form_assignments && details.form_assignments.length > 0 ? (
                <div className="space-y-1.5">
                  {details.form_assignments.map((fa) => (
                    <div
                      key={fa.id}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-gray-800 block truncate">
                          {fa.form_name}
                        </span>
                        <span className="text-xs text-gray-400">
                          {fa.status === "completed" && fa.completed_at
                            ? `Completed ${relativeTime(fa.completed_at)}`
                            : fa.sent_at
                              ? `Sent ${relativeTime(fa.sent_at)}`
                              : "Pending"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            fa.status === "completed"
                              ? "bg-teal-500/15 text-teal-700"
                              : fa.status === "opened"
                                ? "bg-amber-500/15 text-amber-700"
                                : fa.status === "sent"
                                  ? "bg-amber-500/15 text-amber-700"
                                  : "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {fa.status === "completed" ? "Completed" : fa.status === "opened" ? "Opened" : fa.status === "sent" ? "Sent" : "Pending"}
                        </span>
                        {fa.status !== "completed" ? (
                          <button
                            type="button"
                            onClick={async () => {
                              setResendingId(fa.id);
                              try {
                                await fetch("/api/forms/assignments/send", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ assignment_id: fa.id }),
                                });
                              } catch {
                                // silent
                              }
                              setTimeout(() => setResendingId(null), 2000);
                            }}
                            className="text-[11px] text-teal-600 hover:text-teal-700 whitespace-nowrap"
                          >
                            {resendingId === fa.id ? "Sent!" : "Resend"}
                          </button>
                        ) : fa.submission_id ? (
                          <button
                            type="button"
                            onClick={() => {
                              window.open(`/api/forms/submissions/${fa.submission_id}`, "_blank");
                            }}
                            className="text-[11px] text-teal-600 hover:text-teal-700 whitespace-nowrap"
                          >
                            View
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No forms sent to this patient.</p>
              )}
            </section>
          )}
        </div>
      )}
    </SlideOver>
  );
}

// --- Helpers ---

function formatDob(dob: string): string {
  const date = new Date(dob + "T00:00:00");
  const formatted = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const age = Math.floor(
    (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
  return `${formatted} (${age})`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
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
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function QuickActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300"
    >
      {icon}
      {label}
    </button>
  );
}

function CreditCardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}
