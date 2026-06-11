"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ActionTypeIcon } from "@/components/clinic/shared/action-type-icon";
import type { ActionType } from "@/lib/workflows/types";
import type { EnrichedSession } from "@/lib/types/domain";
import { formatDayMonthTime } from "@/lib/runsheet/format";
import type {
  ReadinessAppointment,
  WorkflowAction,
  IntakeItem,
} from "@/stores/clinic-store";
import {
  ACTION_STATUS_BADGE,
  type CompletedFormDisplayRow,
  type PatientDetails,
} from "./types";

/**
 * A single workflow-action row on a timeline: status dot, type icon, label,
 * status badge, fired-at time, and any error. Shared by the patient pane's
 * grouped Workflows section (workflows-section.tsx) so every action renders
 * identically wherever it appears.
 */
export function WorkflowActionRow({
  action,
  labelOverride,
  hideMessage = false,
  isMessageRow = false,
}: {
  action: WorkflowAction;
  // Override the row label (e.g. "Initial SMS" for the intake_package in the
  // Messages group, instead of its action label "Intake package").
  labelOverride?: string;
  // Suppress the message dropdown — used in the Actions group, where the
  // intake_package row is the to-do header and its SMS shows under Messages.
  hideMessage?: boolean;
  // A Messages-group row: the message body is collapsible behind a toggle on
  // the label (collapsed by default), with a fallback note when none configured.
  isMessageRow?: boolean;
}) {
  const badge = ACTION_STATUS_BADGE[action.status] ?? {
    label: action.status,
    variant: "gray",
  };
  const template = hideMessage ? null : action.message_template ?? null;
  const displayLabel = labelOverride ?? action.action_label;
  const canToggle = isMessageRow && !!template;
  const [open, setOpen] = useState(false);

  const labelEl = canToggle ? (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="flex items-center gap-1 min-w-0 text-left hover:text-gray-900"
    >
      <span className="text-xs text-gray-700 truncate">{displayLabel}</span>
      <svg
        className={`h-3 w-3 text-gray-400 shrink-0 transition-transform ${
          open ? "rotate-90" : ""
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  ) : (
    <span className="text-xs text-gray-700 truncate">{displayLabel}</span>
  );

  return (
    <div className="relative flex items-start gap-2">
      <div className="absolute left-[-16px] top-1 w-2 h-2 rounded-full bg-gray-300 border-2 border-white" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <ActionTypeIcon
            actionType={action.action_type as ActionType}
            size={14}
            className="text-gray-400 shrink-0"
          />
          {labelEl}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge
            variant={
              badge.variant as "red" | "amber" | "teal" | "gray" | "faded"
            }
          >
            {badge.label}
          </Badge>
          {action.fired_at && (
            <span className="text-[10px] text-gray-400">
              {formatDayMonthTime(action.fired_at)}
            </span>
          )}
        </div>
        {/* Messages group: SMS text revealed on toggle; fallback note when none. */}
        {isMessageRow && template && open && (
          <div className="mt-1.5 rounded-md bg-gray-50 border border-gray-200 px-2.5 py-2">
            <p className="text-[11px] leading-relaxed text-gray-600 whitespace-pre-wrap break-words">
              {template}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">
              Configured template — placeholders fill in when sent.
            </p>
          </div>
        )}
        {isMessageRow && !template && (
          <p className="mt-1 text-[10px] italic text-gray-400">
            No message configured in the workflow.
          </p>
        )}
        {action.error_message && (
          <p className="text-[10px] text-red-500 mt-0.5">
            {action.error_message}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A constituent to-do of an intake package (a form, card capture, or consent),
 * with a done / outstanding indicator. Rendered nested beneath the
 * intake_package action row in the Workflows section.
 */
export function IntakeItemRow({ item }: { item: IntakeItem }) {
  return (
    <div className="flex items-center gap-2">
      {item.completed ? (
        <svg
          className="h-3.5 w-3.5 text-green-500 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <span className="h-3.5 w-3.5 rounded-full border border-gray-300 shrink-0" />
      )}
      <span
        className={`text-xs truncate ${
          item.completed ? "text-gray-500 line-through" : "text-gray-700"
        }`}
      >
        {item.label}
      </span>
      {!item.completed && (
        <span className="text-[10px] text-amber-600">Outstanding</span>
      )}
    </div>
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

  // Non-readiness mode reads from the bounded /history list; flag when older
  // forms exist beyond the fetched window. Readiness reads from the row, which
  // isn't bounded, so the note never applies there.
  const showTruncationNote =
    !isReadinessMode && !!details.form_history_truncated;

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
      {showTruncationNote && (
        <p className="text-[11px] text-gray-400 mt-2">
          Earlier forms not shown — showing the most recent.
        </p>
      )}
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
