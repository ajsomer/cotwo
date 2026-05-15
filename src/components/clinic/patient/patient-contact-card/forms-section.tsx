"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ActionTypeIcon } from "@/components/clinic/shared/action-type-icon";
import type { ActionType } from "@/lib/workflows/types";
import type { EnrichedSession } from "@/lib/supabase/types";
import type { ReadinessAppointment } from "@/stores/clinic-store";
import {
  ACTION_STATUS_BADGE,
  type CompletedFormDisplayRow,
  type PatientDetails,
} from "./types";

interface WorkflowTimelineProps {
  appointment: ReadinessAppointment;
}

export function WorkflowTimeline({ appointment }: WorkflowTimelineProps) {
  // Sort by offset descending — matches the original ordering
  const sortedActions = [...appointment.actions].sort(
    (a, b) => b.offset_minutes - a.offset_minutes
  );

  if (sortedActions.length === 0) return null;

  return (
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
            <div
              key={action.action_id}
              className="relative flex items-start gap-2"
            >
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
                    variant={
                      badge.variant as
                        | "red"
                        | "amber"
                        | "teal"
                        | "gray"
                        | "faded"
                    }
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
  );
}

interface CompletedFormsListProps {
  details: PatientDetails;
  appointment?: ReadinessAppointment | null;
  session?: EnrichedSession | null;
  isReadinessMode: boolean;
}

export function CompletedFormsList({
  details,
  appointment,
  session,
  isReadinessMode,
}: CompletedFormsListProps) {
  const completedForms = useMemo(
    () =>
      buildCompletedFormsList(details, appointment, session, isReadinessMode),
    [details, appointment, session, isReadinessMode]
  );

  if (completedForms.length === 0) return null;

  return (
    <section>
      <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
        Completed forms
      </h4>
      <div className="space-y-1.5">
        {completedForms.map((row) => (
          <button
            key={row.submission_id}
            type="button"
            onClick={() =>
              window.open(
                `/api/forms/submissions/${row.submission_id}/pdf`,
                "_blank"
              )
            }
            className="w-full flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
            title={`Submitted ${formatFullTimestamp(row.completed_at)}`}
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm text-gray-800 block truncate">
                {row.form_name}
              </span>
              <span
                className="text-xs text-gray-400"
                title={formatFullTimestamp(row.completed_at)}
              >
                Submitted {relativeTime(row.completed_at)}
              </span>
            </div>
            <span className="text-[11px] font-medium text-teal-600 ml-2 flex-shrink-0">
              View
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCompletedFormsList(
  details: PatientDetails,
  appointment: ReadinessAppointment | null | undefined,
  session: EnrichedSession | null | undefined,
  isReadinessMode: boolean
): CompletedFormDisplayRow[] {
  // Readiness mode: read directly from the readiness payload's
  // completed_form_submissions (built in fetchers/readiness.ts).
  if (isReadinessMode && appointment) {
    return (appointment.completed_form_submissions ?? [])
      .slice()
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
      .map((s) => ({
        submission_id: s.submission_id,
        form_name: s.form_name,
        completed_at: s.completed_at,
      }));
  }

  // Non-readiness modes: union of form_assignments (completed, with a
  // submission_id) + form_submissions, deduplicated by submission_id.
  const assignmentRows = details.form_assignments
    .filter((a) => a.status === "completed" && a.submission_id)
    .map((a) => ({
      submission_id: a.submission_id!,
      form_name: a.form_name,
      completed_at: a.completed_at ?? a.created_at,
      appointment_id: a.appointment_id,
    }));

  const submissionRows = details.form_submissions.map((s) => ({
    submission_id: s.submission_id,
    form_name: s.form_name,
    completed_at: s.completed_at,
    appointment_id: s.appointment_id,
  }));

  const seen = new Set<string>();
  const merged: {
    submission_id: string;
    form_name: string;
    completed_at: string;
    appointment_id: string | null;
  }[] = [];
  for (const row of [...assignmentRows, ...submissionRows]) {
    if (seen.has(row.submission_id)) continue;
    seen.add(row.submission_id);
    merged.push(row);
  }

  // Run-sheet mode (regular session): scope to session.appointment_id.
  // Run-sheet on-demand session (no appointment_id): fall back to standalone.
  // Standalone: all rows.
  let scoped = merged;
  if (session?.appointment_id) {
    scoped = merged.filter((r) => r.appointment_id === session.appointment_id);
  }

  return scoped
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
    .slice(0, 10)
    .map((r) => ({
      submission_id: r.submission_id,
      form_name: r.form_name,
      completed_at: r.completed_at,
    }));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatFullTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
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
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}
