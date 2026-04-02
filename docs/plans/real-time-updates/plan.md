# Real-Time Run Sheet Updates

## Current State

The run sheet has a realtime subscription on the `sessions` table via Supabase Realtime (`useRealtimeRunsheet`). It partially works:

**Working:**
- UPDATE events on existing sessions (status changes, arrival, video call start)
- DELETE events remove sessions
- Polling fallback every 30s when realtime disconnects

**Broken:**
- **New sessions don't appear.** INSERT events are detected but the handler returns early without adding them (the session payload from Supabase doesn't include joined data like patient name, room, appointment type — just the flat `sessions` row). The comment says "trigger a full refetch" but no refetch happens.
- **Appointment changes don't broadcast.** The `appointments` table isn't in the Supabase realtime publication. Edits to `scheduled_at` or `phone_number` via `updateSession()` are invisible until a full page refresh.
- **Patient data changes don't propagate.** When a patient completes the entry flow (identity confirmation links their name to the session via `session_participants`), the run sheet still shows "Unknown patient" because the realtime subscription only watches `sessions`, not `session_participants` or `patients`.
- **No optimistic updates.** After creating/deleting a session, the UI waits for realtime or polling — no immediate feedback.

---

## Problem 1: "Unknown Patient" → Show Phone Number

When a session is created via the add-session panel, no patient identity exists yet. The patient hasn't entered the flow. Currently this shows "Unknown patient" which is unhelpful — the receptionist entered a phone number and wants to see it.

### Fix

Change `formatPatientName()` in `src/lib/runsheet/format.ts` to accept the phone number as a fallback:

```typescript
export function formatPatientName(
  firstName: string | null,
  lastName: string | null,
  phoneNumber?: string | null
): string {
  if (firstName || lastName) {
    return [firstName, lastName].filter(Boolean).join(' ');
  }
  if (phoneNumber) {
    return formatPhoneNumber(phoneNumber) ?? phoneNumber;
  }
  return 'Unknown patient';
}
```

Update the call site in `session-row.tsx` to pass `session.phone_number`.

When the patient later completes identity confirmation (Step 2 of the entry flow), their name gets linked via `session_participants`. The next realtime update or poll replaces the phone number with the actual name.

---

## Problem 2: New Sessions Don't Appear (INSERT)

The realtime INSERT payload only contains the flat `sessions` row — no joins. We can't build a full `RunsheetSession` from it. Two approaches:

### Option A: Refetch on INSERT (recommended)

When we receive an INSERT event for our location, trigger a full refetch of the run sheet data via the existing `/api/runsheet` endpoint. This is simple, correct, and the cost is one API call per new session.

```typescript
// In useRealtimeRunsheet.ts, on INSERT:
if (idx === -1 && payload.eventType === "INSERT") {
  // Refetch all sessions for this location
  const res = await fetch(`/api/runsheet?locationId=${locationId}&_t=${Date.now()}`);
  if (res.ok) {
    const data = await res.json();
    setSessions(data.sessions);
  }
  return prev; // return current state; setSessions above handles the update
}
```

### Option B: Optimistic insert + backfill

Add the session immediately with partial data (phone number, room_id, status) and backfill the rest on the next poll. More complex, marginal benefit.

**Recommendation:** Option A. One extra fetch per new session is negligible. Keeps the code simple.

---

## Problem 3: Appointment/Patient Changes Don't Propagate

### Add `appointments` to realtime publication

Migration:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
```

### Subscribe to multiple tables

Extend the realtime subscription to listen for changes on `appointments`, `session_participants`, and `sessions`. On any change to these tables for our location, refetch.

Alternatively, keep it simpler: **any INSERT/UPDATE/DELETE on `session_participants` triggers a refetch** (same as Problem 2). This handles the case where a patient completes identity confirmation and their name appears.

```typescript
// Add a second subscription in useRealtimeRunsheet:
supabase
  .channel(`runsheet-participants:${locationId}`)
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "session_participants",
    },
    () => {
      // Refetch — a patient was linked/unlinked
      refetch();
    }
  )
  .subscribe();
```

The `session_participants` table is already in the realtime publication (migration 001).

---

## Problem 4: Optimistic Updates After Mutations

When the receptionist creates a session via the add-session panel, the panel closes and… nothing visibly changes until realtime fires or polling runs. This feels broken.

### Fix: Trigger refetch after mutation

The simplest approach: after `createSessions()` or `deleteSession()` completes, call `router.refresh()` to re-run the server component and get fresh `initialSessions`. Or expose a `refetch()` function from the realtime hook.

```typescript
// In useRealtimeRunsheet.ts, expose refetch:
const refetch = useCallback(async () => {
  const res = await fetch(`/api/runsheet?locationId=${locationId}&_t=${Date.now()}`);
  if (res.ok) {
    const data = await res.json();
    setSessions(data.sessions);
  }
}, [locationId]);

return { sessions, connectionStatus, refetch };
```

Then in `runsheet-shell.tsx`, call `refetch()` after save/delete actions complete.

---

## Problem 5: Add Session Panel Doesn't Show Existing Sessions

When the receptionist clicks **"+ Add session"**, the panel opens with all rooms empty — no existing sessions visible. But when they click a **session row** on the run sheet, the panel opens showing all sessions in that room. This is because the panel initialization logic (`add-session-panel.tsx`, lines 61-95) branches on `editingSessionId`:

- `editingSessionId` is set (clicked a row) → populates rooms with existing sessions
- `editingSessionId` is null ("+ Add session") → initializes all rooms as empty

This is wrong. The panel should **always** show existing sessions regardless of how it was opened. The receptionist needs to see the current state of each room to decide where to add a new patient.

### Fix

Remove the `editingSessionId` branch from initialization. Always populate rooms with existing sessions:

```typescript
const [roomStates, setRoomStates] = useState<Record<string, RoomState>>(() => {
  const initial: Record<string, RoomState> = {};
  for (const room of rooms) {
    const roomSessions = sessions.filter(
      (s) => s.room_id === room.id && s.derived_state !== "done"
    );
    initial[room.id] = {
      active: roomSessions.length > 0,
      patients: roomSessions.map((s) => ({
        id: s.session_id,
        phone: s.phone_number ?? "",
        time: s.scheduled_at
          ? new Date(s.scheduled_at).toLocaleTimeString("en-AU", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: timezone,
            })
          : "",
      })),
    };
  }
  return initial;
});
```

The `editingSessionId` prop can then be used solely to scroll-to or highlight a specific session row within the panel, not to control data population.

---

## Problem 6: Deleting a Session Doesn't Remove It From the Run Sheet

When the receptionist deletes a session from the add-session panel, `deleteSession()` runs on the server and the row disappears from the panel (via `removePatientRow`). But the session remains visible on the run sheet behind the panel until the next polling cycle or page refresh.

This is the same root cause as Problem 4 — mutations don't trigger a client-side state update.

### Fix

Same solution as Problem 4: call `refetch()` after `deleteSession()` completes. The `handleDeleteSession` function in the add-session panel needs access to the refetch callback.

Pass `onRefetch` as a prop from `runsheet-shell.tsx` to the panel:

```typescript
// In add-session-panel.tsx:
async function handleDeleteSession(sessionId: string, roomId: string) {
  if (!confirm("Delete this session?...")) return;
  await deleteSession(sessionId);
  removePatientRow(roomId, sessionId);
  onRefetch(); // refresh the run sheet behind the panel
}
```

This means Problems 4, 5, and 6 all depend on the `refetch()` function from Step 3. Once that's wired up, all three are solved.

---

## Implementation Order

| Step | What | Files |
|------|------|-------|
| 1 | Show phone number instead of "Unknown patient" | `src/lib/runsheet/format.ts`, `src/components/clinic/session-row.tsx` |
| 2 | Refetch on INSERT (new sessions appear immediately) | `src/hooks/useRealtimeRunsheet.ts` |
| 3 | Expose `refetch()` and call it after mutations | `src/hooks/useRealtimeRunsheet.ts`, `src/components/clinic/runsheet-shell.tsx` |
| 4 | Add session panel always shows existing sessions | `src/components/clinic/add-session-panel.tsx` |
| 5 | Delete from panel triggers run sheet refetch | `src/components/clinic/add-session-panel.tsx`, `src/components/clinic/runsheet-shell.tsx` |
| 6 | Subscribe to `session_participants` changes (patient name appears after identity step) | `src/hooks/useRealtimeRunsheet.ts` |
| 7 | Add `appointments` to realtime publication (schedule changes propagate) | New migration |

Steps 1–5 solve the immediate UX issues (receptionist workflow). Steps 6–7 complete the real-time story for the patient entry flow.

---

## What We're NOT Doing

- **No WebSocket server.** Supabase Realtime handles the WebSocket layer. We're just fixing how we use it.
- **No optimistic UI with rollback.** Too complex for the prototype. Refetch-on-mutation is good enough.
- **No per-field granular subscriptions.** Refetch-on-change is simpler and correct. The run sheet query is fast (~1-2s).
- **No cross-location realtime.** Background notifications for other locations already subscribe separately. This plan only covers the active run sheet view.
