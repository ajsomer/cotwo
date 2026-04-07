import type {
  EnrichedSession,
  RoomGroup,
  RoomCounts,
  RunsheetSummary,
  DerivedDisplayState,
  Room,
} from '@/lib/supabase/types';
import { isAttentionState } from './derived-state';

/** Priority order for sorting sessions within a room and rooms against each other. */
export const PRIORITY_ORDER: Record<DerivedDisplayState, number> = {
  late: 0,
  upcoming: 1,
  waiting: 2,
  checked_in: 3,
  in_session: 4,
  running_over: 5,
  complete: 6,
  queued: 7,
  done: 8,
};

/** Sort sessions by priority, then by scheduled time. */
function sortSessions(sessions: EnrichedSession[]): EnrichedSession[] {
  return [...sessions].sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.derived_state] - PRIORITY_ORDER[b.derived_state];
    if (priorityDiff !== 0) return priorityDiff;
    // Within same priority, sort by scheduled time
    const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
    const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
    return aTime - bTime;
  });
}

/** Count sessions by derived state. */
function countSessions(sessions: EnrichedSession[]): RoomCounts {
  const counts: RoomCounts = {
    total: sessions.length,
    late: 0,
    upcoming: 0,
    waiting: 0,
    active: 0,
    complete: 0,
    done: 0,
  };

  for (const s of sessions) {
    switch (s.derived_state) {
      case 'late':
        counts.late++;
        break;
      case 'upcoming':
        counts.upcoming++;
        break;
      case 'waiting':
      case 'checked_in':
        counts.waiting++;
        break;
      case 'in_session':
      case 'running_over':
        counts.active++;
        break;
      case 'complete':
        counts.complete++;
        break;
      case 'done':
        counts.done++;
        break;
    }
  }

  return counts;
}

/** Group flat sessions into room groups. Rooms with no sessions are included if passed. */
export function groupSessionsByRoom(
  sessions: EnrichedSession[],
  rooms: Room[]
): RoomGroup[] {
  const roomMap = new Map<string, EnrichedSession[]>();

  // Initialize with all rooms
  for (const room of rooms) {
    roomMap.set(room.id, []);
  }

  // Distribute sessions
  for (const session of sessions) {
    if (session.room_id) {
      const existing = roomMap.get(session.room_id);
      if (existing) {
        existing.push(session);
      } else {
        roomMap.set(session.room_id, [session]);
      }
    }
  }

  // Build room groups
  const groups: RoomGroup[] = [];

  for (const room of rooms) {
    const roomSessions = roomMap.get(room.id) ?? [];
    const sorted = sortSessions(roomSessions);
    // Get clinician name from first session that has one
    const clinicianName = sorted.find((s) => s.clinician_name)?.clinician_name ?? null;

    groups.push({
      room_id: room.id,
      room_name: room.name,
      room_type: room.room_type,
      room_sort_order: room.sort_order,
      link_token: room.link_token,
      payments_enabled: room.payments_enabled,
      clinician_name: clinicianName,
      sessions: sorted,
      counts: countSessions(sorted),
    });
  }

  // Sort rooms by sort_order for stable positioning (spatial memory for receptionists)
  groups.sort((a, b) => a.room_sort_order - b.room_sort_order);

  return groups;
}

/** Calculate aggregate summary across all rooms. */
export function calculateSummary(groups: RoomGroup[]): RunsheetSummary {
  const summary: RunsheetSummary = {
    total: 0,
    late: 0,
    upcoming: 0,
    waiting: 0,
    active: 0,
    complete: 0,
    done: 0,
  };

  for (const group of groups) {
    summary.total += group.counts.total;
    summary.late += group.counts.late;
    summary.upcoming += group.counts.upcoming;
    summary.waiting += group.counts.waiting;
    summary.active += group.counts.active;
    summary.complete += group.counts.complete;
    summary.done += group.counts.done;
  }

  return summary;
}

/** Determine room expansion state based on session priorities. */
export type RoomExpansionState = 'collapsed' | 'auto-expanded' | 'fully-expanded';

export function getRoomExpansionState(sessions: EnrichedSession[]): RoomExpansionState {
  const hasAttention = sessions.some((s) => isAttentionState(s.derived_state));
  if (hasAttention) return 'auto-expanded';
  return 'collapsed';
}

/** Get the sessions that should be visible in auto-expanded mode. */
export function getAttentionSessions(sessions: EnrichedSession[]): EnrichedSession[] {
  return sessions.filter((s) => isAttentionState(s.derived_state));
}
