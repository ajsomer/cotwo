# Codebase Dedupe & Type-Debt Plan (Review Wave 2)

**Date:** 2026-06-10 (revised same day after second review)
**Scope:** Whole-codebase review (~52k LOC, 321 files) for duplication, verbosity, query efficiency, and engineering best practices.
**Status:** Proposed — not yet implemented.

> **Revision note:** A second review corrected four items, each verified against the code:
> - 2.2's "unique column + `onConflictDoUpdate`" alternative was **removed** — it would regress the connection-scoped PMS link design (`schema.ts:883-884`). Transaction-only.
> - 4.1's dependency deletion clarified: the `supabase` **CLI devDependency** only; `@supabase/ssr` / `@supabase/supabase-js` stay (Storage runtime).
> - 1.2 now names the endpoint (`POST /api/patient/resolve`) and folds in hardening its unguarded JSON parse.
> - Tier 4 scope corrected: only two files consume the generated `Database` type directly; the other ~32 `@/lib/supabase/types` imports are domain shapes that move with the rename, not Drizzle conversions.
**Predecessor:** `docs/plans/codebase-simplification-and-efficiency.md` (2026-06-02), implemented on branch `refactor/codebase-simplification`.

## Context

Five parallel review passes (API routes, server-side lib, clinic components, patient flows/realtime, data layer) plus a second-opinion critique of the findings, with the critique's caveats verified against the code before this plan was written.

**Headline:** the architecture is sound. No layering violations, no wrong abstractions, no data-model problems, no missing indexes on hot paths. The debt is almost entirely **horizontal** — the same correct logic written 2–6 times by cloning a sibling feature, now drifting. A handful of thin shared helpers removes ~2,500–3,000 lines, but line count is **not** the priority driver: this plan sequences bugs and data integrity first, broad dedupe last.

### Relationship to the previous plan

The 2026-06-02 branch already shipped: service-role route auth gates (`requireStaffOrgAccess` + resource gates), socket presence bound to token-resolved claims, atomic workflow-block saves (RPC), dead realtime code removal, `no-console` lint guard, `Cache-Control: no-store`, workflows one-request cold load, readiness count location-scoping, and the runsheet "today" filter fix. **Nothing in this plan re-does those.**

Two items from the old plan are superseded or unblocked here:

- The old plan's "**No type-layer changes**" recommendation predates the Neon/Drizzle migration and is now wrong — `database.generated.ts` is frozen-stale and unregenerable. Tier 4 below replaces it.
- Old 2.3 (decompose large components) and 2.4 (store slices) were deferred by user decision. Tier 5 here refines them with specifics found in this review; they remain last in sequence, one at a time, behind manual verification.

**DB note:** the app database is **Neon** (Drizzle for all runtime queries; Supabase survives only for Storage buckets). Apply any SQL via the Neon MCP per `memory/project_neon_migrations.md`. The old plan's "Supabase, not Neon" note is outdated.

### Verified caveats from the second-opinion review

- `fireActionNow` **intentionally** skips precondition evaluation — the docstring at `src/lib/workflows/engine.ts:373` says so. Any extraction must keep precondition evaluation in the batch path only (Tier 3).
- The `appt.phone_number` fallback at `engine.ts:475` exists **only** in `fireActionNow`. The drift is most likely a bug in the **batch** path, not a quirk to preserve: manually-entered run-sheet appointments carry the phone on the appointment row, so a scheduled SMS to a manual-entry patient can fire with an empty phone number. Tier 3 unifies the fallback into both paths (explicit decision recorded there).
- `supabase/migrations/` is referenced by **nothing operational** — no scripts, CI, or deploy config; only docs link to it, and `docs/plans/workflow-initial-intake-sms.md:27` calls it "historical record only." **Keep it as an archive**; do not delete. The actionable migration item is the drizzle journal mismatch (4.4).
- There is **no test infrastructure** (no test script, no vitest/jest). Tier 3's "extract with tests" therefore includes a scoping decision (3.2).

> Line references throughout are point-in-time (2026-06-10); re-verify before editing.

---

## Tier 1 — Bug fixes (small, independent, ship as one batch)

### 1.1 POST fired during render in the intake journey

`src/components/patient/intake-journey.tsx:300-311` — when the demo journey hits `done`, a `fetch('/api/patient/arrive')` + `window.location.replace` runs **in the render body**; every re-render in that window issues another POST. Move into a `useEffect` keyed on the phase (the `completionFiredRef` effect at lines 127-133 already shows the correct pattern). Same class of issue, smaller: `entry-flow.tsx:305` calls `advancePastIntake()` (setState) during render in a defensive branch.

### 1.2 Waiting room can strand on stale status after reconnect

`src/components/patient/waiting-room.tsx:82-99` re-joins its socket room on `connect` but never refetches session status — if the clinician admits while the patient's socket is down, the patient stays on "waiting" forever. The clinic side already resyncs on reconnect (`clinic-data-provider.tsx:45-64`); the patient side doesn't. **Fix:** in the `connect` handler, call **`POST /api/patient/resolve`** with the entry token — it already returns `context.session.status` (`src/app/api/patient/resolve/route.ts:71`) — and `setStatus(toWaitingUiStatus(...))`. Do **not** add a new status endpoint. Note: `patient/resolve` is one of the seven routes that parse JSON with no guard (see 5.1); since reconnect calls will now depend on it, harden its body parsing as part of this fix rather than waiting for Tier 5. This closes the gap without building the full polling fallback the CLAUDE.md convention describes (which is implemented nowhere — decide separately whether to keep or drop that convention).

### 1.3 Readiness shell: name-based filtering and a frozen clock

- `readiness-shell.tsx:108-117` joins rooms/types by **display name** (`rooms.find(r => r.name === appt.room_name)`); duplicate names across locations or a rename silently breaks filtering. Carry `room_id` / `appointment_type_id` on `ReadinessAppointment` and match by id.
- `readiness-shell.tsx:104` — `useMemo(() => new Date(), [])` never ticks, so time-derived display goes stale on a long-open tab. Extract the run sheet's 30s tick (`runsheet-shell.tsx:151-155`) into a shared `useNow(intervalMs)` hook and use it in both.

### 1.4 `shouldSendPrepNow` is dead branching

`src/lib/runsheet/mutations.ts:44-60` — every branch returns `true`; the documented 6pm queue rule (tomorrow-before-6pm ⇒ queue for 6pm) is not implemented. **Decision required:** implement the rule (needs a delayed-send mechanism) or delete the function and the pretence. Given the prototype has no job queue, recommend deleting the branching and leaving a comment stating prep SMS always sends immediately, so the code stops lying.

### 1.5 SMS time formatting ignores location timezone

`src/lib/workflows/handlers.ts:140-155` formats `{appointment_time}` / `{session_date}` with `toLocaleTimeString("en-AU", …)` and **no `timeZone` option** — output depends on server TZ, exactly what `src/lib/datetime/timezone-bucket.ts` exists to prevent. Fix by passing the location timezone through `HandlerContext`. *Sequencing note: this lands naturally with Tier 3 (same file, same context object); listed here so it isn't lost if Tier 3 slips.*

---

## Tier 2 — Data integrity (transactions)

### 2.1 Wrap `createSessions` writes in a transaction

`src/lib/runsheet/mutations.ts:63-172` — per input row: appointment insert → session insert → phone-match select → participant insert → appointment update → SMS, sequential, no transaction. A session-insert failure (lines 102-118 `continue`) orphans the appointment. The correct pattern already exists in-repo (`src/app/api/patient/arrive/route.ts:62` uses `db.transaction`).

**Fix:** wrap each row's writes in `db.transaction`; hoist a single batched `inArray` phone→patient resolution before the loop (currently one query per row); send SMS after commit only.

### 2.2 Make PMS patient create+link atomic

`src/lib/pms/sync/pull.ts:134-144` inserts the patient, then `linkPatient` (`src/lib/pms/sync/mapping.ts:52-64`) upserts the link as a **separate** statement. A failure between the two leaves an unlinked patient — and because the link table is the only dedupe key, **the next sync creates a duplicate patient**.

**Fix:** wrap insert+link in one `db.transaction`. **Transaction only — do not move the external id onto the patients table.** Patients are org-scoped while PMS ids are connection-scoped; the current link-table design models that correctly with unique keys on `(connection_id, pms_external_id)` and `(connection_id, patient_id)` (`src/lib/db/schema.ts:865,883-884`), and supports one patient linked from multiple PMS connections. A unique column on `patients` would regress that.

### 2.3 (Opportunistic, same files) Memoize per-batch PMS lookups

`pull.ts` re-queries the same type-link / practitioner-room / patient-link mappings for every record in a batch (~3-7 queries per record). Preload the three `pms_*_links` tables for the connection into Maps at pull start. Low severity (bounded volumes), but it's the same files as 2.2.

---

## Tier 3 — Workflow engine extraction

The engine is the most drift-prone duplicated code in the codebase and already has one behavioral divergence (the phone fallback). One refactor, two files.

### 3.1 Unify the two execution paths around shared helpers

`executeScheduledActions` (`engine.ts:43-360`) and `fireActionNow` (`engine.ts:376-514`) repeat the same claim → fetch block/appointment/patient/phone/org/clinician/session → build 14-field `HandlerContext` → execute → write-back machine (~130 duplicated lines).

Extract, shared by both paths:

- `buildHandlerContext(action, block, lookups)` — single context assembly. **Decision (recorded):** the `phone?.phone_number ?? appt.phone_number ?? ""` fallback at `engine.ts:475` becomes **common to both paths** — the batch path lacking it is the bug (manual run-sheet appointments carry phone on the appointment row).
- `markActionOutcome(actionId, handlerResult)` — the success/failure write-back, replacing the 4 repeated failure-update blocks inside the batch loop (`engine.ts:207-247, 302-313`).
- **Preserve intentionally:** precondition evaluation stays batch-only (`engine.ts:250-266`); `fireActionNow` skips it by design (docstring at `engine.ts:373`). The extracted shape should make this explicit (e.g. an `evaluatePreconditions: boolean` at the two call sites), not implicit.
- `Promise.all` the five independent lookups in `fireActionNow` (`engine.ts:440-464`).

### 3.2 Shared run-completion helper (3 copies + an N+1)

The hardcoded `terminalStatuses` array + "any non-terminal actions remaining?" check + run update exists at `engine.ts:336-357`, `src/lib/runsheet/actions.ts:325-343`, and `actions.ts:389-407`. Adding an action status currently requires three edits or runs never close. Export `TERMINAL_ACTION_STATUSES` and `maybeCompleteWorkflowRuns(runIds: string[])` from one workflows module; in the engine, replace the per-runId query loop with one grouped query (`GROUP BY workflow_run_id HAVING count(*) FILTER (...) = 0`).

### 3.3 One template renderer, one merge-field vocabulary

`handlers.ts` re-rolls `.replace(/\{x\}/g, …)` chains in five handlers with **divergent vocabularies** (`{first_name}`/`{clinic_name}` in `send_sms` vs `{patient_first_name}`/`{link}` in intake), and `MESSAGE_VARIABLES` (`src/lib/workflows/types.ts:480`) documents only the first set — so the builder UI advertises placeholders that intake templates ship literally to patients. Extract `renderTemplate(template, vars)`, define one canonical variable map per direction, derive `MESSAGE_VARIABLES` from it. Fold in 1.5 (timezone) here.

### 3.4 Test-infra decision (decide before starting 3.1)

There is no test framework in the project. Options:

1. **Minimal vitest scoped to the engine's pure functions** — precondition evaluation, context assembly, terminal-status logic, `renderTemplate`. This is the one place in the codebase where tests clearly pay for themselves, and it pins the intentional batch-vs-manual differences so they can't silently regress. (~1 dev-dependency, a handful of test files, no CI required.)
2. **No test infra** (consistent with permanent-prototype status) — extract behind careful diff review and manual verification of: a scheduled SMS firing via cron scan, a manual "fire now" from the readiness UI, a precondition-skipped action, and a manual-entry appointment receiving SMS via the batch path (the new fallback).

Recommend option 1; the engine drives patient-facing automation and is pure enough to test cheaply.

---

## Tier 4 — Type layer: finish the Neon migration

### 4.1 Delete the frozen Supabase type universe

`src/lib/supabase/database.generated.ts` (1,652 lines) covers 26 of 35 tables (missing all `pms_*`, `files`, `file_deliveries`, `stripe_connections`, `pms_sync_cursors`) and its regen script targets a Supabase project that is no longer the database — it can only drift. Yet `src/lib/workflows/types.ts:8-24` still derives six row types and four enums from it; the first column added to `workflow_action_blocks` on Neon silently won't appear in those types.

**Scope precisely:** only **two** files consume the generated `Database` type directly — `src/lib/workflows/types.ts:1` and `src/lib/supabase/custom-types.ts:9`. The ~32 files importing `@/lib/supabase/types` consume hand-written domain shapes, not generated rows; they move with the rename in 4.3 and need **no** Drizzle conversion.

**Fix:** re-point those two files at Drizzle inference — `typeof workflowTemplates.$inferSelect`, enum derivation per 4.2. Then delete `database.generated.ts` and the `supabase:gen` script, and remove the **`supabase` CLI devDependency** (`package.json:51`). **Keep `@supabase/ssr` and `@supabase/supabase-js`** — they are runtime infrastructure for Storage (logo upload at `src/app/setup/clinic/page.tsx`, the `files/*` routes, and the clients in `src/lib/supabase/client.ts` / `service.ts`) unless/until Storage is migrated.

### 4.2 Single enum source of truth

The same literal unions live in three places: Drizzle `pgEnum` (`src/lib/db/schema.ts:4-22`), hand-written `custom-types.ts:15-19`, and the generated file. Derive once: `export type SessionStatus = (typeof sessionStatus.enumValues)[number]` in `custom-types.ts` (and the equivalents).

### 4.3 Honest module names

- `src/lib/supabase/types.ts` — its ~32 import sites consume only the hand-written domain types (`custom-types.ts` content); move to e.g. `src/lib/types/domain.ts`. This is a rename/re-export sweep, not a type conversion (see 4.1 scope note).
- `src/lib/supabase/middleware.ts` — contains zero Supabase code (it's the Neon Auth cookie gate); move to `src/lib/auth/middleware.ts`.
- What legitimately remains under `lib/supabase/`: the Storage client used by the `files/*` routes and clinic-setup logo upload.

### 4.4 Migration hygiene

`drizzle.config.ts` says `out: "./src/lib/db/migrations"`, but the only drizzle-kit artifact (`0000_*` + `meta/_journal.json`) lives in `/drizzle`, and the journal doesn't know the hand-authored `src/lib/db/migrations/0001_*.sql` exists — `drizzle-kit generate` today would produce a conflicting second `0000`. Move the `/drizzle` artifacts under `src/lib/db/migrations` and reconcile the journal, **or** delete them and document that the schema is introspected (`drizzle-kit pull`) and SQL is applied via the Neon MCP (matching `memory/project_neon_migrations.md`). `supabase/migrations/` stays untouched as the documented historical archive.

### 4.5 Dead data-layer code (mechanical deletes, verify with `tsc`)

- `src/lib/db/relations.ts` (404 lines) — wired into `drizzle(pool, { schema })` but `db.query.*` is used zero times. Either adopt `db.query` for the join-heavy fetchers or drop it from the config and delete.
- `src/lib/clinic/fetchers/index.ts` barrel — never imported.
- `fetchUserStaffAssignments` (`src/lib/runsheet/queries.ts:282-333`) — only referenced by the dead barrel; duplicates `fetchUserClinicAssignments` (`staff-access.ts:602`).
- `fetchAppointmentWorkflowActions` (`workflow-actions.ts:116`) — zero callers; removing it also removes that file's only `@supabase` import (the unused `_supabase` param).
- `callPatient` (`runsheet/actions.ts:21`), `getTriggeringActions` (`readiness/derived-state.ts:461`), `POST /api/workflows/seed` — zero callers each.
- Unused `service: SupabaseClient` param on `updateClinicianAssignments` (`rooms-mutations.ts:27`) and the two `createServiceClient()` calls in `settings/rooms/route.ts:144,188` that exist only to feed it.

---

## Tier 5 — Horizontal dedupe

Lower urgency than Tiers 1–4; each sub-item is independently shippable. Within this tier, the API/lib extractions (5.1–5.3) are mechanical-ish and high-coverage; the UI extractions (5.4–5.6) touch live interactive surfaces and go one at a time behind manual verification.

### 5.1 API route shared layer

- **`denyResponse(result)`** (or gates returning `{ ok: false, response }`): the gate-result → HTTP mapping is repeated **74 times**, 47 byte-identical; the copies have already drifted (`"Unauthorized"` vs `"Unauthenticated"` vs `"Forbidden"`-with-401).
- **`withRoute(handler)`** wrapper: one catch-all 500 + JSON-parse 400, replacing 43 hand-rolled catch blocks and fixing the 7 routes that parse JSON with no guard at all (`setup/payments`, `intake/[token]/verify`, `patient/resolve`, `patient/otp/verify`, `patient/livekit/token`, `livekit/token`, `onboarding/advance-stage`).
- **`parseBody(request, validator)`**: one validation idiom (zod or shared manual validators) with enum checks for `modality`, `room_type`, routing fields — these currently surface as 500s instead of 400s.
- **Merge the near-duplicate route pairs** (~600 → ~250 lines): `tasks/mark-transcribed` vs `mark-intake-transcribed` (95% identical), `submissions/[id]/review` vs `archive`, `pms/push` vs `pms/push-appointment` (also fix its double appointment fetch), and the four mirror branches in `settings/payments/route.ts:100-215`.
- **`createPatientWithPhone(...)`**: the create-patient + link-phone block exists 5× with unintentionally divergent `isPrimary`/`verifiedAt` handling (`forms/standalone/.../submit`, `patient/identity`, `tasks/add-patient`, `onboarding/test-session`). Decide the flag semantics once.
- **`findAppointmentActionsByType(appointmentId, actionType)`**: the "actions → blocks → filter by type" two-step exists 6× as two round trips each; it's one join.
- **Centralise `PM_ROLES`** (duplicated in 5 PMS routes) as a `roles` option on the location gate — and note the standing rule that `clinic_owner` must ride along with `practice_manager` in every check; centralising prevents a future omission.
- Routes that re-query what the gate already returned (e.g. both `mark-transcribed` routes re-fetch the appointment for `location_id` that `requireStaffCanAccessAppointment` resolved) — thread the gate's fields through.
- Naming pass while touching these files: one 401 message, one "required" phrasing, one query-param casing, one success envelope.

### 5.2 Client fetch helper

`postJson<T>` / `getJson<T>` in `src/lib/api-client.ts` returning `{ ok, data, error }` — replaces 58 hand-rolled `fetch` POST blocks across patient and clinic components and standardises the error copy currently re-typed everywhere. The store's private `fetchJson` (`clinic-store.ts:157`) folds into it.

### 5.3 Fetcher/lib dedupe

- **One `enrichActionRows()`** shared by `fetchers/readiness.ts:385-489` and `fetchers/workflow-actions.ts:376-477` — field-for-field identical 17-field output, already drifting (readiness lacks `intake_items`/`message_template`). Readiness keeps only its grouping/priority layer; split the 460-line `fetchReadinessSlice` into fetch/hydrate/build stages while there.
- **Export the shared helpers from `readiness/derived-state.ts`** instead of the byte-for-byte private re-rolls in `fetchers/readiness.ts` (`getMostRecentActionUpdate`, `TERMINAL_STATUSES`, the retention constant).
- **One action-label source:** `getActionLabel` (`workflow-actions.ts:75-102`) delegates to `ACTION_TYPE_META[].label` (`workflows/types.ts:117-232`) rather than duplicating its strings.
- **One staff→location→org join:** the same query exists in 4 shapes (`staff-access.ts:602`, `:571`, `runsheet/queries.ts:282` (dead, see 4.5), `readiness/seed.ts:241,661`). One query function + pure shape adapters.
- **`syncPms(locationId)`** lib helper + small hook owning `isSyncing`/`syncMsg` — the "Sync now" handler (and its hand-drawn refresh SVG) is copy-pasted across runsheet, readiness, and integrations shells.
- **Base-URL fallback:** `runsheet/actions.ts:65` and `mutations.ts:146` hand-roll `NEXT_PUBLIC_APP_URL || localhost` while everything else uses `getBaseUrl()` (`lib/utils/url.ts`, which also handles `VERCEL_URL`) — nudge/invite SMS links break on Vercel previews; workflow SMS don't. Use `getBaseUrl()`.

### 5.4 UI primitive extractions (cheap, contained)

- **Merge the card-capture twins:** `card-capture.tsx` (283) and `intake-card-capture.tsx` (305) are ~95% identical; one component with an optional post-save hook and optional `roomName`.
- **`useSurveyModel(schema, onSubmit)`** + a shared submit shell: the Model + theme + `onComplete` wiring + loading/thanks screens exist 3× (`intake-journey.tsx:773-920`, `standalone-form-client.tsx:402-421`, `form-fill-client.tsx:30-94`).
- **New `ui/` primitives:** `Toggle` (5 hand-rolled switches, two competing visual designs), `Modal` (8 hand-rolled overlays, none with the Escape/focus handling `SlideOver` already has), `Spinner`, `CheckCircle`, `CopyButton`, `CloseButton`.
- **Review-panel shared parts:** `CopyButton`/`FieldRow`/skeleton/footer extracted from the three submission panels (`form-handoff-panel`, `intake-package-handoff-panel`, `standalone-submission-panel`).
- **Adoption sweep:** the long input className is hand-rolled 61× with drifting focus rings/radii while `ui/input.tsx` has 3 importers; extend it with `Textarea`/`Select`/`FormField` and sweep. Same for raw footer buttons vs `ui/button.tsx`. Mechanical but wide — do it as its own PR so the diff is reviewable.

### 5.5 Action-block editor extraction (check drift first)

`outcome-pathway-editor.tsx:260-617` and `process-flow-outcome.tsx:330-604` duplicate the entire timeline editor (~350 lines): rail, day-chip timing picker, toggle, and the four per-action-type field editors, including copy-pasted `timingLabel()`. **Before extracting, reconcile the known divergence** (the editor has `reminder_sms` for forms; the process flow doesn't — drift or intent?). Then extract `ActionBlockCard` / `ActionBlockFieldEditor` / `TimelineRail`; both files drop to ~250 lines of genuinely distinct logic. This is the one UI dedupe that touches two live editing surfaces — manual verification of both flows required.

### 5.6 Component/store decomposition (carried over from old plan 2.3/2.4, refined)

- **`intake-journey.tsx` (920 lines)** splits cleanly: phase reducer (~150 lines), `IdentityResolution` (reuse `identity-confirmation.tsx` with a pluggable `resolve(selection)` callback — the intake journey currently re-implements its contact picker character-for-character), `IntakeChecklist`, `ConsentStep`, `FormStep` (the latter two are already embedded components). Do after 1.1 and 5.4 (`useSurveyModel`) so the pieces land pre-deduped.
- **`appointment-type-editor.tsx` (726 lines):** 15 `useState` calls modelling one form → single reducer/form object; section components per `CollapsibleSection`; the two-step save (`configure` then conditional `confirm-type`, currently with no error handling on the second call) moves into one `lib/` mutation.
- **Store cleanup:** a `makeRefresh(...)` factory for the nine structurally identical refresh actions (`clinic-store.ts:215-403`, ~190 → ~40 lines); store only `roomsWithClinicians` and derive `rooms`/`paymentRooms` via selectors — `payments-settings-shell.tsx:147-191` currently has to optimistically update (and revert) three projections of the same rooms. This largely replaces old plan 2.4's slice split — do the factory first and re-evaluate whether slices are still worth it.
- **`useEnsureSlices([...])` hook** replacing the fetch-if-empty effect repeated in 8 shells; **`useSocketRoom(...)`** centralising the join-on-connect pattern (3 copies in `clinic-data-provider`, 2 in `waiting-room`); move the provider's render-body `useClinicStore.setState` (`clinic-data-provider.tsx:21-25`) into an effect.

---

## Minor / opportunistic (do when touching the file anyway)

- `onboarding/test-session/route.ts`: ~12 sequential awaits → `Promise.all` groups; use `getBaseUrl()`.
- `tasks/intake-handoff/route.ts`: parallelise journey+patient and forms+card pairs.
- `fetchRunsheetSessions` (`runsheet/queries.ts:37-43`): drop the per-request timezone round trip (pass it in or cache).
- `fetchRoomsWithClinicians` (`fetchers/rooms.ts:15`): the codebase's only `select()`-star over-fetch; 3 round trips → 1 join.
- `phone-verification.tsx:87`: stale-closure attempts counter (message shows one attempt late).
- `entry-flow.tsx:161-163`: `setTimeout(…, 0)` forced remount → `key` bump.
- `form-fill-client.tsx:96-97`: dead `styleOverrides` empty-string `<style>`.
- 17 inline `en-AU` `toLocale*String` calls across 11 component files → shared formatters (`lib/runsheet/format.ts` already exists).
- 11 `window.confirm`/`alert` destructive confirmations → the `ui/Modal` from 5.4.
- `server.ts`: factor `guardedJoin` from the `join:location`/`join:org` twins; add a `rejected` flag to the 413 path in `handleInternalBroadcast`.
- Pointless casts at `engine.ts:274,294`; snake_case projection maps duplicated 3× in workflow routes → `lib/db/projections.ts`.
- Dead docs-vs-code: `GET /api/patient/[id]` "compatibility surface" has no callers — decide keep-or-delete.

## Explicitly NOT recommended

- **Do not delete `supabase/migrations/`** — it's a documented historical archive with doc links into it; nothing operational reads it. (Verified 2026-06-10.)
- **Do not preserve the `fireActionNow` phone fallback as a path difference** — unify it into both paths deliberately (3.1). The precondition skip, by contrast, IS intentional and stays.
- **No TanStack Query / SWR migration, no Supabase Realtime adoption** — unchanged from the previous plan.
- **No test-infra beyond the Tier 3 decision** — if vitest lands, it's scoped to the workflow engine's pure functions, not a coverage programme.
- **Don't let the line-count estimate drive priority** — some duplicate UI (5.4/5.5) is cheap to leave until its behavior is pinned; bugs and data integrity come first.

## Sequencing

1. **Tier 1** — bug batch (1.1–1.4; 1.5 may ride with Tier 3). Small, independent, one PR, manual verification of intake/waiting/readiness flows.
2. **Tier 2** — transactions (`createSessions`, PMS patient+link), with 2.3 opportunistically. Verify with a forced mid-sequence failure and a re-run sync (no duplicate patient).
3. **Tier 3** — workflow engine extraction. Decide 3.4 (test infra) first; record the phone-fallback unification in the PR description. Includes 1.5 and the merge-field/timezone fixes.
4. **Tier 4** — type layer. 4.1/4.2 are one PR (`tsc` is the safety net); 4.3 renames and 4.5 dead-code deletes are mechanical; 4.4 is a 30-minute hygiene task.
5. **Tier 5** — dedupe, roughly in order 5.1 → 5.2/5.3 → 5.4 → 5.5 → 5.6, each independently shippable, UI items one at a time behind manual verification (`/verify`).

Only the Tier 4.5 deletes and the 5.4 adoption sweep are near-mechanical. Everything else alters behavior or output and ships behind verification against the running app, not just `typecheck`.
