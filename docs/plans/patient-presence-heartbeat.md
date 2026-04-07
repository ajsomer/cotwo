# Patient Presence Tracking

## Problem

When a patient is in the waiting room (`waiting` or `in_session` status), there's no way to know if they're still connected. If they close the tab, lose signal, or their phone locks, the run sheet still shows them as waiting. The clinician goes to admit them and nobody's there.

## Approach

Track connection state as a **visual overlay**, not a status change. The session lifecycle stays untouched — `waiting` means arrived, `in_session` means admitted. Connection state is derived in real-time from Supabase Presence — instant join/leave detection, no schema changes, no polling.

## No Schema Change

Presence is purely client-side state held by Supabase Realtime. Nothing stored in the database.

## Supabase Presence

### How it works

Supabase Realtime channels support [Presence](https://supabase.com/docs/guides/realtime/presence) — a built-in mechanism for tracking who's connected to a channel. Each client calls `channel.track()` with arbitrary state. When they disconnect (tab close, network drop, phone lock), Supabase fires a `leave` event to all other subscribers. Detection is near-instant (1-2 seconds).

### Patient side (waiting room)

The waiting room already subscribes to `waiting:{sessionId}` for status updates. We switch to a shared location-wide presence channel so the run sheet can see all connected patients in one subscription:

```typescript
const channel = supabase.channel(`presence:location:${locationId}`)
  .on('postgres_changes', { ... }, handleStatusChange)  // existing session updates
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        session_id: sessionId,
        connected_at: new Date().toISOString(),
      });
    }
  });
```

When the patient closes the tab or loses connection, Supabase automatically fires a `leave` event. No explicit untrack needed.

`document.visibilityState`: When the tab is backgrounded (phone lock, tab switch), the browser may throttle or kill the WebSocket. This is fine — it naturally triggers a `leave` event, which is the correct behaviour since a backgrounded patient can't respond to admission.

### Clinic side (run sheet)

The run sheet subscribes to the same location-wide presence channel:

```typescript
// New hook: usePatientPresence
const presenceChannel = supabase.channel(`presence:location:${locationId}`)
  .on('presence', { event: 'sync' }, () => {
    const state = presenceChannel.presenceState();
    setConnectedSessions(new Set(Object.keys(state)));
  })
  .on('presence', { event: 'join' }, ({ key }) => {
    setConnectedSessions(prev => new Set([...prev, key]));
  })
  .on('presence', { event: 'leave' }, ({ key }) => {
    setConnectedSessions(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  })
  .subscribe();
```

The `connectedSessions` set is checked during session enrichment:

```typescript
patient_disconnected:
  (session.status === 'waiting' || session.status === 'in_session')
  && session.patient_arrived
  && !connectedSessions.has(session.session_id)
```

Detection is instant — no polling, no tick delay.

### Channel topology

```
Patient A (waiting)    ──track──►  presence:location:{locationId}  ◄──subscribe──  Run sheet
Patient B (waiting)    ──track──►
Patient C (in_session) ──track──►
```

All patients at a location share one presence channel. The run sheet gets a unified view. Each patient's presence key is their `session_id`.

## Run Sheet Visual Treatment

### Session row

When `patient_disconnected` is true, show a small wifi-off icon next to the status badge. Same row layout, no colour change to the badge — it's supplementary info, not a status override.

```
┌──────────┬───────────────────────────────────────────────────────┐
│  9:30 AM │  Emily Chen  💳  ● Waiting  ⚠  ·  Initial Consult   │
└──────────┴───────────────────────────────────────────────────────┘
                                          ^ wifi-off icon
                                            tooltip: "Patient disconnected"
```

When the patient reconnects (Presence `join` fires), the icon disappears instantly.

### No impact on:
- Room expansion/collapse priority
- Summary bar counts
- Bulk actions
- Background notifications
- Session status transitions

## Re-Entry

The patient's SMS link still works. `entry-flow.tsx` already checks if the session is `waiting` or `in_session` and redirects straight to the waiting room (lines 145-149). No new OTP required. Presence tracking resumes automatically on reconnect.

## Wiring `locationId` to the Waiting Room

`WaitingRoomProps` doesn't currently accept `locationId`. The waiting room page (`src/app/(patient)/waiting/[token]/page.tsx`) already resolves it via the `rooms → locations` join (line 44) but doesn't pass it down. Fix: add `locationId` to the props and pass `location.id` from the page.

## Files to Change

| File | Change |
|------|--------|
| `src/app/(patient)/waiting/[token]/page.tsx` | Pass `locationId={location.id}` to `WaitingRoomClient` |
| `src/components/patient/waiting-room.tsx` | Accept `locationId` prop, track presence on `presence:location:{locationId}` channel |
| `src/hooks/usePatientPresence.ts` | **New** — subscribe to location presence channel, expose `connectedSessions` set |
| `src/lib/supabase/types.ts` | Add `patient_disconnected` to `EnrichedSession` |
| `src/lib/runsheet/derived-state.ts` | Accept optional `connectedSessions` param, calculate `patient_disconnected` (default `false` when param omitted) |
| `src/components/clinic/runsheet-shell.tsx` | Wire up `usePatientPresence`, pass to enrichment |
| `src/components/clinic/session-row.tsx` | Show disconnect icon when `patient_disconnected` is true |

## Not in Scope

- Auto-nudge on disconnect (future — receptionist decides manually for now)
- Auto-cancel after timeout (too aggressive for a prototype)
- "Patient reconnected" toast notification (nice-to-have, not essential)
- Presence during `in_session` for video call state (LiveKit handles this separately)
- Database-backed fallback (`last_seen_at` heartbeat) — can add for production if needed
