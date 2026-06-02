# Patient panel: staged loading (fast shell + deferred history)

## Problem

Clicking a patient name in the Tasks / Readiness dashboard opens the
`PatientContactCard` slide-over, but the panel shows only a skeleton until the
full `/api/patient/:id` dossier resolves. That endpoint is a heavyweight
patient-history call — auth, demographics, phones, cards, **all** form
assignments, **all** form submissions, form-name lookups, intake journeys,
future/past/awaiting appointment buckets, an exact appointment count, sessions
per appointment, and on-demand session history — run as several sequential
waves of queries. The click cannot feel fast because "open the patient panel"
is implemented as "load the entire patient record before rendering anything".

The key insight: **the dashboard row already holds almost everything the panel
shows on first paint.** `ReadinessAppointment`
(`src/stores/clinic/types.ts:117`) already carries `patient_first_name`,
`patient_last_name`, `primary_phone`, `room_name`, `appointment_type_name`,
the full workflow `actions` timeline, `outstanding_forms`, and
`completed_form_submissions`. The expensive endpoint only *adds*:

- date of birth
- card-on-file summary
- the cross-appointment **history** timeline + total count
- (non-readiness only) the merged forms list

So in readiness mode the panel blocks on a large fetch to surface three small
fields plus history that the user rarely reads on first glance.

## Goal

Make the panel open **instantly** from data already in the dashboard row, then
progressively fill in the small missing essentials and, last, the heavy
history. No interaction should wait on the full dossier.

## Current behaviour (reference)

- `src/components/clinic/patient/patient-contact-card/index.tsx:133` — the
  whole panel renders a skeleton while `loading || !details || !details.patient`.
  Every section (demographics, appointments, workflow, forms, payment) is gated
  behind one `details` object.
- `src/app/api/patient/[id]/route.ts` — one route returns the entire dossier.
  Phases at lines 47 (auth), 55 (patient/phones/cards), 80 (form
  assignments+submissions), 100 (form names), 116 (intake journeys), 165
  (future/past/awaiting + count), 214 (sessions + on-demand). Parallel *within*
  a wave, sequential *across* waves.
- Form history at line 80 is **unbounded** — `order by created_at` with no
  limit on either `form_assignments` or `form_submissions`. A patient with a
  long history makes every click slower.

## Approach

Three independent changes, in priority order. Stage 1 + 2 deliver the felt
speed-up; stage 3 is the durability fix.

### Stage 1 — Render the shell from the row, don't block on the fetch

**Scope: readiness (appointment) mode only.** Readiness rows carry excellent
shell data — name, primary phone, room, type, workflow actions, completed
submissions. Run-sheet `EnrichedSession` carries patient names and a card
summary but **not** primary phone / DOB in the same shape, and run-sheet is a
separate workflow with its own behaviour. Do not touch run-sheet rendering in
this stage. Run-sheet can adopt the same staged model later as a follow-up once
the readiness path is proven; the existing "no change to run-sheet rendering"
constraint stands for now.

In `index.tsx`, stop gating the entire panel on `details.patient`. When we have
an `appointment` (readiness mode) we already have enough to render the panel
chrome and the high-value content immediately.

- Build a synthetic "shell" `PatientDetails`-shaped object from the
  `appointment` prop the moment the panel opens:
  - `patient.first_name` / `last_name` from `appointment.patient_first_name` /
    `patient_last_name`.
  - `patient.date_of_birth: null` (filled by the fetch).
  - `phone_numbers`: `[{ phone_number: appointment.primary_phone, is_primary: true }]`
    when present, else `[]`.
  - `payment_methods: []`, `appointments: []`,
    `total_appointment_count: 0`, `form_assignments: []`,
    `form_submissions: []`.
- **Use explicit per-section loading flags, not just the shell object.** A shell
  with empty arrays renders as "no card on file" / "no appointments" — which is
  a lie while the fetch is still in flight. So the panel must track real state:
  `summaryLoading`, `historyLoading`, `historyError` (and reuse the shell only
  as the *seed* for fields the row genuinely knows). A section shows:
  - the row's real value when it came from the shell (name, phone, workflow,
    completed forms),
  - a **skeleton** when the corresponding fetch is still loading
    (`summaryLoading` for DOB + cards; `historyLoading` for the appointments
    history + count),
  - the resolved value once the fetch lands,
  - a degraded inline note on `historyError` rather than a false "none".
- Render `DemographicsSection`, `WorkflowTimeline`, and the readiness
  `CompletedFormsList` (which already reads from
  `appointment.completed_form_submissions`, not from `details` —
  `forms-section.tsx:169`) from the shell **without waiting**.
- Sections that depend on fetched data, gated on their loading flag:
  - DOB line: inline shimmer while `summaryLoading`; show DOB or omit once
    resolved.
  - Payment section: section skeleton while `summaryLoading`; "No card on file"
    only after summary resolves with an empty list.
  - Appointments history (`appointments-section.tsx:44`): section skeleton while
    `historyLoading`; "No appointments yet" only after history resolves empty;
    inline error note on `historyError`.

Net effect: the panel paints name, phone, workflow timeline and completed forms
on click with no network wait, and every not-yet-loaded section reads as
*loading*, never as falsely empty.

**Standalone-row patient clicks need a seed too (otherwise Stage 1 misses
them).** Standalone form rows open the contact card via
`onPatientDetail(null, row.patient_id)` (`readiness-table.tsx:161`) — i.e.
`appointment: null`, so they get **no** readiness shell and fall back to the
full-dossier wait. To cover every Tasks patient-name click, add a generic `patientSeed` prop to
`PatientContactCard` — a **typed object**, not loose props:

```ts
interface PatientSeed {
  id: string;
  firstName: string;
  lastName: string;
  primaryPhone?: string | null;  // standalone rows have no phone — omit
}
// PatientContactCard prop:
patientSeed?: PatientSeed | null;
```

The standalone list query **already selects** `patients.first_name, last_name`
(`src/app/api/forms/standalone/submissions/route.ts:70`) — it just collapses
them into `patient_name` at lines 110–112. So carry `first_name` / `last_name`
through to `StandaloneSubmissionRow` separately (a one-line shape change, no new
join) rather than splitting a display string. Thread the row's
`{ patient_id, first_name, last_name }` through `onPatientDetail` and build the
typed seed at the call site (`readiness-table.tsx:161`). If a future row only
has a display name, a split-with-fallback is acceptable, but the standalone case
should use the real first/last.

The panel's shell-builder takes its fields in priority: `appointment`
(readiness) → `patientSeed` (standalone / generic) → empty. A standalone seed
has name but no phone, so the contact section shows a skeleton (not a false "no
phone") until summary lands. This keeps Stage 1's "instant header" guarantee for
**all** Tasks rows, not just appointment rows.

### Stage 2 — Split the endpoint into `summary` + `history`

Replace the one heavyweight call with two, fetched in parallel from the panel
so the small one paints first.

1. **`GET /api/patient/:id/summary`** — the fast essentials. Returns only:
   - `patient` (id, first/last name, **date_of_birth**)
   - `phone_numbers`
   - `payment_methods`

   This is the existing first wave at `route.ts:55` — three indexed
   single-patient lookups, already parallel. It is small and fast. The panel
   uses it to fill DOB, the contact list (authoritative over the row's single
   `primary_phone`), and the payment section.

2. **`GET /api/patient/:id/history?appointment_id=&session_id=`** — the heavy
   timeline. Everything from `route.ts:80` onward: form assignments/submissions
   (now bounded — see stage 3), form names, intake journeys, appointment
   buckets + count, sessions, on-demand history, active-row hoisting. This is
   the slow part and now loads **after** the panel is already usable.

**Define the two response shapes explicitly** so client merging is predictable
and neither route drifts from the old full payload:

- `summary` returns **exactly** `{ patient, phone_numbers, payment_methods }`.
- `history` returns **exactly**
  `{ appointments, total_appointment_count, form_assignments, form_submissions }`.

Their union equals today's full `PatientDetails`. No field appears in both. The
existing full `GET /api/patient/:id` returns the union of the two (for callers
that still want one shot).

Both routes share auth (`assertStaffCanAccessPatient`) and the service client.
Factor the shared phase helpers (`fetchAppointmentById`,
`fetchOnDemandSessionById`, bucketing) into a small module so both routes and
the existing full route can use them.

**Explicit trade-off — auth runs twice.** Two routes means
`assertStaffCanAccessPatient` (auth + staff-assignment lookup) runs once per
route, doubling that work on first open. This is acceptable *because the shell
already painted* (Stage 1) — the auth cost is now off the critical render path
for both fetches, which run in parallel. Accept the duplication for now; if it
shows up as noise in timings, the fallback (in order of preference) is:
  1. one route `GET /api/patient/:id?part=summary|history` that authenticates
     once and branches on `part`, or
  2. a shared lower-level cached access helper.
Do **not** weaken or skip auth on either route to save the lookup.

**Keep `GET /api/patient/:id`** as-is for any caller that needs the whole
dossier up front (audit it — run-sheet contact card may be the only one). It
can be reimplemented as `summary` + `history` merged server-side, or left
untouched. Do not break it.

Panel wiring in `index.tsx`:
- On open: set the shell (stage 1), fire **both** fetches in parallel.
- Merge `summary` into `details` as soon as it lands (DOB, phones, cards).
- Merge `history` into `details` when it lands (appointments,
  counts, forms).
- The 30s `patientDetailsCache` becomes two caches (or one keyed by route).
  Cache `summary` and `history` independently so reopening is instant and a
  history refresh doesn't refetch demographics.

**Merge + race safety (required).** With three async inputs (shell, summary,
history) folding into one `details` object, two hazards must be handled:
- **Merge preserves the other fields.** Because the shapes are disjoint
  (above), merge by spreading onto the *current* state functionally —
  `setDetails(prev => ({ ...(prev ?? shell), ...summary }))` and likewise for
  history — never by replacing `details` wholesale. Each merge keeps the shell
  seed and whatever the other request already wrote.
- **Cancel/ignore stale responses.** A quick click from patient A → patient B
  must not let A's late response overwrite B. Tag each open with a request key
  (the resolved patient-id + query string, or a monotonically increasing
  counter captured in the effect closure) and, in each `.then`, drop the result
  if the key no longer matches the current open — same discipline as the
  existing `cancelled` flag (`index.tsx:73`), extended to both fetches
  independently. The effect cleanup must invalidate the key so unmount/reopen
  can't apply a prior fetch.

### Stage 3 — Bound history queries + add composite indexes

Even after splitting, the `history` route must stay fast for patients with long
records.

- **CAVEAT — bounding can hide the active appointment's forms (must fix
  before adding any limit).** In non-readiness/run-sheet mode,
  `CompletedFormsList` builds a *patient-wide* form list and **then** filters to
  `session.appointment_id` (`forms-section.tsx:211`). A naive global
  `.limit(25)` on `form_assignments` / `form_submissions` ordered by
  `created_at desc` would drop the active session's *older* form whenever the
  patient has 25 newer forms from other appointments — the panel would show
  nothing for the very appointment being processed.

  Fix the query shape **before** introducing any limit: fetch in two parts and
  union client-side:
  1. **Active-appointment forms, unbounded** — `form_assignments` +
     `form_submissions` filtered by the active `appointment_id` (when known).
     These always survive.
  2. **Bounded recent history** — the remaining patient-wide reads, limited
     (e.g. 25 each, `created_at desc`), for the "earlier forms" context.

  Merge + dedupe by `submission_id` as today. The panel still renders the most
  recent 10 (`forms-section.tsx:221`), but the active appointment's forms can
  no longer fall outside the window. Expose a "+N earlier" affordance if the
  bounded history truncated. (Readiness mode is unaffected — it reads from the
  row's `completed_form_submissions`, not this list.)
- **Add composite indexes** matching the hot ordered/filtered shapes, **partial
  where the query is always-filtered**. Appointment history always excludes
  cancelled, so partial indexes are tighter and smaller. Existing indexes are
  single-column only (`idx_appointments_patient_id`,
  `idx_appointments_scheduled_at`, `idx_form_assignments_patient_id`,
  `idx_form_submissions_patient_id`). New migration:

  ```sql
  -- Appointment history: filter patient_id, exclude cancelled, order scheduled_at.
  -- Partial: every history read carries `status <> 'cancelled'`.
  CREATE INDEX IF NOT EXISTS idx_appointments_patient_scheduled_active
    ON appointments (patient_id, scheduled_at DESC)
    WHERE status <> 'cancelled';
  -- Awaiting-scheduling bucket: scheduled_at IS NULL, ordered by created_at.
  CREATE INDEX IF NOT EXISTS idx_appointments_patient_awaiting
    ON appointments (patient_id, created_at DESC)
    WHERE scheduled_at IS NULL AND status <> 'cancelled';
  -- Form history ordered reads (patient-wide branch).
  CREATE INDEX IF NOT EXISTS idx_form_assignments_patient_created
    ON form_assignments (patient_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_form_submissions_patient_created
    ON form_submissions (patient_id, created_at DESC);
  -- Latest-session-per-appointment lookup.
  CREATE INDEX IF NOT EXISTS idx_sessions_appointment_created
    ON sessions (appointment_id, created_at DESC);
  ```

  Note the partial-index predicate must match the query's WHERE clause exactly
  (`status <> 'cancelled'`, written the same way) for the planner to use it —
  confirm with `EXPLAIN ANALYZE` against seeded data before/after. The
  active-appointment form reads (per-appointment filter) are covered by the
  Part-2 `idx_form_submissions_appointment_created` index below.

  **Sequencing:** Stage 3 ships **after** confirming query timings from the
  endpoint split (Stage 2) — don't add limits/indexes speculatively. Migration
  022 is already pending apply on this branch (`project_simplification_branch`)
  — sequence the new migration after it and apply both together.

## Out of scope / non-goals

- No change to the patient entry flow.
- Run-sheet **shell** (the Stage-1 instant-header treatment) stays out of scope
  for Part 1 — run-sheet adoption of the staged shell is a separate follow-up.
  (Part 3 / Stage 7 does add the missing run-sheet *workflow data*, which is a
  functional fix, not the shell.)
- The readiness fetcher's action-assembly logic is *reused* by Stage 7 (factored
  into a shared helper), but its row-building output is otherwise unchanged.
- The full `GET /api/patient/:id` endpoint is preserved for compatibility.

## Verification

1. Readiness panel opens with name, phone, workflow, and completed forms
   visible **before** any network round-trip completes (throttle network in
   devtools to confirm).
2. DOB + card appear shortly after (summary fetch); history fills last.
3. Reopening the same patient within 30s is instant from cache.
4. A patient with a large synthetic history (100+ appointments, 50+ forms)
   opens as fast as one with few — confirm via the bounded queries + new
   indexes (`EXPLAIN ANALYZE` shows index scans, not sorts over full sets).
5. Error path: with the history route failing, the shell + summary still
   render; only the history section shows a degraded note.
6. `npm run lint` and a typecheck pass; existing run-sheet contact-card usage
   unaffected.

---

# Part 2 — Completed-form review panels ("Review" / form-completed click)

## Problem

Clicking **Review** (or a `form_completed` row) in the Tasks dashboard opens one
of three slide-overs, each of which shows a 4-line shimmer with **no content**
until its fetch resolves, and each fetches only on open (no prefetch):

- `FormHandoffPanel` (`src/components/clinic/forms/form-handoff-panel.tsx`) —
  single deliver_form submission. Fetches `/api/readiness/form-submission`
  (auth → submission row → form schema → `extractFieldsFromSchema`). Already
  takes the `submission_id` fast path when the row knows it
  (`readiness-shell.tsx:172`).
- `IntakePackageHandoffPanel`
  (`src/components/clinic/forms/intake-package-handoff-panel.tsx`) — multi-form
  intake package. Fetches `/api/readiness/intake-handoff` (auth → appointment →
  appointment_actions → workflow_action_blocks → journey → form_submissions →
  per-form schemas). The heaviest of the three; several dependent waves.
- `StandaloneSubmissionPanel`
  (`src/components/clinic/forms/standalone-submission-panel.tsx`) — public/SMS/QR
  standalone submission. Fetches `/api/forms/standalone/submissions/:id`
  (auth → submission detail → org-access check).

The same root cause as Part 1: the panel withholds **all** content (including
the header chrome it already has data for) until the whole field-extraction
round-trip completes. The dashboard row already carries everything needed to
paint the panel header instantly — `ReadinessAppointment.completed_form_submissions`
(`src/stores/clinic/types.ts:109`) gives `submission_id`, `form_name`,
`completed_at`, and `source` per submission. Only the **field values** require
the fetch.

## Approach

### Stage 4 — Render the review header from the row; shimmer only the fields

In all three panels, split the loading state so the **header** (form name,
patient name, submitted-at) renders immediately from props/row data, and only
the **field list** body shows the shimmer.

- `FormHandoffPanel` already receives `formName` and `patientName` as props, and
  the row knows `completed_at`. Pass `submittedAt` (the row's `completed_at`)
  in as a prop so the header timestamp paints without waiting for
  `data.submitted_at`. Keep the fetched `submitted_at` as the authoritative
  override once it lands. Only the field list keeps its shimmer.
- `IntakePackageHandoffPanel` — header already uses the `patientName` prop. For
  the submitted timestamp, the panel currently uses `payload.action.completed_at`
  (the completed **intake action**, `intake-package-handoff-panel.tsx:129`),
  **not** a per-form submission time — correctly, since a package can contain
  multiple forms with differing per-form `completed_at`. So the seed must be the
  intake action's completion time, not a `completed_form_submissions` entry. The
  readiness row exposes this via the matched `intake_package` action
  (`appt.actions.find(a => a.action_type === "intake_package" && a.status === "completed")`,
  already located at `readiness-shell.tsx:159`) — pass that action's
  `fired_at`/completion time through as the seed. Body shimmer stays.
- `StandaloneSubmissionPanel` — pass the row's `form_name`, `patient_name` and
  `created_at` from `standaloneSubmissions` (the store already has them) into
  the panel as optional seed props, so the custom header renders before the
  detail fetch returns instead of showing "—". The fetched `detail` overrides
  once present. **Note the field name:** `StandaloneSubmissionRow` has
  `created_at`, not `completed_at` (`src/stores/clinic/types.ts:70`; the list
  API returns `created_at` at `src/app/api/forms/standalone/submissions/route.ts:123`).
  Use `created_at` as the submitted-timestamp seed — it maps to the panel's
  `detail.created_at` (`standalone-submission-panel.tsx:166`).

No API change, shippable alone — same pattern and risk profile as Stage 1.

### Stage 5 — Prefetch field data on intent (hover / pointer-down)

The felt latency is the field-extraction round-trip. Warm it before the click
resolves.

- Add a small client-side cache (mirror `patientDetailsCache` —
  `index.tsx:13`) keyed by the fetch URL, with a short TTL (~30s), shared by the
  three panels' loaders.
- In `ReadinessTable` / the row's Review affordance, fire the matching fetch on
  `onMouseEnter` / `onPointerDown` of the Review control and store the promise
  in the cache. On panel open, the loader reads the in-flight (or resolved)
  promise from the cache instead of starting a fresh request — so by the time
  the slide-over animates in, fields are often already present.
- Guard prefetch: only for rows whose action is genuinely reviewable
  (`form_completed_needs_transcription`, completed `deliver_form` /
  `intake_package`, or a pending standalone submission), and only when the
  `submission_id` / `appointment_id` is known. Don't prefetch on every row
  hover indiscriminately — debounce and cap concurrent prefetches.

### Stage 6 — Tighten the review endpoints

- **`/api/readiness/form-submission`** — the `submission_id` fast path
  (`route.ts:31`) is good; ensure the dashboard **always** supplies it for
  `deliver_form` rows (it does for matched submissions —
  `readiness-shell.tsx:172` — but the fallback name-match path
  `route.ts:64` runs a list query + `forms.in(...)` when `submission_id` is
  absent). Audit whether any reviewable row reaches the panel without a
  `submission_id`; if so, include it in the readiness fetcher payload so the
  fast path always applies.
- **`/api/readiness/intake-handoff`** — the per-form lookups are **already
  batched** (`forms.in(formIds)` + `form_submissions.in(formIds)`), so schemas
  are not the bottleneck — no N+1 to fix there. The remaining latency is the
  inherent dependent sequence: auth → appointment → `appointment_actions` →
  `workflow_action_blocks` → journey → submissions. Don't over-optimise this;
  the felt win comes from Stage 4 (instant header) + Stage 5 (prefetch on
  intent), which hide this sequence behind the panel animation. Leave the route
  shape as-is unless timings flag it.
- Add a composite index supporting the by-appointment submission reads used by
  both endpoints (folds into the Stage 3 migration):

  ```sql
  CREATE INDEX IF NOT EXISTS idx_form_submissions_appointment_created
    ON form_submissions (appointment_id, created_at DESC);
  ```

## Verification (Part 2)

1. Clicking Review paints the panel header (form name, patient, submitted time)
   with **no** network wait; only the field list shimmers.
2. With hover-prefetch enabled, fields are frequently already present when the
   slide-over finishes animating in (throttle network to confirm the prefetch
   fires on hover, not on click).
3. Reopening the same submission within the TTL is instant from cache.
4. The intake-package panel (heaviest) opens with header instant; field data
   arrives via prefetch where possible.
5. `npm run lint` + typecheck pass; the three panels' transcribe/review actions
   still work unchanged.

---

# Part 3 — Run-sheet patient card has no workflow timeline (functional gap)

## Problem

This is a **missing-data bug**, not a performance issue, but it lives in the
same component and shares the same fix surface, so it belongs here.

Opening the patient card from the **run sheet** never shows the Workflow
section. The run sheet renders `PatientContactCard` with `session` +
`patientId` but **no `appointment` prop** (`runsheet-shell.tsx:459`). The card
derives `isReadinessMode = !!appointment` (`index.tsx:43`), and `WorkflowTimeline`
only renders `if (isReadinessMode && appointment)` (`index.tsx:175`). So on the
run sheet the timeline is structurally unreachable.

Root cause: workflow actions hang off the **appointment**, assembled by the
readiness fetcher (`fetchReadinessSlice` joins `appointment_actions` →
`workflow_action_blocks` per appointment — `fetchers/readiness.ts:90`). The run
sheet query (`RunsheetSession` / `EnrichedSession`, `custom-types.ts:104`)
carries `appointment_id` but **no actions** — nothing fetches them for the
run-sheet card. The data simply isn't loaded, so the section can't render.

Scope it by **data**, not tier label: the card should load workflow actions for
the **active `appointment_id`** whenever the session has one. An appointment
with no workflow actions (Core, telehealth-only, or unconfigured) simply yields
an empty array and the section stays hidden — no need to branch on a tier flag.
On-demand sessions (no `appointment_id`) skip the fetch entirely.

## Approach

### Stage 7 — Load workflow actions for the run-sheet card (active context, not history)

Workflow is **active-appointment context**, so it must **not** wait on the heavy
deferred `history` payload — that would make workflow visibility hostage to the
slowest fetch. Put it on the fast path:

- Surface it as a **small active-context fetch** keyed on the active
  `appointment_id`, parallel with (and as light as) `summary`. Either:
  - a dedicated `GET /api/patient/:id/active-context?appointment_id=…` returning
    just `{ workflow_actions }`, or
  - fold `workflow_actions` into the **`summary`** response when an
    `appointment_id` is supplied.

  Either way it resolves on the fast path, gated by its own `summaryLoading`
  (or an `activeContextLoading`) flag — never `historyLoading`.
- **Narrow, patient-scoped helper.** Extract
  `fetchAppointmentWorkflowActions(supabase, appointmentId, patientId)` rather
  than importing the readiness fetcher's row shape. It filters by **both**
  `appointment_id` **and** the authorised `patient_id`, so a caller-supplied
  `appointment_id` can't pull another patient's workflow (same access-control
  discipline as `fetchAppointmentById` — `route.ts:470`). It does the
  `appointment_actions` + `workflow_action_blocks` assembly and the
  `getActionLabel` mapping (`fetchers/readiness.ts:473`), returning
  `WorkflowAction[]` (`types.ts:73`). The readiness fetcher is refactored to
  call the same helper so there's one assembly path, not two.
- **Pass actions directly into a dumb component.** `WorkflowTimeline` currently
  takes a `ReadinessAppointment` and reaches into `appointment.actions`.
  Change it to accept an `actions: WorkflowAction[]` prop and nothing else, so
  it has no knowledge of readiness vs run-sheet. Both call sites pass their
  array: readiness passes `appointment.actions`; the card passes the fetched
  `workflow_actions`. No mode branching inside the component, and `index.tsx`
  renders the section whenever the array is non-empty (it already returns `null`
  on empty — `forms-section.tsx:25`), independent of `isReadinessMode`.

(Run-sheet adoption of the Stage-1 shell is still a separate follow-up; Stage 7
only adds the missing *data* + decouples the component, so the run-sheet card
finally has a workflow section at all — and it appears on the fast path.)

### Verification (Part 3)

1. Open a run-sheet patient card for an appointment with a pre-appointment
   workflow → the Workflow section appears (on the fast path, not gated behind
   history) with the same timeline the readiness card shows for that appointment.
2. On-demand sessions (no `appointment_id`) and appointments with no workflow
   actions show no Workflow section (no empty shell, no error).
3. A caller passing another patient's `appointment_id` gets no actions — the
   helper's `patient_id` filter rejects it.
4. Readiness card workflow timeline is unchanged (now via the shared helper,
   same `WorkflowAction[]` shape).
4. No extra round-trip — the actions ride on the existing `history` fetch.

## Suggested commit sequence

1. Stage 1 (patient panel shell, **readiness mode only**, explicit per-section
   loading states) — immediate felt win, no API change.
2. Stage 4 (review panel headers from row, with correct `created_at` seed for
   standalone) — felt win, no API change.
3. Stage 2 (patient endpoint split + parallel fetch; auth runs twice by design).
4. Stage 5 (review field prefetch on intent).
5. Stage 3 (active-appointment-safe bounded queries + partial-index migration)
   — **after** confirming Stage 2 timings, with the active-appointment
   form-history caveat fixed before adding any limit.
6. Stage 6 (review endpoint tightening; folds its
   `idx_form_submissions_appointment_created` index into Stage 3's migration).

7. Stage 7 (run-sheet workflow timeline) — functional fix on the **fast/active-
   context path** (a light `appointment_id`-keyed fetch alongside `summary`),
   **not** the deferred `history` payload. Ships with the endpoint work
   (alongside Stage 2) but does not depend on `history`; the
   `WorkflowTimeline` decoupling (dumb `actions[]` prop) can land independently
   and early.

Stages 1 and 4 are the cheapest, lowest-risk, highest-felt-impact and ship
first together. Stages 2/5/7 are the next layer (Stage 7 on the fast path, not
behind history); Stages 3/6 are the durability work, deferred until timings
justify the index/limit changes. Run-sheet mode adopting the staged *shell* is a
separate follow-up, not in this plan — but the run-sheet *workflow data* gap
(Stage 7) is fixed here.
