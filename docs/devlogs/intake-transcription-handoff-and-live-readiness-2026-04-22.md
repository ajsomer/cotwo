# Intake package transcription handoff + live readiness updates + test-hook fire-early

**Date:** 2026-04-22

## Context

Picking up the plan from 2026-04-21's session (`docs/plans/intake-package-transcription-handoff.md`) that another agent was supposed to implement. Started this session by executing that plan, hit enough design problems that the model changed materially mid-implementation, then bolted on two adjacent pieces the user flagged while testing: live readiness updates via Socket.IO, and a testing hook that fires `add_to_runsheet` immediately when the patient finishes their intake package so we can walk the end-to-end flow without waiting for the real scheduled offset.

Everything landed as one commit at the end — `88e1210 Intake package transcription handoff + readiness live updates`. Lots of the work happened before that point but I didn't check anything in until the user said "push all outstanding changes to remote." The commit includes some pre-existing uncommitted work from prior sessions (video call panel, process flow tweaks, spec deletions) that the user told me to sweep in.

## What shipped

### Piece 1 — Transcription handoff (initial implementation, later rebuilt)

Followed the plan literally. Added migration `019_intake_package_transcribed.sql` (`transcribed_at TIMESTAMPTZ` on `intake_package_journeys`), patched `src/lib/supabase/types.ts`, extended `ReadinessAppointment` with `package_status / package_completed_at / package_transcribed_at`, populated them in `src/lib/clinic/fetchers/readiness.ts`, added `isIntakePackageNeedsTranscription` to `src/lib/readiness/derived-state.ts` before the `allTerminal` short-circuit, wrote `POST /api/readiness/mark-intake-transcribed`, `GET /api/readiness/intake-handoff`, a new `IntakePackageHandoffPanel` component, wired it into `readiness-shell.tsx`, factored `extractFieldsFromSchema` out of the legacy form-submission route into `src/lib/forms/extract-fields.ts`.

Built clean. Then testing started failing.

### Piece 2 — Rebuild: source of truth is the action, not the journey

Three sequential bug reports from the user:

1. Intake completed, readiness showed "In progress" instead of "Form Completed".
2. After we broadcast readiness updates via Socket.IO (see Piece 3), still stuck on "In progress".
3. "There's no journey row dude, a user has completed their journey row and has submitted their intake form"

Dug in. Ran a throwaway debug script (`scripts/check-intake-journey.ts`, deleted after) against Supabase to inspect Aiden's and Bob's rows. Found the real issue: **the `intake_package_journeys` row was missing on both**, but the `intake_package` appointment_actions row had `status='completed'`, a `form_submissions` row existed, a `payment_methods` row existed. Two fresh patients, same state — meaning this wasn't the test identity being reused, it was something in the happy path dropping the journey row.

Didn't resolve *why* the journey was missing. The user pre-empted the investigation with "we shouldn't be calling the journey row on the readiness dashboard. We should simplify it to just look at intake journey completed with a form."

That was the right call. The predicate should key off the action status, same as the existing `deliver_form` handoff path — one mechanism, one source of truth. Migration 019 became pointless.

Rebuild:

- **`src/lib/readiness/derived-state.ts`** — removed the journey-based predicate. New helper `isIntakePackageActionNeedsTranscription(action)` just checks `action.action_type === 'intake_package' && action.status === 'completed'`. Folded into the existing `hasFormNeedsTranscription` check in `getReadinessPriority` alongside `isFormNeedsTranscription`. `getTriggeringActions` now returns both types. Sort helper reads from the action's `scheduled_for` — no more journey-completed-at fallback needed.
- **`src/stores/clinic-store.ts` + `src/lib/clinic/fetchers/readiness.ts`** — deleted `package_status / package_completed_at / package_transcribed_at` from `ReadinessAppointment` and the GroupedAppointment shape. Fetcher no longer selects `transcribed_at`.
- **`src/app/api/readiness/mark-intake-transcribed/route.ts`** — now takes `{ action_id }`, flips `appointment_actions.status` from `completed` to `transcribed`. Mirrors the legacy `mark-transcribed` route exactly (defence-in-depth check that the action's block is `intake_package`).
- **`src/app/api/readiness/intake-handoff/route.ts`** — rewrote to key off the action rather than the journey. Journey is still preferred for item configuration (`form_ids`, `includes_card_capture`, `includes_consent`) but the route falls back to the action's block `config` + `form_submissions` + `payment_methods` when the journey row is missing. So orphan-journey appointments still render — Aiden and Bob both surfaced correctly after this landed.
- **`IntakePackageHandoffPanel`** — takes `actionId` prop, posts it to mark-transcribed. Header submitted timestamp now comes from `action.completed_at` instead of `journey.completed_at`.
- **`readiness-shell.tsx`** — handler picks the intake_package action (`action_type === 'intake_package' && status === 'completed'`) when forking. `PatientRow`'s package-summary timeline node was deleted — `getTriggeringActions` returning the action itself means the timeline already renders the right row, no separate summary needed.
- **Migration 019 + types patch** — rolled back. Confirmed the column was never actually applied to the DB (`transcribed_at does not exist`), so deleting the file and reverting the types patch was enough. No drop migration needed.

### Piece 3 — Readiness live updates via Socket.IO

Reported mid-testing: "Are we refreshing the dashboard when a patient completes the dashboard." Answered no — the original handoff plan claimed `intake_package_journeys` realtime would handle it but the project uses Socket.IO, not Supabase Realtime. Wrote a focused plan at `docs/plans/readiness-live-updates-socketio.md` and implemented.

Pattern matches the existing `session_changed` infrastructure exactly. One new event `readiness_changed` on the existing `location:{id}` room.

- **`src/lib/realtime/broadcast.ts`** — new `broadcastReadinessChange(locationId, event, payload)` sibling of `broadcastSessionChange`. Uses the same loopback-POST to `/_internal/broadcast`. Server-side code is unchanged — `server.ts`'s interceptor is already room-and-event agnostic.
- **`src/components/clinic/clinic-data-provider.tsx`** — new `socket.on("readiness_changed")` listener that calls `refreshReadiness(currentLocationId)`. Added `refreshReadiness` to the existing `onConnect` resync path alongside `refreshSessions`, so a network flap doesn't miss events.
- **Emit sites (4):**
  - `src/app/api/intake/[token]/complete-item/route.ts` — fires in the `allDone` branch after `markIntakeActionCompleted`, with `event: 'package_completed'`.
  - `src/app/api/readiness/mark-intake-transcribed/route.ts` — `event: 'action_resolved'`.
  - `src/app/api/readiness/mark-transcribed/route.ts` — same event. Added for parity with the deliver_form path; same gap existed there.
  - `src/lib/runsheet/actions.ts` — `resolveTask` after the update succeeds. Extended the existing `select("workflow_run_id")` to `select("workflow_run_id, appointment_id")` to avoid a second query.
- Each emit looks up `location_id` via `appointments.id → location_id`. Could be elided in one or two spots by joining earlier but not worth the readability cost.

### Piece 4 — Testing hook: fire `add_to_runsheet` early

The user wanted to walk the full intake → run sheet → waiting room flow in one sitting without waiting for the real scheduled offset on `add_to_runsheet`. Also wanted the session join URL printed to the patient tab's devtools console for testing convenience.

- **`src/lib/workflows/engine.ts`** — added `fireActionNow(actionId)`. Canonical primitive: atomically claims an action (scheduled → firing), resolves the full handler context (block, appointment, patient, phone, org, clinician, session), runs `executeHandler`, flips the row to `handlerResult.status` or `failed`. Skips precondition eval — caller's already decided. Pulled out inline because duplicating the engine's scan orchestration per call site would have been worse.
- **`src/app/api/intake/[token]/complete-item/route.ts`** — after `markIntakeActionCompleted` in the `allDone` branch, finds the appointment's `add_to_runsheet` action (only if `status='scheduled'`), calls `fireActionNow`, pulls `entry_token` out of the result, builds the join URL, returns it as `session_join_url`. Also broadcasts `session_changed` so the run sheet updates live when the new session appears.
- **Patient components** — `logJoinUrlIfPresent(payload)` helper in `intake-journey.tsx` (consent + form completion paths) + inline equivalent in `intake-card-capture.tsx`. Logs the URL with a teal-coloured marker so it's easy to spot.
- **TODO.md** — new "Testing hooks — remove before prod" subsection with a paragraph explaining what to rip out when a real test fixture lands. `fireActionNow` itself can stay (it's a legitimate primitive); only the call site in complete-item + the console.log sites need removing.

Verified the priority stays "Form Completed" even with `add_to_runsheet` now flipping to `sent` immediately: the predicate keys off the intake_package action, not the run-sheet action, so firing it early doesn't demote the row. `allTerminal` stays false because `sent` isn't in `TERMINAL_STATUSES` for pre-appointment actions.

### Piece 5 — Schema flattener recurses into panels

Reported: the handoff panel showed `panel_personal: —`, `panel_contact: —` instead of actual fields. Our SurveyJS schema has `type: 'panel'` wrappers with the real inputs nested in `panel.elements`. Original `extractFieldsFromSchema` only walked `pages → elements` one level deep and read `name/title`, so it saw the panel name and wrote it as a row with no value.

Rewrote `src/lib/forms/extract-fields.ts` to walk recursively. Panels (`type: 'panel'` or `'paneldynamic'`) don't emit rows of their own; we descend into `element.elements` (or `element.templateElements` for dynamic panels) and emit leaf inputs. Fix benefits both handoff panels since they share the extractor.

### Piece 6 — Close returns to main screen when opened from the row

Reported: closing the handoff panel reopened the PatientContactCard detail card, which is wrong when the user opened the panel directly via the row's Review button. But opening it from *inside* the detail card should still return there.

Threaded a `returnTo: "detail" | "none"` discriminator on the `ActivePanel` state. Review button opens with `"none"`, detail-card's `onOpenFormHandoff` opens with `"detail"`. Close handlers honour it. Fix covers both handoff panels (intake-package and legacy deliver_form).

### Piece 7 — `Admit` button modality gate removed

Reported: patient sitting in the waiting room with `sessions.status = 'waiting'`, but no Admit button on the run sheet row.

Traced to `getActionConfig` in `src/lib/runsheet/derived-state.ts` gating `'waiting'` → `{ Admit }` behind `modality === 'telehealth'`. The modality plumbing on sessions pulls from `appointments.appointment_types.modality`; for add-session-created appointments there was some combination of modality-missing-on-appointment-type-lookup that returned null, hiding the button.

The user's diagnosis was better than mine: "`waiting` is a telehealth-only state anyway (in-person arrive → `checked_in`), so the modality gate can never do anything useful here." Removed the gate. The `modality` parameter on `getActionConfig` is now unused by this case but the signature stayed — other callers still pass it.

## Verification

- `npm run build` clean after every piece.
- `npx eslint` on touched files clean (two pre-existing warnings on `readiness-shell.tsx` for unused imports, not introduced this session).
- Live end-to-end: patient flow → intake complete → readiness tab auto-flips to "Form Completed" via Socket.IO → Review panel renders form fields + card + consent with real labels → Mark as transcribed → row drops to In progress. Verified across two browser tabs for live updates. `add_to_runsheet` fires on completion, session appears on run sheet, console logs the join URL, Admit button appears when patient lands in waiting room. Close from Review button returns to main readiness; close from inside detail card returns to detail card.
- One near-miss: dev server needed a restart to pick up the new Socket.IO listener wiring. Client-side HMR alone didn't re-register the handler. Worth remembering.

## Deferred / flagged

- **Why journeys are missing on completed intake flows.** Bob was a fresh patient in a clean test run, journey row still absent. The `handleIntakePackage` workflow handler creates the row; something between there and `complete-item` flipping `status='completed'` is deleting or never-creating it. Didn't chase. The new predicate tolerates the missing journey, so it stops being a readiness bug, but it's still a real bug somewhere else — probably affects the patient flow too (what did verify match against, what did `complete-item` update when it looked up `journey_token`?). Filed mentally, not in TODO.md.
- **Spec doc update.** The spec at `docs/plans/intake-package-transcription-handoff.md` describes the v1 journey-based model. The landed implementation is action-based. Plan doc is now historical context, not a description of the system. Didn't update it — the code is the source of truth now and the devlog you're reading explains the pivot.
- **`fireActionNow` audit.** Works for `add_to_runsheet`. Hasn't been exercised on other action types. The function resolves all handler context fields so it *should* work for any action, but the per-handler ctx requirements aren't documented. If we start using it from other code paths, check each handler's expected context.
- **`modality` parameter on `getActionConfig`.** Now dead weight for the `waiting` case, still passed by callers. Drop when next touching the signature.
- **Big bundled commit.** The 88e1210 commit mixes transcription handoff, live readiness, the test hook, the schema extractor fix, the close-behaviour fix, the Admit fix, and pre-existing uncommitted work (video call panel, process flow, spec archive moves) that predates this session. User explicitly asked for "one big commit" after I flagged it. Not ideal for git history but fine given the context.

## Notes / things to watch

- The `fireActionNow` call in `complete-item` is marked `TESTING ONLY` in both the code and TODO.md. When it gets ripped out, also remove the `session_join_url` field from the API response and the `logJoinUrlIfPresent` helpers in the two patient components.
- The readiness dashboard now refetches the full slice on every `readiness_changed` ping. At prototype scale this is fine (sub-second queries, a few tabs, low throughput). If it starts showing up in profiling, debounce the listener with a 250ms trailing timer — same pattern the run sheet would adopt.
- The SurveyJS flattener walks `elements` and `templateElements`. It doesn't handle matrix/dynamic-matrix question types (rows as separate responses). None of our forms use those yet; when we do, extend `walk`.
- The revert of migration 019 leaves no trace in `supabase/migrations/`. If someone re-runs migrations from scratch they'll just skip straight from 018 to the next numbered migration — no gap, no artifact. Clean.
