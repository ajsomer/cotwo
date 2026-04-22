# Plan: Live readiness dashboard updates via Socket.IO

**Date:** 2026-04-20
**Status:** Proposed, not yet implemented
**Depends on:** Existing Socket.IO infra in `server.ts` and `src/lib/realtime/broadcast.ts` (see `docs/plans/socketio-migration.md`).

---

## Problem

The readiness dashboard re-fetches in only three situations:

1. Initial mount — fetch-if-empty in `readiness-shell.tsx` (`useEffect` checks `readinessLoadedPre/Post`).
2. Location switch — `clinic-data-provider.tsx` calls `refreshReadiness` after `resetLocationData`.
3. Manual — `handleSaved` after a slide-over panel closes (add patient, mark transcribed, task resolve).

Anything that flips a readiness-relevant DB row from outside the current tab is invisible until the user reloads or switches location. Concretely: when the patient completes their intake package on their phone, the receptionist's readiness dashboard does not move the row from "Overdue" / "In progress" into the "Form Completed" slot until the page is reloaded.

The same gap exists for any other path that mutates `appointment_actions` or `intake_package_journeys` server-side without the receptionist having an open panel — e.g. a workflow action firing on its scheduled tick, a patient submitting a deliver_form, an `add_to_runsheet` materialising into a session.

The original intake-package handoff plan claimed Realtime would handle this via the `intake_package_journeys` publication added in migration 014, but no client subscribes to that publication. The project's live-update transport is Socket.IO, not Supabase Realtime (see `docs/plans/socketio-migration.md`).

## Non-goals

- **Not migrating to Supabase Realtime.** Socket.IO is the established transport and there's no reason to add a second one.
- **Not adding per-row deltas.** The readiness fetcher is one query that joins many tables; trying to apply granular row-level patches client-side would re-derive priority from a partial view of the world. A single `readiness_changed` ping that triggers `refreshReadiness(locationId)` is consistent with how `session_changed` already works for the run sheet.
- **Not adding new room types.** Readiness is location-scoped and so is the existing `location:{id}` Socket.IO room. Reuse it.
- **Not adding payload-based filtering on the client.** Every connected staff client at that location refetches on the ping; the server-side fetcher decides what they're allowed to see. Same model as `session_changed`.
- **Not retrofitting every workflow handler in this plan.** This plan covers the immediate gap (intake completion + the new handoff endpoints + task resolution). The pattern is identical for future write paths (workflow engine tick, deliver_form submissions); they can adopt `broadcastReadinessChange` as they're touched.

---

## Design

### Event contract

Add one new server → client event on the existing `location:{id}` room:

| Event | Direction | Payload |
|---|---|---|
| `readiness_changed` | server → client | `{ event: 'package_completed' \| 'package_transcribed' \| 'action_resolved' \| 'action_updated', appointment_id?: string }` |

The `event` discriminator and `appointment_id` are informational only — the client refetches the whole readiness slice regardless. They exist so server logs and (eventually) granular client patches stay debuggable without a contract change.

### Broadcast helper

Extend `src/lib/realtime/broadcast.ts` with a sibling of `broadcastSessionChange`:

```ts
export type ReadinessChangeEvent =
  | "package_completed"
  | "package_transcribed"
  | "action_resolved"
  | "action_updated";

export async function broadcastReadinessChange(
  locationId: string,
  event: ReadinessChangeEvent,
  payload: Record<string, unknown> = {}
): Promise<void> {
  await publish(`location:${locationId}`, "readiness_changed", { event, ...payload });
}
```

Same loopback-POST shape as the existing helpers — no new server-side wiring needed; `server.ts`'s `/_internal/broadcast` interceptor already routes any room/event pair.

### Client subscription

Add a single listener in `src/components/clinic/clinic-data-provider.tsx`, alongside the existing `session_changed` and `presence:update` handlers. Same pattern: on event, look up the current `locationId` from the store and call `refreshReadiness`.

```ts
const onReadinessChanged = () => {
  const currentLocId = getClinicStore().locationId;
  if (currentLocId) {
    void getClinicStore().refreshReadiness(currentLocId);
  }
};
socket.on("readiness_changed", onReadinessChanged);
// ...and `socket.off("readiness_changed", onReadinessChanged)` in cleanup
```

Also add a resync-on-reconnect call inside the existing `onConnect` handler:

```ts
const onConnect = () => {
  socket.emit("join:location", locationId);
  void getClinicStore().refreshSessions(locationId);
  void getClinicStore().refreshReadiness(locationId); // new
};
```

This matches the run sheet's reconnect resync behaviour. If readiness changed while the socket was down, the client picks it up on reconnect rather than waiting for the next ping.

### Where to emit

Three immediate write paths. All resolve `location_id` from the appointment row before broadcasting (the journey table doesn't carry location, but `appointments.location_id` does).

#### 1. `src/app/api/intake/[token]/complete-item/route.ts`

This is the path the user just hit. The patient completes the last item, `isJourneyComplete` flips true, status moves to `'completed'`, and the intake_package action is marked completed. Both the journey transition and the action transition are readiness-relevant.

Emit **after** `markIntakeActionCompleted` resolves, before returning the response. Look up the location once per request:

```ts
if (allDone) {
  await supabase.from('intake_package_journeys').update(...).eq('id', journey.id);
  await markIntakeActionCompleted(supabase, journey.appointment_id);

  // Notify the readiness dashboard
  const { data: appt } = await supabase
    .from('appointments')
    .select('location_id')
    .eq('id', journey.appointment_id)
    .maybeSingle();
  if (appt?.location_id) {
    await broadcastReadinessChange(appt.location_id, 'package_completed', {
      appointment_id: journey.appointment_id,
    });
  }
}
```

Edge case: a patient completing a non-final item also changes the package_completed/total counts the dashboard shows in a row's progress meter (if any future UI surfaces that). For v1 we only emit on the terminal transition (`allDone === true`), to avoid a thundering herd of refetches as a patient ticks through 5 forms back-to-back. If we want intermediate updates later, add a second emit inside the non-terminal branch with a debounce on the client.

#### 2. `src/app/api/readiness/mark-intake-transcribed/route.ts`

The receptionist marking transcribed in tab A should drop the row out of the Form Completed slot in tab B (e.g. another receptionist on a second monitor). Currently `handleSaved` only refetches the originating tab.

Emit after the `update({ transcribed_at })` succeeds, look up the location the same way:

```ts
const { data: appt } = await supabase
  .from('appointments')
  .select('location_id')
  .eq('id', appointment_id)
  .maybeSingle();
if (appt?.location_id) {
  await broadcastReadinessChange(appt.location_id, 'package_transcribed', {
    appointment_id,
  });
}
```

#### 3. `src/lib/runsheet/actions.ts` — `resolveTask`

Same gap as transcribed: resolving a post-appointment task in tab A leaves tab B's readiness dashboard showing the task as still overdue. Look up the appointment + location from the action row:

```ts
const { data: action } = await supabase
  .from('appointment_actions')
  .select('appointment_id')
  .eq('id', actionId)
  .maybeSingle();
if (action?.appointment_id) {
  const { data: appt } = await supabase
    .from('appointments')
    .select('location_id')
    .eq('id', action.appointment_id)
    .maybeSingle();
  if (appt?.location_id) {
    await broadcastReadinessChange(appt.location_id, 'action_resolved', {
      appointment_id: action.appointment_id,
    });
  }
}
```

This belongs adjacent to the existing `update` call, after success.

### Why not also the legacy `mark-transcribed` route?

`src/app/api/readiness/mark-transcribed/route.ts` (the deliver_form path) has the same gap. It's worth adding the same emit there — same shape as #2, just look up location via the action's `appointment_id`. Including it in this plan because it's a one-line addition that keeps the two transcription paths consistent.

### Ordering relative to the user-side optimistic refresh

After this plan lands, `handleSaved` in `readiness-shell.tsx` still calls `refreshReadiness` on panel close. That's fine — it's a redundant refetch in the originating tab (one already fired via the `readiness_changed` listener after the broadcast loops back) but it's also the optimistic path for the interactive client and shouldn't depend on the broadcast loop completing. Leave it.

---

## Implementation checklist

1. [ ] Extend `src/lib/realtime/broadcast.ts` — add `ReadinessChangeEvent` type and `broadcastReadinessChange` function, mirroring `broadcastSessionChange` shape.
2. [ ] `src/components/clinic/clinic-data-provider.tsx` — register `socket.on("readiness_changed", onReadinessChanged)` alongside the existing `session_changed` listener; add cleanup; call `refreshReadiness` inside the existing `onConnect` resync.
3. [ ] `src/app/api/intake/[token]/complete-item/route.ts` — after the `allDone` branch finishes, look up `appointments.location_id` and call `broadcastReadinessChange(locationId, 'package_completed', { appointment_id })`.
4. [ ] `src/app/api/readiness/mark-intake-transcribed/route.ts` — after the update succeeds, look up `appointments.location_id` and call `broadcastReadinessChange(locationId, 'package_transcribed', { appointment_id })`.
5. [ ] `src/lib/runsheet/actions.ts` — inside `resolveTask`, after the update succeeds, resolve the appointment + location and call `broadcastReadinessChange(locationId, 'action_resolved', { appointment_id })`.
6. [ ] `src/app/api/readiness/mark-transcribed/route.ts` (legacy deliver_form path) — same emit shape as #4 with `event: 'action_resolved'`. Keeps both transcription paths consistent.
7. [ ] Verify: open `/readiness` in tab A, complete intake on patient phone in tab B → tab A's row drops out of "In progress" / "Overdue" and lands in "Form Completed" within ~1s, no manual refresh.
8. [ ] Verify: open `/readiness` in two clinic tabs, mark transcribed in tab A → row drops out of "Form Completed" in tab B within ~1s.
9. [ ] Verify: open `/readiness` in two clinic tabs, resolve a post-appointment task in tab A → row updates in tab B within ~1s.
10. [ ] Verify reconnect resync: with `/readiness` open, toggle network off for 10s, complete intake on patient phone, network back on → readiness updates after reconnect.
11. [ ] `npm run build` and `npm run lint` clean.

## Files to touch

**New:** none.

**Modified:**
- `src/lib/realtime/broadcast.ts`
- `src/components/clinic/clinic-data-provider.tsx`
- `src/app/api/intake/[token]/complete-item/route.ts`
- `src/app/api/readiness/mark-intake-transcribed/route.ts`
- `src/app/api/readiness/mark-transcribed/route.ts`
- `src/lib/runsheet/actions.ts`

**Unchanged (explicit):**
- `server.ts` — `/_internal/broadcast` already routes any (room, event) pair; no new server-side handler.
- `src/components/clinic/readiness-shell.tsx` — `handleSaved` keeps its existing optimistic refresh; the new listener is in the data provider, not the shell.
- `src/stores/clinic-store.ts` — `refreshReadiness` is the existing entry point; no new store action.

## Risks and mitigations

- **Refetch storms.** A patient completing 5 forms in 30 seconds would only emit once (terminal `allDone` branch). A receptionist mass-resolving 20 tasks would emit 20 times. Each emit triggers a full readiness slice refetch on every connected staff tab. At prototype scale (few staff, few rooms, sub-second queries) this is fine. If it becomes a problem, debounce the listener with a 250ms trailing timer — same pattern as run sheet would adopt.
- **Cross-direction emits.** A pre-appointment write should still refresh a tab viewing post-appointment readiness (and vice versa) because `refreshReadiness` fetches both slices. Confirmed by reading the existing `refreshReadiness` action in `clinic-store.ts` — no per-direction filtering on the broadcast side.
- **Missed events while disconnected.** Mitigated by the reconnect resync added to `onConnect`. Same model as the run sheet's `refreshSessions` resync.
- **Location lookup adds a query per write.** One additional indexed `appointments.id → location_id` lookup per write path is negligible. Could be elided by passing `location_id` through from a single earlier query in some paths (e.g. the journey already knows the appointment_id; we could include the join in the existing `select`). Not worth the readability cost in this plan; revisit if it shows up in profiling.

## Estimated time

- Helper + listener wiring: 15 min
- Three write-path emits: 20 min
- Verification across the three flows: 20 min

**Total: ~1 hour.**
