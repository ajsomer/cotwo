"use client";

import { useEffect, useMemo, useState } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { WorkflowAction } from "@/stores/clinic-store";
import { isWorkflowMessage } from "@/lib/workflows/types";
import { WorkflowActionRow, IntakeItemRow } from "./forms-section";

// Whether an action is shown anywhere in a run block: a patient to-do (Actions)
// or one of the workflow's configurable SMS (Messages). Everything else
// ("system" — add_to_runsheet, plain appointment reminders) and dropped actions
// are excluded.
function isVisibleAction(a: WorkflowAction): boolean {
  return a.action_kind === "action" || isWorkflowMessage(a.action_type);
}

interface WorkflowsSectionProps {
  // Flat action list spanning the patient's recent appointment window. Grouped
  // here into one collapsible block per workflow run. The active appointment's
  // run(s) open by default.
  actions: WorkflowAction[];
  activeAppointmentId: string | null;
}

interface WorkflowRunGroup {
  // Stable group key: the run id, or a per-appointment synthetic for actions
  // with no run linkage ("Other messages").
  key: string;
  title: string;
  appointmentId: string | null;
  scheduledAt: string | null;
  isActive: boolean;
  actions: WorkflowAction[];
}

const ORPHAN_PREFIX = "orphan:";

function formatHeaderDate(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Status rollup for the collapsed summary, e.g. "3 sent · 1 pending". Buckets
// match the timeline's badge groupings.
function summarise(actions: WorkflowAction[]): string {
  let sent = 0;
  let pending = 0;
  let done = 0;
  let failed = 0;
  for (const a of actions) {
    switch (a.status) {
      case "sent":
      case "opened":
      case "firing":
        sent++;
        break;
      case "scheduled":
      case "pending":
        pending++;
        break;
      case "completed":
      case "captured":
      case "verified":
      case "transcribed":
        done++;
        break;
      case "failed":
        failed++;
        break;
      default:
        break;
    }
  }
  const parts: string[] = [];
  if (done) parts.push(`${done} done`);
  if (sent) parts.push(`${sent} sent`);
  if (pending) parts.push(`${pending} pending`);
  if (failed) parts.push(`${failed} failed`);
  if (parts.length === 0) parts.push(`${actions.length} item${actions.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function buildGroups(
  actions: WorkflowAction[],
  activeAppointmentId: string | null,
): WorkflowRunGroup[] {
  const byKey = new Map<string, WorkflowRunGroup>();

  for (const action of actions) {
    // "dropped" actions were never going to fire (their scheduled time fell
    // after the appointment), so they were never sent — hide them; surfacing
    // them just confuses staff reading the record of what reached the patient.
    if (action.status === "dropped") continue;

    // Only patient to-dos and the workflow's configurable SMS are shown.
    // System steps (add_to_runsheet, plain appointment reminders) are excluded.
    if (!isVisibleAction(action)) continue;

    const runId = action.workflow_run_id ?? null;
    const apptId = action.run_appointment_id ?? null;
    // Orphan actions (no run) group per-appointment so they don't all merge
    // into one undifferentiated bucket across appointments.
    const key = runId ?? `${ORPHAN_PREFIX}${apptId ?? "unknown"}`;

    let group = byKey.get(key);
    if (!group) {
      const date = formatHeaderDate(action.run_appointment_scheduled_at ?? null);
      // Label workflows by appointment type (matches the Workflows tab), not the
      // template name. Fall back to template name, then a generic label.
      const baseTitle = runId
        ? action.appointment_type_name ||
          action.workflow_template_name ||
          "Workflow"
        : "Other messages";
      group = {
        key,
        title: date ? `${baseTitle} · ${date}` : baseTitle,
        appointmentId: apptId,
        scheduledAt: action.run_appointment_scheduled_at ?? null,
        isActive: apptId != null && apptId === activeAppointmentId,
        actions: [],
      };
      byKey.set(key, group);
    }
    group.actions.push(action);
  }

  const groups = [...byKey.values()];

  // Order actions within each run: scheduled_for asc, action_id as a stable
  // tiebreak so ordering is deterministic.
  for (const g of groups) {
    g.actions.sort((a, b) => {
      const byTime = a.scheduled_for.localeCompare(b.scheduled_for);
      return byTime !== 0 ? byTime : a.action_id.localeCompare(b.action_id);
    });
  }

  // Order groups: active appointment's runs first, then most-recent
  // appointment date descending (nulls last).
  groups.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.scheduledAt && b.scheduledAt)
      return b.scheduledAt.localeCompare(a.scheduledAt);
    if (a.scheduledAt) return -1;
    if (b.scheduledAt) return 1;
    return 0;
  });

  return groups;
}

export function WorkflowsSection({
  actions,
  activeAppointmentId,
}: WorkflowsSectionProps) {
  const groups = useMemo(
    () => buildGroups(actions, activeAppointmentId),
    [actions, activeAppointmentId],
  );

  // Expansion lives in an effect, not a useState initializer: the pane stays
  // mounted while the summary fetch lands later, and the active appointment can
  // change. Seed/reset whenever the run set or active appointment changes —
  // every run tied to the active appointment opens; others collapse. The key
  // is the joined run-id list + active id, so user toggles persist until the
  // underlying data changes.
  const runKey = groups.map((g) => g.key).join("|");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(
      new Set(groups.filter((g) => g.isActive).map((g) => g.key)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, activeAppointmentId]);

  if (groups.length === 0) return null;

  return (
    <section>
      <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
        Workflows
      </h4>
      <div className="space-y-1.5">
        {groups.map((group) => {
          const isOpen = expanded.has(group.key);
          return (
            <CollapsibleSection
              key={group.key}
              title={group.title}
              summary={summarise(group.actions)}
              expanded={isOpen}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
            >
              <WorkflowRunBody actions={group.actions} />
            </CollapsibleSection>
          );
        })}
      </div>
    </section>
  );
}

// A run's contents, split into two labelled sub-groups:
//   Actions  — patient to-dos (intake package + its forms / card / consent),
//              the higher priority.
//   Messages — the workflow's configurable SMS only: the initial intake SMS
//              (carried on the intake_package) and the intake reminders.
// System/non-intake actions (add_to_runsheet, plain appointment reminders) are
// classified "system" and not shown at all.
function WorkflowRunBody({ actions }: { actions: WorkflowAction[] }) {
  // Actions: patient to-dos. intake_package lives here for its to-do breakdown.
  const actionItems = actions.filter((a) => a.action_kind === "action");

  // Messages: only the workflow's configurable SMS. intake_package appears here
  // too — as the "Initial SMS" — alongside the intake reminders.
  const messageItems = actions.filter((a) => isWorkflowMessage(a.action_type));

  if (actionItems.length === 0 && messageItems.length === 0) return null;

  return (
    <div className="space-y-3 pt-2">
      {actionItems.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
            Actions
          </p>
          <div className="relative space-y-3 pl-5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />
            {actionItems.map((action) => (
              <div key={action.action_id} className="space-y-2">
                {/* In the Actions group, the intake_package row is the to-do
                    header — suppress its message dropdown (shown in Messages). */}
                <WorkflowActionRow action={action} hideMessage />
                {action.intake_items && action.intake_items.length > 0 && (
                  <div className="ml-1 space-y-1.5 border-l border-gray-200 pl-3">
                    {action.intake_items.map((item) => (
                      <IntakeItemRow key={item.key} item={item} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {messageItems.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
            Messages
          </p>
          <div className="relative space-y-3 pl-5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />
            {messageItems.map((action) => (
              <WorkflowActionRow
                key={`msg-${action.action_id}`}
                action={action}
                isMessageRow
                labelOverride={
                  action.action_type === "intake_package"
                    ? "Initial SMS"
                    : "Reminder"
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
