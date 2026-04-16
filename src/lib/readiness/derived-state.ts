/**
 * Readiness Dashboard derived state — pure functions for priority derivation,
 * sorting, and display helpers.
 *
 * Follows the same pattern as src/lib/runsheet/derived-state.ts.
 */

import type { ReadinessAppointment, WorkflowAction } from '@/stores/clinic-store';

/** ReadinessAppointment with priority already computed (e.g. from the API). */
type AppointmentWithPriority = ReadinessAppointment & { priority?: ReadinessPriority };

// ───────────────────────────── Types ─────────────────────────────

export type ReadinessPriority =
  | 'overdue'
  | 'form_completed_needs_transcription'
  | 'at_risk'
  | 'in_progress'
  | 'recently_completed';

export interface PriorityBadgeConfig {
  label: string;
  variant: string;
}

// ───────────────────────────── Constants ─────────────────────────

const TERMINAL_STATUSES = [
  'completed',
  'captured',
  'verified',
  'skipped',
  'failed',
  'transcribed',
];

const MS_PER_HOUR = 60 * 60 * 1000;
const OVERDUE_APPOINTMENT_WINDOW_MS = 24 * MS_PER_HOUR;
const OVERDUE_ACTION_FALLBACK_MS = 48 * MS_PER_HOUR;
const AT_RISK_WINDOW_MS = 7 * 24 * MS_PER_HOUR;
const RECENTLY_COMPLETED_RETENTION_MS = 7 * 24 * MS_PER_HOUR;

// ───────────────────────────── Priority Order ───────────────────

const PRIORITY_ORDER: ReadinessPriority[] = [
  'overdue',
  'form_completed_needs_transcription',
  'at_risk',
  'in_progress',
  'recently_completed',
];

// ───────────────────────────── Core Derivation ──────────────────

/** Is a single action in a terminal (completed) state? */
function isTerminal(action: WorkflowAction): boolean {
  return TERMINAL_STATUSES.includes(action.status);
}

/**
 * For post-appointment display: treat a scheduled SMS/form action whose
 * scheduled_for is in the past as effectively "done". The engine hasn't
 * fired it (no real SMS provider), but for demo purposes we don't want
 * it stuck in "Scheduled" forever. Task actions are excluded — they
 * require explicit receptionist resolution.
 */
function isEffectivelyDone(action: WorkflowAction, now: Date): boolean {
  if (!action.session_id) return false; // pre-appointment — use normal logic
  if (isTerminal(action)) return true;
  if (action.action_type === 'task') return false; // tasks need manual resolution
  if (action.status === 'scheduled' && action.scheduled_for) {
    return new Date(action.scheduled_for).getTime() <= now.getTime();
  }
  return false;
}

/**
 * An action is overdue when:
 *
 * Pre-appointment:
 * - It is non-terminal
 * - Its scheduled_for is in the past
 * - AND either (a) the appointment is within 24 hours, or (b) the action was
 *   scheduled more than 48 hours ago. Whichever triggers first.
 *
 * Post-appointment:
 * - Task: status = 'fired' and scheduled_for is past (receptionist hasn't resolved)
 * - SMS/Form: status = 'failed' (delivery failed)
 */
export function isOverdue(
  action: WorkflowAction,
  appointment: ReadinessAppointment,
  now: Date
): boolean {
  // Post-appointment: simpler overdue logic
  // Only tasks that have fired but not been resolved are overdue.
  // SMS/form actions past their scheduled time are treated as "done" for demo
  // purposes (no real SMS provider yet — they never actually fire).
  if (action.session_id) {
    if (action.status === 'failed') return true;
    if (action.action_type === 'task' && action.status === 'fired') {
      const scheduledFor = new Date(action.scheduled_for).getTime();
      return scheduledFor < now.getTime();
    }
    return false;
  }

  // Pre-appointment: existing logic
  if (isTerminal(action)) return false;
  if (!action.scheduled_for) return false;

  const scheduledFor = new Date(action.scheduled_for).getTime();
  const nowMs = now.getTime();

  if (scheduledFor >= nowMs) return false; // not past due

  // If no appointment time (collection-only), use action age only
  if (!appointment.scheduled_at) {
    return nowMs - scheduledFor >= OVERDUE_ACTION_FALLBACK_MS;
  }

  const appointmentAt = new Date(appointment.scheduled_at).getTime();
  const appointmentWithin24h = appointmentAt - nowMs <= OVERDUE_APPOINTMENT_WINDOW_MS;
  const actionScheduled48hAgo = nowMs - scheduledFor >= OVERDUE_ACTION_FALLBACK_MS;

  return appointmentWithin24h || actionScheduled48hAgo;
}

/**
 * An action is at risk / due soon when:
 *
 * Pre-appointment:
 * - Non-terminal, scheduled_for in the past, appointment within 7 days,
 *   but the overdue conditions are NOT met.
 *
 * Post-appointment:
 * - Scheduled_for is within the next 24 hours and status is scheduled or fired
 *   (task about to become actionable, or recently fired and not yet resolved).
 */
export function isAtRisk(
  action: WorkflowAction,
  appointment: ReadinessAppointment,
  now: Date
): boolean {
  // Post-appointment: "at risk" only when fired but not yet resolved.
  // A scheduled action in the future is just "scheduled" — not at risk.
  // The task becomes at risk once the engine fires it (status = 'fired')
  // and the receptionist hasn't resolved it yet.
  if (action.session_id) {
    if (isTerminal(action)) return false;
    if (action.status === 'fired') return true;
    return false;
  }

  // Pre-appointment: existing logic
  if (isTerminal(action)) return false;
  if (!action.scheduled_for) return false;

  const scheduledFor = new Date(action.scheduled_for).getTime();
  const nowMs = now.getTime();

  if (scheduledFor >= nowMs) return false; // not past due

  // If no appointment time (collection-only), can't be at risk via appointment proximity
  if (!appointment.scheduled_at) return false;

  const appointmentAt = new Date(appointment.scheduled_at).getTime();
  const appointmentWithin7d = appointmentAt - nowMs <= AT_RISK_WINDOW_MS;

  if (!appointmentWithin7d) return false;

  // Must not already be overdue
  return !isOverdue(action, appointment, now);
}

/**
 * A deliver_form action needs transcription when its status is 'completed'
 * (patient completed the form) but not yet 'transcribed' (receptionist hasn't
 * copied data to PMS).
 */
export function isFormNeedsTranscription(action: WorkflowAction): boolean {
  return action.action_type === 'deliver_form' && action.status === 'completed';
}

/**
 * Derive the highest-priority state for an appointment based on all its actions.
 *
 * Priority order (spec):
 * 1. overdue
 * 2. form_completed_needs_transcription
 * 3. at_risk
 * 4. in_progress
 * 5. recently_completed
 */
export function getReadinessPriority(
  appointment: ReadinessAppointment,
  now: Date
): ReadinessPriority {
  const { actions } = appointment;

  // Check if all actions are terminal (or effectively done for post-appointment demo)
  const allTerminal = actions.length > 0 && actions.every(
    (a) => isTerminal(a) || isEffectivelyDone(a, now)
  );

  if (allTerminal) {
    // Recently completed if the most recent action's updated_at is within 7 days
    const mostRecentUpdate = getMostRecentActionUpdate(actions);
    if (mostRecentUpdate && now.getTime() - mostRecentUpdate <= RECENTLY_COMPLETED_RETENTION_MS) {
      return 'recently_completed';
    }
    // Beyond retention window — still return recently_completed; the API
    // should filter these out, but the UI can handle it gracefully.
    return 'recently_completed';
  }

  // Check for overdue actions
  const hasOverdue = actions.some((a) => isOverdue(a, appointment, now));
  if (hasOverdue) return 'overdue';

  // Check for forms needing transcription
  const hasFormNeedsTranscription = actions.some(isFormNeedsTranscription);
  if (hasFormNeedsTranscription) return 'form_completed_needs_transcription';

  // Check for at-risk actions
  const hasAtRisk = actions.some((a) => isAtRisk(a, appointment, now));
  if (hasAtRisk) return 'at_risk';

  return 'in_progress';
}

/**
 * Get the most recent updated_at timestamp across all actions.
 * Uses fired_at as a proxy since the API may not expose updated_at directly.
 * Falls back to scheduled_for.
 */
function getMostRecentActionUpdate(actions: WorkflowAction[]): number | null {
  let latest = 0;
  for (const action of actions) {
    // Prefer updated_at if available, then fired_at, then scheduled_for
    const ts = (action as WorkflowAction & { updated_at?: string }).updated_at
      ?? action.fired_at
      ?? action.scheduled_for;
    if (ts) {
      const t = new Date(ts).getTime();
      if (t > latest) latest = t;
    }
  }
  return latest || null;
}

// ───────────────────────────── Sorting ───────────────────────────

/**
 * Sort appointments by priority hierarchy, then within each slot:
 * - overdue: most-overdue-first (largest gap between now and scheduled_for)
 * - form_completed_needs_transcription: oldest form first
 * - at_risk: soonest appointment first
 * - in_progress: alphabetical by patient last name
 * - recently_completed: most-recently-completed first
 */
export function sortByPriority(
  appointments: AppointmentWithPriority[],
  now: Date
): AppointmentWithPriority[] {
  return [...appointments].sort((a, b) => {
    const aPriority = a.priority ?? getReadinessPriority(a, now);
    const bPriority = b.priority ?? getReadinessPriority(b, now);

    const aIdx = PRIORITY_ORDER.indexOf(aPriority);
    const bIdx = PRIORITY_ORDER.indexOf(bPriority);

    if (aIdx !== bIdx) return aIdx - bIdx;

    // Within the same priority slot, apply slot-specific sorting
    switch (aPriority) {
      case 'overdue': {
        // Most overdue first: largest gap between now and the most-overdue action's scheduled_for
        const aOverdue = getMostOverdueGap(a, now);
        const bOverdue = getMostOverdueGap(b, now);
        return bOverdue - aOverdue; // descending
      }
      case 'form_completed_needs_transcription': {
        // Oldest form first (earliest scheduled_for among form actions)
        const aForm = getEarliestFormTime(a);
        const bForm = getEarliestFormTime(b);
        return aForm - bForm; // ascending
      }
      case 'at_risk': {
        // Soonest appointment first; collection-only (null scheduled_at) sorts by oldest action
        const aTime = a.scheduled_at
          ? new Date(a.scheduled_at).getTime()
          : getEarliestActionTime(a);
        const bTime = b.scheduled_at
          ? new Date(b.scheduled_at).getTime()
          : getEarliestActionTime(b);
        return aTime - bTime;
      }
      case 'in_progress': {
        // Alphabetical by patient last name
        return a.patient_last_name.localeCompare(b.patient_last_name);
      }
      case 'recently_completed': {
        // Most recently completed first
        const aUpdate = getMostRecentActionUpdate(a.actions) ?? 0;
        const bUpdate = getMostRecentActionUpdate(b.actions) ?? 0;
        return bUpdate - aUpdate; // descending
      }
      default:
        return 0;
    }
  });
}

/** Get the largest overdue gap (now - scheduled_for) among overdue actions. */
function getMostOverdueGap(appointment: ReadinessAppointment, now: Date): number {
  let maxGap = 0;
  for (const action of appointment.actions) {
    if (isOverdue(action, appointment, now) && action.scheduled_for) {
      const gap = now.getTime() - new Date(action.scheduled_for).getTime();
      if (gap > maxGap) maxGap = gap;
    }
  }
  return maxGap;
}

/** Get the earliest scheduled_for time among form-needs-transcription actions. */
function getEarliestFormTime(appointment: ReadinessAppointment): number {
  let earliest = Infinity;
  for (const action of appointment.actions) {
    if (isFormNeedsTranscription(action) && action.scheduled_for) {
      const t = new Date(action.scheduled_for).getTime();
      if (t < earliest) earliest = t;
    }
  }
  return earliest;
}

/** Get the earliest scheduled_for time across all actions (fallback for null scheduled_at). */
function getEarliestActionTime(appointment: ReadinessAppointment): number {
  let earliest = Infinity;
  for (const action of appointment.actions) {
    if (action.scheduled_for) {
      const t = new Date(action.scheduled_for).getTime();
      if (t < earliest) earliest = t;
    }
  }
  return earliest;
}

// ───────────────────────────── Display Helpers ───────────────────

/** Badge config for each priority state. */
export function getPriorityBadgeConfig(priority: ReadinessPriority): PriorityBadgeConfig {
  switch (priority) {
    case 'overdue':
      return { label: 'Overdue', variant: 'red' };
    case 'form_completed_needs_transcription':
      return { label: 'Form completed', variant: 'amber' };
    case 'at_risk':
      return { label: 'At risk', variant: 'amber' };
    case 'in_progress':
      return { label: 'In progress', variant: 'gray' };
    case 'recently_completed':
      return { label: 'Completed', variant: 'faded' };
    default:
      return { label: 'Unknown', variant: 'gray' };
  }
}

/** Left border colour class for a priority state. */
export function getPriorityBorderColor(priority: ReadinessPriority): string {
  switch (priority) {
    case 'overdue':
      return 'border-l-red-500';
    case 'form_completed_needs_transcription':
      return 'border-l-amber-500';
    case 'at_risk':
      return 'border-l-amber-500/60';
    case 'in_progress':
      return 'border-l-gray-200';
    case 'recently_completed':
      return 'border-l-gray-200';
    default:
      return 'border-l-gray-200';
  }
}

/** Action button config for each priority state. null = no action button. */
export function getActionButtonConfig(
  priority: ReadinessPriority
): { label: string; variant: string; action: string } | null {
  switch (priority) {
    case 'overdue':
      return { label: 'Resolve', variant: 'red', action: 'resolve' };
    case 'form_completed_needs_transcription':
      return { label: 'Review', variant: 'amber', action: 'review' };
    case 'at_risk':
      return { label: 'Nudge', variant: 'amber', action: 'nudge' };
    default:
      return null;
  }
}

/** Whether a priority state should auto-expand the row. */
export function isAttentionPriority(priority: ReadinessPriority): boolean {
  return (
    priority === 'overdue' ||
    priority === 'form_completed_needs_transcription' ||
    priority === 'at_risk'
  );
}

/**
 * Get the actions that are causing the attention state (for auto-expanded rows).
 * Returns only the triggering actions, not all actions.
 */
export function getTriggeringActions(
  appointment: AppointmentWithPriority,
  now: Date
): WorkflowAction[] {
  const priority = appointment.priority ?? getReadinessPriority(appointment, now);

  switch (priority) {
    case 'overdue':
      return appointment.actions.filter((a) => isOverdue(a, appointment, now));
    case 'form_completed_needs_transcription':
      return appointment.actions.filter(isFormNeedsTranscription);
    case 'at_risk':
      return appointment.actions.filter((a) => isAtRisk(a, appointment, now));
    default:
      return [];
  }
}
