# Patient Presence Tracking via Supabase Presence

**Date:** 2026-04-07

## What changed

### Problem
When a patient is in the waiting room, there's no way to know if they're still connected. If they close the tab, lose signal, or their phone locks, the run sheet still shows them as waiting. The clinician admits them and nobody's there.

### Solution
Track patient connection state as a visual overlay using Supabase Presence — no schema changes, no polling, no new API endpoints. Detection is near-instant (1-2 seconds).

### Patient side — presence tracking in waiting room
The waiting room component previously subscribed to a per-session channel (`waiting:{sessionId}`). This was replaced with a location-wide presence channel (`presence:location:{locationId}`) so the clinic-side run sheet can see all connected patients in a single subscription.

On subscribe, the patient calls `channel.track()` with their `session_id`. When they disconnect (tab close, network drop, phone lock), Supabase fires a `leave` event automatically. The existing `postgres_changes` subscription for session status updates was moved to the new channel.

The `locationId` prop was threaded through from the server page component (which already resolved it via the rooms → locations join) through `WaitingRoomClient` down to `WaitingRoom`.

### Clinic side — usePatientPresence hook
New hook subscribes to the same `presence:location:{locationId}` channel and listens for `sync`, `join`, and `leave` events. Exposes a `Set<string>` of connected session IDs. Cleans up on unmount and when `locationId` changes.

The `enrichSessions` function in `derived-state.ts` now accepts an optional `connectedSessions` parameter. When provided, it calculates `patient_disconnected: true` for sessions where:
- Stored status is `waiting` or `in_session` (covers derived states `waiting`, `in_session`, and `running_over`)
- `patient_arrived` is true
- Session ID is NOT in the connected set

When `connectedSessions` is omitted, `patient_disconnected` defaults to `false` — existing callsites are unaffected.

### Run sheet visual treatment
A WifiOff icon (lucide-react, 14px, `text-amber-500`) appears next to the status badge with a "Patient disconnected" tooltip. When the patient reconnects, the icon disappears instantly. No impact on room expansion priority, summary bar counts, bulk actions, or session status transitions.

## Files changed

| File | Change |
|------|--------|
| `src/app/(patient)/waiting/[token]/page.tsx` | Pass `locationId` to `WaitingRoomClient` |
| `src/app/(patient)/waiting/[token]/waiting-room-client.tsx` | Accept and forward `locationId` prop |
| `src/components/patient/waiting-room.tsx` | Switch to location-wide presence channel, call `channel.track()` on subscribe |
| `src/hooks/usePatientPresence.ts` | **New** — subscribe to presence channel, expose connected session IDs |
| `src/lib/supabase/types.ts` | Add `patient_disconnected` to `EnrichedSession` |
| `src/lib/runsheet/derived-state.ts` | Accept optional `connectedSessions` in `enrichSession`/`enrichSessions` |
| `src/components/clinic/runsheet-shell.tsx` | Wire `usePatientPresence`, pass to `enrichSessions` |
| `src/components/clinic/session-row.tsx` | Render WifiOff icon when `patient_disconnected` is true |

## Design decisions

- **Location-wide channel, not per-session:** A single presence channel per location means the run sheet needs only one subscription to see all connected patients. Per-session channels would require N subscriptions on the clinic side.
- **Visual overlay, not status change:** Connection state doesn't modify the session lifecycle. `waiting` still means arrived. The disconnect icon is supplementary — a clinician can still admit a disconnected patient if they choose.
- **Optional connectedSessions parameter:** Keeps enrichment backward-compatible. Tests and other callsites that don't care about presence still work without changes.
- **No fallback polling:** The previous TODO for a polling fallback was removed. Supabase Presence handles reconnection natively. A database-backed `last_seen_at` heartbeat can be added later for production if needed.

## What's next

- Consider a "Patient reconnected" toast notification
- Consider auto-nudge SMS on prolonged disconnect
- Database-backed fallback (`last_seen_at` heartbeat) for production resilience
