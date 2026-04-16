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
  if (isUpcoming(session, now)) return 'upcoming';
  return 'queued';
}

/** Session is late: past scheduled time and patient hasn't arrived. */
export function isLate(session: RunsheetSession, now: Date): boolean {
  if (!session.scheduled_at) return false;
  const scheduledTime = new Date(session.scheduled_at);
  return now > scheduledTime && session.status === 'queued';
}

/** Session is upcoming: within 10 minutes of scheduled time, patient hasn't arrived. */
export function isUpcoming(session: RunsheetSession, now: Date): boolean {
  if (session.status !== 'queued' || session.patient_arrived || !session.scheduled_at) {
    return false;
  }
  const scheduledTime = new Date(session.scheduled_at);
  const minutesUntil = (scheduledTime.getTime() - now.getTime()) / 60_000;
  return minutesUntil > 0 && minutesUntil <= 10;
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
  now: Date,
  connectedSessions?: Set<string>
): EnrichedSession {
  const derived_state = getDerivedState(session, now);
  const patient_disconnected =
    connectedSessions !== undefined &&
    (session.status === 'waiting' || session.status === 'in_session') &&
    session.patient_arrived &&
    !connectedSessions.has(session.session_id);

  return {
    ...session,
    derived_state,
    patient_disconnected,
  };
}

/** Enrich all sessions. */
export function enrichSessions(
  sessions: RunsheetSession[],
  now: Date,
  connectedSessions?: Set<string>
): EnrichedSession[] {
  return sessions.map((s) => enrichSession(s, now, connectedSessions));
}

/** Left border colour class for a derived state. */
export function getRowBorderColor(state: DerivedDisplayState): string {
  switch (state) {
    case 'late':
      return 'border-l-red-500';
    case 'upcoming':
      return 'border-l-amber-500';
    case 'waiting':
    case 'checked_in':
      return 'border-l-amber-500';
    case 'in_session':
    case 'running_over':
      return 'border-l-teal-500';
    case 'complete':
      return 'border-l-blue-500/60';
    case 'done':
      return 'border-l-gray-200';
    case 'queued':
    default:
      return 'border-l-gray-200';
  }
}

/** Badge configuration for each derived state. */
export function getStatusBadgeConfig(state: DerivedDisplayState): StatusBadgeConfig {
  switch (state) {
    case 'late':
      return { label: 'Late', variant: 'red' };
    case 'upcoming':
      return { label: 'Upcoming', variant: 'amber' };
    case 'waiting':
      return { label: 'Waiting', variant: 'amber-soft' };
    case 'checked_in':
      return { label: 'Checked in', variant: 'amber-soft' };
    case 'in_session':
      return { label: 'In session', variant: 'teal-muted' };
    case 'running_over':
      return { label: 'Running over', variant: 'teal-muted' };
    case 'complete':
      return { label: 'Complete', variant: 'blue-muted' };
    case 'done':
      return { label: 'Done', variant: 'faded' };
    case 'queued':
    default:
      return { label: 'Queued', variant: 'gray' };
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
    case 'in_session':
    case 'running_over':
      return { label: 'Rejoin', variant: 'teal', action: 'rejoin' };
    default:
      return null;
  }
}

/** Whether a derived state is an "attention" state that triggers auto-expand. */
export function isAttentionState(state: DerivedDisplayState): boolean {
  return state !== 'queued' && state !== 'done';
}
