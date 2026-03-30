import type {
  RunsheetSession,
  DerivedDisplayState,
  EnrichedSession,
  StatusBadgeConfig,
  ActionConfig,
} from '@/lib/supabase/types';

/**
 * Calculate the derived display state for a session.
 * This is the core state machine — called on every render and every real-time update.
 */
export function getDerivedState(
  session: RunsheetSession,
  now: Date
): DerivedDisplayState {
  const { status } = session;

  if (status === 'done') return 'done';
  if (status === 'complete') return 'complete';

  if (status === 'in_session') {
    if (isRunningOver(session, now)) return 'running_over';
    return 'in_session';
  }

  if (status === 'waiting') return 'waiting';
  if (status === 'checked_in') return 'checked_in';

  // status === 'queued'
  if (isLate(session, now)) return 'late';
  if (isUpcoming(session)) return 'upcoming';
  return 'queued';
}

/** Session is late: past scheduled time and patient hasn't arrived. */
export function isLate(session: RunsheetSession, now: Date): boolean {
  if (!session.scheduled_at) return false;
  const scheduledTime = new Date(session.scheduled_at);
  return now > scheduledTime && session.status === 'queued';
}

/** Session is upcoming: notification sent, patient hasn't arrived, within window. */
export function isUpcoming(session: RunsheetSession): boolean {
  return (
    session.status === 'queued' &&
    session.notification_sent &&
    !session.patient_arrived
  );
}

/** Session is running over: in_session and past scheduled_at + duration. */
export function isRunningOver(session: RunsheetSession, now: Date): boolean {
  if (!session.scheduled_at || !session.duration_minutes) return false;
  const endTime = new Date(session.scheduled_at);
  endTime.setMinutes(endTime.getMinutes() + session.duration_minutes);
  return now > endTime;
}

/** Enrich a session with its derived state. */
export function enrichSession(
  session: RunsheetSession,
  now: Date
): EnrichedSession {
  return {
    ...session,
    derived_state: getDerivedState(session, now),
  };
}

/** Enrich all sessions. */
export function enrichSessions(
  sessions: RunsheetSession[],
  now: Date
): EnrichedSession[] {
  return sessions.map((s) => enrichSession(s, now));
}

/** Row background tint class for a derived state. */
export function getRowBackground(state: DerivedDisplayState): string {
  switch (state) {
    case 'late':
      return 'bg-[#FFEDED]';
    case 'upcoming':
    case 'waiting':
    case 'checked_in':
      return 'bg-[#FFF8EB]';
    case 'in_session':
    case 'running_over':
      return 'bg-[#EAFAFA]';
    case 'complete':
      return 'bg-[#EDF4FC]';
    case 'done':
      return 'bg-white';
    default:
      return 'bg-white';
  }
}

/** Badge configuration for each derived state. */
export function getStatusBadgeConfig(state: DerivedDisplayState): StatusBadgeConfig {
  switch (state) {
    case 'late':
      return { label: 'Late', variant: 'red', dotColor: 'bg-red-500' };
    case 'upcoming':
      return { label: 'Upcoming', variant: 'amber', dotColor: 'bg-amber-500' };
    case 'waiting':
      return { label: 'Waiting', variant: 'amber', dotColor: 'bg-amber-500' };
    case 'checked_in':
      return { label: 'Checked in', variant: 'amber', dotColor: 'bg-amber-500' };
    case 'in_session':
      return { label: 'In session', variant: 'teal', dotColor: 'bg-teal-500' };
    case 'running_over':
      return { label: 'Running over', variant: 'teal', dotColor: 'bg-teal-500' };
    case 'complete':
      return { label: 'Complete', variant: 'blue', dotColor: 'bg-blue-500' };
    case 'done':
      return { label: 'Done', variant: 'faded', dotColor: 'bg-gray-500' };
    case 'queued':
    default:
      return { label: 'Queued', variant: 'gray', dotColor: 'bg-gray-500' };
  }
}

/** Action button config for each derived state. null = no action available. */
export function getActionConfig(
  state: DerivedDisplayState,
  modality: 'telehealth' | 'in_person' | null
): ActionConfig {
  switch (state) {
    case 'late':
      return { label: 'Call', variant: 'red', action: 'call' };
    case 'upcoming':
      return { label: 'Nudge', variant: 'amber', action: 'nudge' };
    case 'waiting':
      if (modality === 'telehealth') {
        return { label: 'Admit', variant: 'teal', action: 'admit' };
      }
      return null;
    case 'checked_in':
      return { label: 'Process', variant: 'blue', action: 'process' };
    case 'complete':
      return { label: 'Process', variant: 'blue', action: 'process' };
    default:
      return null;
  }
}

/** Whether a derived state is an "attention" state that triggers auto-expand. */
export function isAttentionState(state: DerivedDisplayState): boolean {
  return (
    state === 'late' ||
    state === 'upcoming' ||
    state === 'waiting' ||
    state === 'checked_in' ||
    state === 'running_over' ||
    state === 'complete'
  );
}
