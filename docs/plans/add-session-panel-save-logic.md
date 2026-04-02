# Add Session Panel: Save Logic Fix

## Problem

The add-session panel now shows existing sessions when opened (correct), but `handleSave()` treats every row as a new session and calls `createSessions()` for all of them. Changing a patient's time and saving creates a duplicate instead of updating the existing session.

## Root Cause

The panel has no concept of "existing" vs "new" rows. Every row in `roomStates` is a `PatientRow` with `{ id, phone, time }`. When the panel is initialized from the run sheet, the `id` is the real session ID. When a row is added via "+ Add patient", the `id` is a fresh `crypto.randomUUID()`. But `handleSave()` doesn't check this — it sends everything to `createSessions()`.

## Fix

### 1. Track existing session IDs on initialization

Capture the set of session IDs that came from the run sheet when the panel mounts. These are the rows that already exist in the database.

```typescript
const [existingSessionIds] = useState<Set<string>>(() => {
  const ids = new Set<string>();
  for (const s of sessions) {
    if (s.derived_state !== "done") ids.add(s.session_id);
  }
  return ids;
});
```

### 2. Snapshot original values for change detection

Store the original phone and time for each existing session so we can tell if the receptionist actually changed anything.

```typescript
const [originalValues] = useState<Map<string, { phone: string; time: string }>>(() => {
  const map = new Map();
  for (const s of sessions) {
    if (s.derived_state === "done") continue;
    map.set(s.session_id, {
      phone: s.phone_number ?? "",
      time: s.scheduled_at
        ? new Date(s.scheduled_at).toLocaleTimeString("en-AU", {
            hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
          })
        : "",
    });
  }
  return map;
});
```

### 3. Split handleSave into three paths

On save, categorize each row:

| Row type | How to identify | Action |
|----------|----------------|--------|
| **Existing, unchanged** | `existingSessionIds.has(id)` and phone + time match `originalValues` | Skip |
| **Existing, changed** | `existingSessionIds.has(id)` and phone or time differs from `originalValues` | Call `updateSession()` |
| **New** | `!existingSessionIds.has(id)` | Call `createSessions()` |

```typescript
async function handleSave() {
  setSaving(true);

  const newInputs = [];
  const updates = [];

  for (const [roomId, state] of Object.entries(roomStates)) {
    if (!state.active) continue;
    for (const patient of state.patients) {
      if (!patient.phone || patient.phone.length <= 3 || !patient.time) continue;

      const [hours, minutes] = patient.time.split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) continue;
      const scheduledDate = new Date(targetDate);
      scheduledDate.setHours(hours, minutes, 0, 0);

      if (existingSessionIds.has(patient.id)) {
        const original = originalValues.get(patient.id);
        if (original && (original.phone !== patient.phone || original.time !== patient.time)) {
          updates.push({
            sessionId: patient.id,
            phone_number: patient.phone,
            scheduled_at: scheduledDate.toISOString(),
          });
        }
        // unchanged → skip
      } else {
        newInputs.push({
          phone_number: patient.phone,
          scheduled_at: scheduledDate.toISOString(),
          room_id: roomId,
        });
      }
    }
  }

  // Create new sessions
  if (newInputs.length > 0 && org) {
    const result = await createSessions(locationId, org.id, org.name, newInputs);
    // log entry links...
  }

  // Update changed existing sessions
  for (const u of updates) {
    await updateSession(u.sessionId, {
      phone_number: u.phone_number,
      scheduled_at: u.scheduled_at,
    });
  }

  await onRefetch?.();
  setSaving(false);
  onClose();
}
```

### 4. Verify updateSession mutation

Check that `updateSession()` in `src/lib/runsheet/mutations.ts` correctly updates both `appointments.scheduled_at` and `appointments.phone_number`. It currently does (lines 137-169), updating via the appointment linked to the session.

## Files

| File | Change |
|------|--------|
| `src/components/clinic/add-session-panel.tsx` | Add `existingSessionIds`, `originalValues` state. Rewrite `handleSave()` to split new vs update vs skip. |
| `src/lib/runsheet/mutations.ts` | No changes needed — `updateSession()` already handles phone and scheduled_at. |

## What this doesn't change

- Delete flow stays the same (already works via `handleDeleteSession`)
- Panel initialization stays the same (already shows existing sessions)
- New row creation via "+ Add patient" stays the same
- Entry link logging only fires for new sessions, not updates
