# Fix "Upcoming" and "Late" Derived States: Time-Based, Not Flag-Based

## Problem

The "upcoming" derived state currently triggers when `notification_sent` is true. But `notification_sent` tracks the **prep SMS** — a "get ready ahead of time" message sent hours before the appointment. This causes sessions to show as "upcoming" immediately after creation, even if the appointment is hours away.

Similarly, "late" currently checks if `now > scheduled_at`, which is correct but should be confirmed as the only condition.

Both states should be derived purely from the current time relative to the scheduled appointment time. No dependency on SMS flags or cron jobs.

### Current behavior
- Session created at 10am for 2:30pm → prep SMS fires → `notification_sent = true` → shows as **"upcoming"** 4.5 hours early
- Session at 2:30pm, current time is 2:35pm → shows as **"late"** (correct)

### Expected behavior
- Session created at 10am for 2:30pm → shows as **"queued"** until 2:20pm
- At 2:20pm (T-10 min) → shows as **"upcoming"** (patient should be joining soon)
- At 2:30pm → shows as **"late"** (past scheduled time, patient hasn't arrived)

## Approach

Derive both states from time only. No flags needed.

- **Upcoming**: session is queued, patient hasn't arrived, and `scheduled_at` is within the next 10 minutes (T-10 to T-0)
- **Late**: session is queued, patient hasn't arrived, and `now` is past `scheduled_at`
- **Queued**: everything else that's queued (more than 10 minutes away)

## Changes

### 1. Rewrite `isUpcoming()` to be time-based

**File:** `src/lib/runsheet/derived-state.ts`

Current:
```typescript
export function isUpcoming(session: RunsheetSession): boolean {
  return (
    session.status === 'queued' &&
    session.notification_sent &&
    !session.patient_arrived
  );
}
```

New:
```typescript
export function isUpcoming(session: RunsheetSession, now: Date): boolean {
  if (session.status !== 'queued' || session.patient_arrived || !session.scheduled_at) {
    return false;
  }
  const scheduledTime = new Date(session.scheduled_at);
  const minutesUntil = (scheduledTime.getTime() - now.getTime()) / 60_000;
  return minutesUntil > 0 && minutesUntil <= 10;
}
```

### 2. Confirm `isLate()` is correct

**File:** `src/lib/runsheet/derived-state.ts`

Current implementation already checks `now > scheduledTime && status === 'queued'`. This is correct. No change needed, but verify `patient_arrived` is also checked — a patient who arrived late shouldn't still show as "late".

Current:
```typescript
export function isLate(session: RunsheetSession, now: Date): boolean {
  if (!session.scheduled_at) return false;
  const scheduledTime = new Date(session.scheduled_at);
  return now > scheduledTime && session.status === 'queued';
}
```

This is fine — once the patient arrives the status moves from `queued` to `waiting`/`checked_in`, so the `status === 'queued'` check implicitly handles it.

### 3. Update `getDerivedState()` to pass `now` to `isUpcoming()`

**File:** `src/lib/runsheet/derived-state.ts`

Current:
```typescript
if (isLate(session, now)) return 'late';
if (isUpcoming(session)) return 'upcoming';
return 'queued';
```

New:
```typescript
if (isLate(session, now)) return 'late';
if (isUpcoming(session, now)) return 'upcoming';
return 'queued';
```

### 4. No type, query, or realtime changes needed

Since we're deriving from `scheduled_at` (already in the type and query) and `now` (passed in from the 30-second tick timer in `runsheet-shell.tsx`), no changes are needed to:
- `RunsheetSession` type
- `fetchRunsheetSessions()` query
- `useRealtimeRunsheet` hook
- Polling fallback API

## How the 30-second tick works

`runsheet-shell.tsx` already has a `now` state that ticks every 30 seconds:

```typescript
const [now, setNow] = useState(() => new Date());
useEffect(() => {
  const interval = setInterval(() => setNow(new Date()), 30_000);
  return () => clearInterval(interval);
}, []);
```

This `now` is passed to `enrichSessions(sessions, now)` which calls `getDerivedState()` for each session. So the upcoming/late transitions will happen automatically as time passes — a session will flip from "queued" to "upcoming" within 30 seconds of entering the T-10 window, and from "upcoming" to "late" within 30 seconds of passing the scheduled time.

## Files summary

| File | Change |
|------|--------|
| `src/lib/runsheet/derived-state.ts` | Rewrite `isUpcoming()` to be time-based (T-10 min window). Update `getDerivedState()` call to pass `now`. |

One file. That's it.
