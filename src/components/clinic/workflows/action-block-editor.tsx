"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Textarea, Select } from "@/components/ui/input";
import { ActionTypeIcon } from "@/components/clinic/shared/action-type-icon";
import { formatFireTime, type ActionType } from "@/lib/workflows/types";

/**
 * Shared timeline editor pieces for post-appointment action blocks, used by
 * the pathway builder (outcome-pathway-editor) and the Process flow's
 * per-session customisation step (process-flow-outcome).
 */

export function timingLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Same day";
  const days = offsetMinutes / 1440;
  if (Number.isInteger(days)) return `Day ${days}`;
  return formatFireTime(offsetMinutes, "after").label;
}

/** The "Session complete" T+0 row at the top of the timeline. */
export function TimelineStartMarker() {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-2 h-2 rounded-full bg-gray-300 ml-1" />
      <span className="text-xs text-gray-400 font-medium">
        Session complete
      </span>
    </div>
  );
}

/** Vertical rail segment beside a block card. */
export function TimelineRail({
  isFirst,
  isLast,
  active = true,
}: {
  isFirst: boolean;
  isLast: boolean;
  active?: boolean;
}) {
  return (
    <div className="flex flex-col items-center w-4 shrink-0">
      {!isFirst && <div className="w-px flex-1 bg-gray-200 -mt-1" />}
      <div
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          active ? "bg-teal-500" : "bg-gray-200"
        }`}
      />
      {!isLast && <div className="w-px flex-1 bg-gray-200" />}
    </div>
  );
}

interface ActionBlockCardProps {
  isFirst: boolean;
  isLast: boolean;
  actionType: ActionType;
  timingMinutes: number;
  typeLabel: string;
  /** Second header line (the Process flow's block summary). */
  summary?: string;
  /** When false, renders the dimmed/disabled card treatment. */
  enabled?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Header control rendered before the chevron (Process flow's Toggle). */
  beforeChevron?: ReactNode;
  /** Header control rendered after the chevron (builder's delete button). */
  afterChevron?: ReactNode;
  /** Expanded editor body; rendered only while expanded. */
  children?: ReactNode;
}

/** One timeline row: rail + collapsible block card. */
export function ActionBlockCard({
  isFirst,
  isLast,
  actionType,
  timingMinutes,
  typeLabel,
  summary,
  enabled = true,
  expanded,
  onToggleExpand,
  beforeChevron,
  afterChevron,
  children,
}: ActionBlockCardProps) {
  return (
    <div className="flex gap-3">
      <TimelineRail isFirst={isFirst} isLast={isLast} active={enabled} />

      <div
        className={`flex-1 min-w-0 rounded-lg border p-3 mb-2 transition-colors ${
          enabled
            ? "border-gray-200 bg-white"
            : "border-gray-100 bg-gray-50 opacity-50"
        }`}
      >
        {/* Card header — clickable to expand/collapse */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={onToggleExpand}
        >
          <ActionTypeIcon actionType={actionType} size={16} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400">
                {timingLabel(timingMinutes)}
              </span>
              <span className="text-xs text-gray-300">·</span>
              <span className="text-xs text-gray-500">{typeLabel}</span>
            </div>
            {summary !== undefined && (
              <p className="text-sm text-gray-800 truncate">{summary}</p>
            )}
          </div>

          {beforeChevron}

          <div className="shrink-0 text-gray-400">
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>

          {afterChevron}
        </div>

        {expanded && children}
      </div>
    </div>
  );
}

interface ActionBlockFieldEditorProps {
  actionType: ActionType;
  offsetMinutes: number;
  onOffsetChange: (minutes: number) => void;
  config: Record<string, unknown>;
  onConfigChange: (updates: Record<string, unknown>) => void;
  formId: string | null;
  onFormIdChange: (formId: string | null) => void;
  forms: Array<{ id: string; name: string; status: string }>;
  files: Array<{ id: string; name: string; file_size_bytes: number }>;
  /**
   * The pathway builder offers an optional reminder SMS on deliver_form
   * blocks; the per-session Process flow deliberately doesn't — both
   * surfaces shipped together with this difference (commit 0b5dcfd).
   */
  allowFormReminder?: boolean;
  /**
   * "builder" shows authoring placeholders; "customise" starts from the
   * pathway's defaults so fields render without placeholder copy.
   */
  variant: "builder" | "customise";
  /** Extra rows (e.g. the builder's default-enabled toggle) above the
      per-type fields. */
  children?: ReactNode;
}

/** Timing picker + the four per-action-type field editors. */
export function ActionBlockFieldEditor({
  actionType,
  offsetMinutes,
  onOffsetChange,
  config,
  onConfigChange,
  formId,
  onFormIdChange,
  forms,
  files,
  allowFormReminder = false,
  variant,
  children,
}: ActionBlockFieldEditorProps) {
  const builder = variant === "builder";
  const wrap = builder ? "" : "flex-wrap ";
  const hintClass = builder
    ? "text-xs text-gray-400 mt-1"
    : "text-xs text-gray-400 mt-1 break-words";

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      {/* Timing */}
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">
          Timing (days after session)
        </label>
        <div className={`flex ${wrap}items-center gap-2`}>
          <input
            type="number"
            min={0}
            value={offsetMinutes / 1440}
            onChange={(e) =>
              onOffsetChange(parseInt(e.target.value || "0") * 1440)
            }
            className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <div className={`flex ${wrap}gap-1`}>
            {[1, 3, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => onOffsetChange(d * 1440)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  offsetMinutes === d * 1440
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {children}

      {/* SMS fields */}
      {actionType === "send_sms" && (
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">
            SMS message
          </label>
          <Textarea
            value={(config.message as string) ?? ""}
            onChange={(e) => onConfigChange({ message: e.target.value })}
            rows={3}
            placeholder={builder ? "Hi {first_name}, ..." : undefined}
          />
          <p className={hintClass}>
            Variables: {"{first_name}"}, {"{clinic_name}"},{" "}
            {"{clinician_name}"}, {"{session_date}"}
          </p>
        </div>
      )}

      {/* Form fields */}
      {actionType === "deliver_form" && (
        <>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              Form
            </label>
            <Select
              value={formId ?? ""}
              onChange={(e) => onFormIdChange(e.target.value || null)}
            >
              <option value="">Select a form...</option>
              {forms
                .filter((f) => f.status === "published")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>
          </div>
          {allowFormReminder && (
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Reminder SMS (optional)
              </label>
              <Textarea
                value={(config.reminder_sms as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ reminder_sms: e.target.value })
                }
                rows={2}
                placeholder="Your clinician has sent you a form..."
              />
            </div>
          )}
        </>
      )}

      {/* Task fields */}
      {actionType === "task" && (
        <>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              Task title
            </label>
            <input
              type="text"
              value={(config.task_title as string) ?? ""}
              onChange={(e) => onConfigChange({ task_title: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
              placeholder={builder ? "e.g. Send referral" : undefined}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              Description (optional)
            </label>
            <Textarea
              value={(config.task_description as string) ?? ""}
              onChange={(e) =>
                onConfigChange({ task_description: e.target.value })
              }
              rows={2}
              placeholder={builder ? "Additional context..." : undefined}
            />
          </div>
        </>
      )}

      {/* Send file fields */}
      {actionType === "send_file" && (
        <>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              File
            </label>
            <select
              value={(config.file_id as string) ?? ""}
              onChange={(e) => onConfigChange({ file_id: e.target.value || "" })}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select a file...</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({Math.round(f.file_size_bytes / 1024)} KB)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              SMS message
            </label>
            <Textarea
              value={(config.message as string) ?? ""}
              onChange={(e) => onConfigChange({ message: e.target.value })}
              rows={3}
              placeholder={
                builder
                  ? "Hi {first_name}, your clinician has shared a document with you."
                  : undefined
              }
            />
            <p className={hintClass}>
              Variables: {"{first_name}"}, {"{clinic_name}"},{" "}
              {"{clinician_name}"}, {"{file_link}"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
