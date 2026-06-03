# On-Demand Room Link: Appointment Matching by Phone

## Problem

When a patient joins via a **generic room link** (`rooms.link_token`, e.g. "Dr Smith's Room" on-demand link), the entry flow resolves the token → room → runs them through phone OTP and identity, then `/api/patient/arrive` **always creates a brand-new on-demand session** with no `appointment_id`.

This is wrong when that same patient already has a scheduled appointment today in that room. They tap the room's link (instead of, or as well as, their SMS link), and instead of landing in their booked session — the one the clinician expects on the run sheet — a parallel on-demand session appears. The receptionist now sees a duplicate, and the patient's real appointment row stays stuck as "queued / late".

The token resolution and OTP/identity flow already work for on-demand entries (`src/app/(patient)/entry/[token]/page.tsx` — case 2, `resolveEntryTokenScope` returns `roomId` set, `sessionId: null`). The arrival/matching step is the gap.

This mirrors `qr-checkin-appointment-matching.md`, but for the telehealth on-demand room link rather than the in-person location QR.

## Goals

1. When a patient arrives via a generic room link and has a scheduled appointment **today in that same room** matching their phone, map them onto that appointment's session instead of creating an on-demand one.
2. If the appointment's session already exists (morning scan spawned it), reuse it. If it doesn't yet, create a session carrying the `appointment_id` and the appointment's room.
3. If no appointment matches, fall through to the existing on-demand behaviour unchanged.
4. Keep the match fully server-derived (no client-supplied phone). Scope strictly to the link's room.

## Non-goals

- Cross-room routing. A patient with an appointment in a *different* room who taps Dr Smith's link is **not** pulled across rooms — they become an on-demand session in Dr Smith's room, as today. The link's room is authoritative. (This is the deliberate decision from scoping: "specific against the room the person has the appointment booked for.")
- Changing SMS-link entry (already session-bound) or QR entry (covered by `qr-checkin-appointment-matching.md`).
- PMS write-back.
- Any schema or migration change. (The waiting-room fix in §3 is a `select` column + a prop — no DB change.)
- Broad waiting-room redesign — §3 only adds an initial-status prop so a reused non-`waiting` session renders correctly.

## Match rules (from scoping)

- **Scope:** appointments at `scope.locationId`, in `scope.roomId` (the link's room), `scheduled_at` within today's local-day bounds (clinic timezone), `status NOT IN ('cancelled', 'completed', 'no_show')` (exclude all terminal statuses, not just cancelled).
- **Phone match (shared-phone-safe):**
  - the appointment is already linked to the confirmed patient (`appointments.patient_id = body.patient_id`), **OR**
  - the appointment is **unlinked** and its raw phone matches: `appointments.patient_id IS NULL AND appointments.phone_number IN (the patient's phone numbers)`. The `patient_id IS NULL` constraint is load-bearing — it prevents a shared phone from matching an appointment already linked to a *different* patient (covers PMS-synced appointments that carry only a phone and no linked patient yet).
- **Multiple matches:** earliest by `scheduled_at` ascending (earliest upcoming wins).
- **No match:** create a plain on-demand session (current behaviour, unchanged).
- **Modality:** on-demand room links are telehealth-only by tier, so no modality filter is needed here.

Why derive the phone server-side rather than trust the client: patients aren't authenticated, so the only trustworthy inputs are the entry token (→ room/location/org) and the `patient_id`, which is already validated against the token's org (`assertPatientInOrg`). The confirmed `patient_id` gives us the verified phone numbers; we never accept a phone from the request body.

## Approach

All changes live in `/api/patient/arrive`, inside the existing on-demand branch (`!sessionId && scope.roomId`). No client/API contract change — the entry flow already sends `token` + `patient_id`. Before creating an on-demand session, attempt a match; on hit, reuse/create the appointment-linked session; on miss, fall through.

Extract the match into a small helper to keep the route readable.

## Changes

### 1. New helper: `findMatchingAppointmentForRoom`

**File:** `src/lib/patient/match-appointment.ts` (new)

```ts
export async function findMatchingAppointmentForRoom(params: {
  patientId: string;
  roomId: string;
  locationId: string;
  now?: Date;
  excludeAppointmentIds?: string[]; // candidates already tried and abandoned
}): Promise<{ appointmentId: string; patientIdOnAppt: string | null } | null>
```

`excludeAppointmentIds` supports the bounded-retry loop in the route (see §2): when a pre-matched candidate fails post-lock revalidation, we re-run the helper excluding it so a *second* valid appointment today in the same room isn't silently skipped. The helper adds `AND id NOT IN (:excludeAppointmentIds)` to the WHERE when the list is non-empty.

Logic (Drizzle, service-role `db`):

1. Resolve the location timezone (`locations.timezone`, fallback `Australia/Sydney`) and compute `dayBoundsInTimeZone(now, tz)` from `src/lib/runsheet/format.ts`.
2. Gather the patient's phone numbers: `select phone_number from patient_phone_numbers where patient_id = :patientId`. Lenient on `verified_at` is acceptable here — OTP uses canonical E.164 numbers and writes the matching row — so the row's existence is sufficient. The unlinked-appointment guard below, not `verified_at`, is what keeps the match safe.
3. Select appointments where:
   - `location_id = :locationId`
   - `room_id = :roomId`
   - `scheduled_at BETWEEN startOfDay AND endOfDay`
   - **`status NOT IN ('cancelled', 'completed', 'no_show')`** — exclude terminal statuses, not just `cancelled`. Otherwise an earlier-in-the-day completed/no-show appointment can win the `ORDER BY scheduled_at ASC` over the active one the patient is actually trying to join.
   - **Phone-match rule (shared-phone-safe):** `patient_id = :patientId OR (patient_id IS NULL AND phone_number IN (:phones))`. The raw-`phone_number` branch is constrained to **unlinked** appointments only. Without `patient_id IS NULL`, a shared phone (multi-contact) would match an appointment already linked to a *different* patient — mapping the wrong person onto a booked session. Once an appointment is linked to a patient, only that patient's `patient_id` may match it.
   - Order by `scheduled_at ASC`, `limit 1`.
4. Return `{ appointmentId, patientIdOnAppt }` or `null`.

### 2. Wire matching into `/api/patient/arrive`

**File:** `src/app/api/patient/arrive/route.ts`

Inside `if (!sessionId && scope.roomId)`, before the current insert, run a **bounded match-then-validate loop** so a candidate that goes stale between matching and locking doesn't cause us to skip a *second* still-valid appointment in the same room. Use a named constant:

```
const MAX_MATCH_ATTEMPTS = 3;  // > 3 stale/abandoned candidates → deliberate on-demand fallback
```

Trade-off, stated deliberately: three iterations comfortably covers a patient's realistic number of same-room appointments today plus a stale-race retry. If *more* than three distinct candidates each fail revalidation in one arrival (only possible under pathological concurrency), we stop and fall through to on-demand rather than loop unbounded — an acceptable, bounded degradation.

```
tried = []
for attempt in 1..MAX_MATCH_ATTEMPTS:
  candidate = findMatchingAppointmentForRoom({ patientId, roomId, locationId, excludeAppointmentIds: tried })
  if !candidate: break                 # nothing (left) to match → on-demand
  result = tryClaimInTransaction(candidate)   # see step 2
  if result.claimed: return result.response
  tried.push(candidate.appointmentId)  # revalidation failed → exclude and retry
# loop exhausted or no candidate → fall through to on-demand creation
```

1. If `body.patient_id` is present, enter the loop above. With no `patient_id`, skip matching entirely (create on-demand as today).
2. **For each candidate**, run the reuse/create inside a **single DB transaction** (`db.transaction(async (tx) => { ... })`) — this is `tryClaimInTransaction`:
   - **Lock the matched appointment row** first: `select id, patient_id, status, room_id, location_id, phone_number from appointments where id = :appointmentId for update`. There is no unique constraint on `sessions.appointment_id` (only an index — `src/lib/db/schema.ts:271`), so two simultaneous arrivals could both observe "no session" and insert duplicates. Serialising on the appointment row closes that race.
   - **Re-validate the match against the locked row** (the helper matched it *outside* the lock; state may have changed). The locked appointment is still a valid match for the current patient only if **either** `appointment.patient_id = body.patient_id` **or** (`appointment.patient_id IS NULL` **and** its `phone_number` is still in the patient's phone set) — and its `status` is still non-terminal. If the re-validation **fails** (e.g. a racing shared-phone arrival already backfilled `patient_id` to a *different* patient, or the appointment was just completed/cancelled), **return `{ claimed: false }`** so the loop excludes this appointment and re-matches — there may be another active appointment today for the same patient/room that the helper would now surface. Only when the loop finds no further candidate do we fall through to on-demand. Without this re-read two shared-phone patients racing on the same unlinked appointment can both pre-match it; the lock alone prevents duplicate sessions but not stale unsafe matching, and without the retry a rare stale-candidate race would wrongly skip a valid second appointment.
   - **Look for any existing session** for `appointmentId`, ordered active-first (multiple sessions per appointment are possible, so never an arbitrary `limit 1`):
     `select id, entry_token, status from sessions where appointment_id = :appointmentId order by (status in ('queued','waiting','checked_in','in_session')) desc, created_at desc limit 1`.
     This returns the active session if one exists, otherwise the newest terminal session, otherwise nothing. (`checked_in` is included in the active set — it's an in-person arrival status; a matched appointment whose session is in-person can legitimately be in it.)
   - **Resolve the session by what the lookup returned** — every DB status (`queued | waiting | checked_in | in_session | complete | done`) has an explicit branch:
     - **`queued`** → update to `waiting` (set `patient_arrived`, `patient_arrived_at`, `prep_completed`, `device_tested`). Return that session, status `waiting`.
     - **`waiting`** → no-op (leave fields as-is). Return that session, status `waiting`.
     - **`checked_in`** → treat as an **existing active session**; **do not insert**, **do not downgrade** to `waiting`. The patient has already arrived (in-person path). Set `patient_arrived`/`patient_arrived_at` if not already set, but leave `status = 'checked_in'`. Return the existing token + `checked_in`. (The waiting-room boundary map collapses `checked_in`→`waiting` UI per §3, so a telehealth client renders the waiting screen; an in-person client is on the checked-in confirmation, not the waiting room.)
     - **`in_session`** → **do not downgrade**. Return the existing token + `in_session` so a rejoin lands back in the live call.
     - **`complete` or `done`** → **do not** turn it back into `waiting`. Return the existing token + its real terminal status. (The appointment already ran; this is a stale re-entry — the waiting room renders its "already complete" state.)
     - **No session exists at all** → insert a session with `appointment_id = appointmentId`, `room_id = scope.roomId`, `location_id = scope.locationId`, `status = 'waiting'`, arrived flags set. Return it, status `waiting`.

     Net rule: **insert only when no session row exists for the appointment**; if any session exists (active — `queued`/`waiting`/`checked_in`/`in_session` — *or* terminal) reuse it and report its real status. There is never a case where we insert a new session because the only existing one is terminal.
   - **Link the participant — and resolve any conflict safely.** The patient's LiveKit identity and display name are derived from the session's **first** `session_participants` row (`src/app/api/patient/livekit/token/route.ts:54-67`, `orderBy(asc(createdAt)).limit(1)`). So returning an *active* session whose first participant is a *different* patient would mint a video token bearing **someone else's identity/name** — a wrong-patient exposure, not just a duplicate row. Handle it explicitly:

     **Terminal sessions (`complete`/`done`) — do not mutate participants.** A terminal session is a historical record and won't mint a video token (the LiveKit route 409s on any non-`in_session` status). Skip participant linking/repair entirely and just return the terminal status. This avoids rewriting the participant history of a finished appointment.

     **Active sessions (`queued`/`waiting`/`checked_in`/`in_session`) — link/repair:**
     - **Read the existing patient participant(s) for the session** (inside the tx).
     - **No participant yet** → insert `(session_id, body.patient_id)`.
     - **The arriving patient is already a participant** → `on conflict (session_id, patient_id) do nothing` (idempotent re-entry; the table has a unique `(session_id, patient_id)` constraint — `src/lib/db/schema.ts:363`, and the current plain insert at `src/app/api/patient/arrive/route.ts:60` would otherwise throw).
     - **A *different* patient is the existing participant:**
       - If the locked appointment is **definitively linked to `body.patient_id`** (`appointment.patient_id = body.patient_id`), the session legitimately belongs to the arriving patient and the stale participant is a data anomaly → **repair**: delete the conflicting participant row(s) and insert `body.patient_id` so it becomes the (single) first participant. The booked patient is authoritative.
       - Otherwise (the link is via the unlinked-phone branch and we can't prove ownership) → **abandon this candidate** (`return { claimed: false }`, so the loop excludes it and re-matches; if nothing else matches, on-demand). Never hand back a session whose identity belongs to someone else.

     Operation order within the tx is therefore: lock + revalidate appointment → resolve session status → backfill appointment `patient_id` if null (both paths) → for terminal sessions, return without any participant change; for active sessions, link/repair the participant. The terminal short-circuit guarantees no participant mutation on finished sessions.
   - If the matched appointment had `patient_id` null, backfill `appointments.patient_id = body.patient_id` (inside the same tx, after the re-validation above confirmed it's still null). This applies on **both** the terminal and active paths — it links the *appointment* to the patient, which is correct regardless of session state and doesn't touch participant history. (In practice a terminal session almost always already has a linked patient, so this is usually a no-op there.)
   - On success the transaction returns `{ claimed: true, response: { session_id, entry_token, status } }` where **`status` is the session's actual status** (see finding #6) — not a hardcoded `'waiting'`. The route then (outside the tx) calls `broadcastSessionChange(scope.locationId, ...)` and returns `response`. A reused `in_session`/`complete`/`done` session must report its real status so the client routes correctly.
3. **If the loop ends without a claim** (no candidate, or every candidate failed revalidation up to the cap): fall through to the existing on-demand creation path, unchanged.

The matched path's return shape stays `{ session_id, entry_token, status }` so `entry-flow.tsx` redirects to `/waiting/[token]` using `data.entry_token` — but `status` now reflects reality rather than always `'waiting'`.

### 3. Waiting room must render the session's real initial status

The entry flow, phone verification, and identity confirmation are untouched. After arrive, `entry-flow.tsx` ignores `data.status` and pushes to `/waiting/[token]` using `data.entry_token` (`src/components/patient/entry-flow.tsx:203-205`) — which now points at the matched session. That part is fine.

**But the waiting room itself does not know the session's real status on load**, and this becomes a live bug once we can route a patient into an `in_session`/`complete`/`done` session:

- `src/app/(patient)/waiting/[token]/page.tsx:22-40` selects the session row but **not** `status`, and passes none down.
- `WaitingRoom` initialises `useState<SessionStatus>('waiting')` (`src/components/patient/waiting-room.tsx:33`).
- The socket `join:session` handler only joins the room (`server.ts:218`); it does **not** emit a current-status snapshot. `status_changed` only fires on a *future* transition.

So a patient re-entering an already-`in_session`/`complete`/`done` session would sit on the "waiting…" screen indefinitely until the clinician happens to fire another status event. This pre-dates our change but our change is the first path that can trigger it for the patient, so it's in scope.

**Fix (recommended — server-rendered initial status):**
1. Add `status: sessionsT.status` to the select in `waiting/[token]/page.tsx`.
2. Thread it through `WaitingRoomClient` → `WaitingRoom` as `initialStatus`.
3. `WaitingRoom` initialises from `initialStatus`, with an explicit map (see type note below). Live `status_changed` events still override it as today.

**Type note (the DB↔UI mismatch the reviewer flagged):** `sessionsT.status` is the full DB enum — `queued | waiting | checked_in | in_session | complete | done` — but `WaitingRoom`'s `SessionStatus` only permits `waiting | in_session | complete | done` (`src/components/patient/waiting-room.tsx:20`). Passing the DB status straight in is a TS error. **Do not widen the UI type** to carry states the waiting room can't render. Instead, map at the boundary: `queued` and `checked_in` both render as the waiting UI, so collapse them to `'waiting'`; pass `in_session`/`complete`/`done` through unchanged. A small `toWaitingUiStatus(dbStatus): SessionStatus` helper (default → `'waiting'`) keeps the page/prop typed to the narrow UI union and makes the collapse explicit. (`checked_in` shouldn't reach a telehealth waiting room anyway, but mapping it defensively avoids a `never`/runtime gap.)

This is a few lines, fixes the strand-on-waiting bug for **every** entry path (not just matched ones), and needs no socket-protocol change.

**Alternative (socket snapshot):** have the `join:session` handler in `server.ts` look up and immediately `emit('status_changed', { status })` to the joining client. Heavier (DB read on every join, protocol change) and only fixes the socket path; the server-rendered prop is preferred. Documented here only as the fallback the reviewer noted.

## Edge cases

- **Patient already has a session for the appointment** (tapped the link twice, or arrived via SMS then re-entered): the existing-session lookup finds it and the status guard applies — `queued`→`waiting`, `waiting`/`in_session`/`complete`/`done` return the real status without downgrade. No duplicate; participant link is `onConflictDoNothing`.
- **Appointment with no linked patient (PMS phone-only):** matched via the unlinked-only phone branch (`patient_id IS NULL AND phone_number IN (...)`), then we backfill `appointments.patient_id`.
- **Two patients share a phone, the *other* one has the appointment (multi-contact):** the appointment is already linked to that other patient, so the unlinked phone branch can't match it, and the `patient_id = :patientId` branch won't either. Correct outcome: no match for the arriving patient → on-demand. This is the high-severity case the unlinked guard prevents.
- **Two patients share a phone, neither appointment is linked yet:** identity confirmation already resolved the arriving patient to a single `patient_id`; we backfill *that* `patient_id` onto the earliest matching unlinked appointment. Acceptable for the prototype; a stricter rule (require name/DOB corroboration) is out of scope.
- **`patient_id` absent** (shouldn't happen for telehealth, identity is always confirmed): skip matching, create on-demand as today.
- **Concurrent double-submit, same patient** (two arrivals racing, no session yet): the `for update` lock serialises them — the first creates the session, the second re-validates (still matches), sees the session, and reuses it. No duplicate sessions.
- **Concurrent shared-phone race on one unlinked appointment** (two *different* patients sharing a phone both pre-match the same unlinked appointment): the first acquires the lock, re-validates (still `patient_id IS NULL`, phone matches), creates the session, backfills `patient_id` to itself. The second acquires the lock next, re-validates and **fails** (appointment is now linked to the other patient) → falls through to on-demand. The lock alone wouldn't catch this; the post-lock re-read is what makes it safe.

## Open questions (resolved)

1. **Status guard on reuse — RESOLVED.** Only `queued`→`waiting`; `waiting` is a no-op. For `in_session`, return the existing token/status without downgrading (rejoin is intended). For `complete`/`done`, do not turn back into `waiting` — return the real status. (See section 2.)
2. **`verified_at` strictness — RESOLVED.** Lenient matching on all of the patient's phone rows is fine in this codebase: OTP uses canonical phone numbers and writes the matching row. The safety requirement is the **unlinked-appointment guard**, not `verified_at`.

## Testing plan

- Seed a telehealth appointment for today in Dr Smith's room, linked patient with a verified phone, **with** a session already spawned (morning scan). Open Dr Smith's room link → OTP → identity → assert the patient lands in the *existing* appointment session (no new on-demand row), run sheet shows the scheduled row flip to `waiting`.
- Same, but **no** session spawned yet → a session is created carrying `appointment_id`, appears in the scheduled slot (not as on-demand).
- Appointment exists only as a PMS phone-only row (no `patient_id`) → matched via the unlinked phone branch, `patient_id` backfilled.
- **Shared phone, appointment linked to a *different* patient** in the same room → arriving patient gets **no match** → on-demand session (guards against mapping the wrong person). _(Added per review.)_
- **Concurrent double-submit, same patient** against an appointment with **no** existing session → exactly one session created, both requests resolve to it (no duplicates). _(Added per review.)_
- **Concurrent shared-phone race** — two different patients sharing a phone both arrive simultaneously against one unlinked appointment with no session → first wins and backfills, second re-validates post-lock, fails, and falls through to on-demand. Exactly one of them is mapped to the appointment. _(Added per review — post-lock revalidation.)_
- **Re-enter an `in_session` / `complete` / `done` session via the room link** → arrive returns the session's real status, the waiting room loads it as `initialStatus` and renders the correct screen immediately (live call / "already complete") rather than stranding on "waiting…". _(Covers §3.)_
- **Matched appointment's session is `checked_in`** (in-person) → reused as an active session, not downgraded to `waiting` and not duplicated; arrive returns `checked_in`. _(Covers the checked_in branch.)_
- **Matched session is terminal (`complete`/`done`) with a different first participant** → no participant mutation (history preserved); arrive returns the terminal status. _(Covers terminal short-circuit.)_
- **Matched session already has a *different* patient as first participant, appointment linked to the arriving patient (active session)** → conflicting participant repaired (deleted + arriving patient inserted), so the LiveKit token resolves to the correct identity. _(Covers participant-conflict repair.)_
- **Matched-via-phone session has a different first participant, ownership unprovable** → candidate abandoned, loop re-matches, falls through to on-demand if nothing else; never hands back a foreign-identity session. _(Covers participant-conflict abandon.)_
- **Earliest candidate goes terminal/relinked between match and lock, but a second active appointment exists** same patient/room → first candidate fails revalidation, loop excludes it, second candidate is matched. _(Covers bounded retry.)_
- Earlier-in-the-day **completed/no-show** appointment plus a later active one, same patient/room → the active one is matched, not the terminal earlier one.
- No appointment in that room today → plain on-demand session created (current behaviour).
- Appointment exists but in a *different* room → no match → on-demand session in the link's room (no cross-room pull).
- Two *active* appointments today in the room for the same patient → earliest one matched.
- Tap the link twice → second arrival resolves to the same session, no duplicate (participant insert is idempotent).
- Re-enter after the session is `in_session` → returns the live session token/status, no downgrade. Re-enter after `complete`/`done` → returns real status, not `waiting`.
