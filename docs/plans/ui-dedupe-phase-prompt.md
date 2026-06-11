# Implement the UI dedupe phase (Tier 5.4–5.6) of the codebase dedupe plan

You are working in the cotwo repo. Check out branch `refactor/dedupe-and-type-debt`
(it exists; do NOT branch off main). Read these two documents before writing any code:

1. `docs/plans/codebase-dedupe-and-type-debt.md` — sections 5.4, 5.5, 5.6,
   "Minor / opportunistic", and "Explicitly NOT recommended".
2. `CLAUDE.md` — brand system (colours, typography, component patterns) and conventions.

## State of the branch (what's already done — do not redo)

Tiers 1–4 and 5.1–5.3 are implemented and committed on this branch. Line numbers in
the plan are from 2026-06-10 and are STALE — re-locate everything by content. Relevant
facts for your work:

- `src/lib/api-client.ts` exists (`postJson<T>`/`getJson<T>` returning
  `{ ok, data } | { ok, error }`). Use it for new client fetches.
- `src/hooks/useNow.ts` exists (ticking clock hook).
- `src/hooks/usePmsSync.ts` + `src/components/clinic/shared/sync-button.tsx` exist
  (SyncButton, RefreshIcon).
- Domain types moved: import from `@/lib/types/domain` (NOT `@/lib/supabase/types`).
- `MESSAGE_VARIABLES` is now derived from `src/lib/workflows/template.ts`
  (`SMS_TEMPLATE_VARIABLES`, `INTAKE_TEMPLATE_VARIABLES`, `FILE_TEMPLATE_VARIABLES`) —
  if an editor you extract renders placeholder chips, source them from there.
- `intake-journey.tsx` already had its render-body POST moved into a guarded effect;
  `entry-flow.tsx` already has the defensive-advance effect. Don't disturb those.
- `waiting-room.tsx`'s `join:session` handler now ALSO resyncs status via
  `postJson('/api/patient/resolve')` on reconnect — preserve that when extracting
  `useSocketRoom`.
- The clinic store's nine refresh actions were converted to `getJson` in 5.2 — they
  are still structurally identical to each other (the `makeRefresh` factory in 5.6
  still applies).
- Test infra exists: `npm test` (vitest, 19 tests, all must stay green).

## Hard constraints

- Work ONE sub-item at a time. Commit after each sub-item with a message referencing
  the plan section (e.g. `refactor: 5.4a merge card-capture twins`). End every commit
  message with: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Verification gate per commit: `npm run typecheck` clean, `npm run lint` 0 errors
  (baseline: 49 pre-existing warnings — do not add new ones), `npm test` 19/19.
- The ESLint react-hooks rules are strict (React Compiler). `set-state-in-effect`
  errors must be fixed structurally; the ONLY sanctioned suppression is the
  documented one-shot-defensive-correction pattern (see `entry-flow.tsx` for the
  precedent and comment format).
- Visual output must be pixel-equivalent unless the plan explicitly says to converge
  two competing designs (the Toggle). When you do converge, say which design won and
  where it changed in the commit message.
- Patient-facing components live in a 420px mobile-first container; clinic-side is
  desktop-primary. Match surrounding code style (comment density, naming, Tailwind
  idiom, brand tokens from CLAUDE.md — teal-500 primary, amber-500 CTA, etc.).
- This is a permanent prototype: do not flag or "fix" prototype-isms (console SMS,
  dev OTP codes, Stripe test mode).

## Manual verification

These items touch live interactive surfaces; typecheck is NOT sufficient. After each
UI sub-item, run the app (`npm run dev` — note it's a custom server: `tsx server.ts`
with Socket.io) and verify the affected flow with Playwright, or use the /verify
skill if available. The runsheet has dev seed helpers (`seedDemoData` in
`src/lib/runsheet/seed.ts`, surfaced in the runsheet shell) to create test sessions;
patient flows are reachable via the entry links the seed/add-session flow produces.
If you cannot complete a flow end-to-end (auth, data, or environment blocks you),
say exactly which flows were verified live vs. only by diff review in your report —
do not silently downgrade verification.

## Work items, in this order

### 5.4 — UI primitives (do these first; later items depend on them)

a. **Merge the card-capture twins.** `src/components/patient/card-capture.tsx` and
   `src/components/patient/intake-card-capture.tsx` are ~95% identical Stripe
   Elements forms. One component, parameterised by an optional post-save hook and
   optional `roomName`. Diff them line-by-line FIRST and list every real divergence
   before merging; preserve each call site's observable behaviour.
   Verify: card capture step in the entry flow AND in the intake journey (Stripe
   test mode, card 4242…).

b. **`useSurveyModel(schema, onSubmit)` + shared submit shell.** The SurveyJS
   Model construction + theme + `onComplete` wiring + loading/thanks screens exist
   3×: inside `intake-journey.tsx` (FormStep area), `standalone-form-client.tsx`,
   and `form-fill-client.tsx`. Extract the hook + a shared shell component.
   While in `form-fill-client.tsx`: delete the dead `styleOverrides` empty-string
   `<style>` (minor-list item).
   Verify: fill a form via all three surfaces.

c. **New `src/components/ui/` primitives:** `Toggle` (5 hand-rolled switches exist
   with two competing visual designs — inventory all 5, pick the majority/most
   on-brand design, note the converged sites), `Modal` (8 hand-rolled overlays,
   none with the Escape/focus handling `SlideOver` already has — give Modal the
   same Escape + focus behaviour as `ui/slide-over.tsx`), `Spinner`, `CheckCircle`,
   `CopyButton`, `CloseButton`. Adopt them at the existing sites.
   Then (separate commit): replace the 11 `window.confirm`/`alert` destructive
   confirmations with the new Modal (minor-list item). Keep the exact confirmation
   copy.

d. **Review-panel shared parts.** Extract `CopyButton`/`FieldRow`/skeleton/footer
   shared by `form-handoff-panel`, `intake-package-handoff-panel`, and
   `standalone-submission-panel` (under `src/components/clinic/forms/`).
   Verify: open each of the three panels from the readiness dashboard.

e. **Adoption sweep (own commit, mechanical, wide).** The long input className is
   hand-rolled ~61× with drifting focus rings/radii while `ui/input.tsx` has 3
   importers. Extend `ui/input.tsx` with `Textarea`/`Select`/`FormField`, then
   sweep. Same for raw footer buttons vs `ui/button.tsx`. Do NOT change any
   focus/disabled behaviour — where a hand-rolled input genuinely differs (e.g.
   monospace, error state), parameterise rather than flatten.

f. **Shared date/time formatters (minor-list item).** 17 inline `en-AU`
   `toLocale*String` calls across ~11 component files → shared formatters in
   `lib/runsheet/format.ts` (which already exists — extend it). Client components
   format in the browser TZ today; preserve that (do NOT thread location timezone
   into these — that's a product change).

### 5.5 — Action-block editor extraction (the riskiest item; go slow)

`outcome-pathway-editor.tsx` and `process-flow-outcome.tsx` duplicate the entire
timeline editor (~350 lines): rail, day-chip timing picker, toggle, the four
per-action-type field editors, and a copy-pasted `timingLabel()`.

**Before extracting, resolve the known divergence:** the pathway editor offers
`reminder_sms` for forms; the process-flow editor doesn't. Investigate
`git log -p --follow` on both files to determine drift vs. intent. If the history
is inconclusive, PRESERVE the current difference behind a prop (e.g.
`allowFormReminder`) and flag the open question prominently in your report —
do not guess product intent.

Then extract `ActionBlockCard` / `ActionBlockFieldEditor` / `TimelineRail` into
`src/components/clinic/workflows/` (or a shared location both can import); both
files should drop to ~250 lines of genuinely distinct logic.
Verify BOTH flows live: edit an outcome pathway in Workflows, and run the Process
flow's outcome step on a completed session — confirm timing chips, toggles, and
every per-action-type field editor round-trip their config correctly.

### 5.6 — Component/store decomposition

a. **Split `intake-journey.tsx` (~950 lines).** Phase reducer (~150 lines) extracted;
   `IdentityResolution` should REUSE `identity-confirmation.tsx` with a pluggable
   `resolve(selection)` callback (the journey currently re-implements its contact
   picker character-for-character — diff them first; if they've drifted, reconcile
   consciously); `IntakeChecklist`, `ConsentStep`, `FormStep` become files (the
   latter two are already embedded components; FormStep should now sit on 5.4b's
   `useSurveyModel`). Preserve: the completion-fired ref effect, the
   onboarding-demo redirect effect, and resume-via-reminder-link semantics.
   Verify: complete a full intake journey (identity → card → consent → form → done),
   plus a resume from a reminder link.

b. **`appointment-type-editor.tsx` (~726 lines).** 15 `useState` calls modelling one
   form → a single reducer/form object; section components per `CollapsibleSection`;
   move the two-step save (`configure` then conditional `confirm-type` — the second
   call currently has NO error handling) into one `lib/` mutation that surfaces
   failures of either step to the UI.
   Verify: edit + save an appointment type with and without a type-confirm step.

c. **Store cleanup.** In `src/stores/clinic-store.ts`: a `makeRefresh(...)` factory
   for the nine structurally identical refresh actions; store only
   `roomsWithClinicians` and derive `rooms`/`paymentRooms` via selectors —
   `payments-settings-shell.tsx` currently optimistically updates (and reverts)
   three projections of the same rooms; with derivation it should touch one.
   This replaces the old plan's slice split — do the factory first, then re-evaluate
   whether slices are still worth it (default: they're not; say so in the report).
   Verify: runsheet, readiness, payments settings, and rooms settings all still
   hydrate and live-update (Socket.io events still refresh the right slices).

d. **`useEnsureSlices([...])` hook** replacing the fetch-if-empty effect repeated in
   ~8 shells, and **`useSocketRoom(...)`** centralising join-on-connect (3 copies in
   `clinic-data-provider.tsx`, 2 in `waiting-room.tsx` — remember the waiting room's
   join handler also does the resolve-resync; keep that, parameterised). Move the
   provider's render-body `useClinicStore.setState` into an effect — mind the
   `set-state-in-effect` lint rule; restructure rather than suppress if possible.
   Verify: cold-load each clinic page directly by URL; kill and restart the dev
   server while a waiting-room tab is open and confirm it resyncs.

### Out of scope

The server-side minor items (onboarding/test-session parallelisation,
intake-handoff parallelisation, `fetchRunsheetSessions` timezone round-trip,
`fetchRoomsWithClinicians` join, `server.ts` guardedJoin, projection maps,
`GET /api/patient/[id]` keep-or-delete) are NOT part of this phase. Also respect the
plan's "Explicitly NOT recommended" list (no `supabase/migrations/` deletion, no
TanStack Query, no Supabase Realtime, no test expansion beyond what exists).

## Reporting

At the end, report per sub-item: committed SHA, what was extracted/merged, every
behavioural or visual divergence you found and what you did with it, which flows
were verified live vs. diff-only, the 5.5 reminder_sms verdict (drift or intent,
with evidence), and anything you deliberately skipped with the reason.
