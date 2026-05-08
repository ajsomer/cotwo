# Patient contact slide-out refresh + form submission PDF + auth gap closure

**Date:** 2026-05-08

## Context

The user wanted two changes to the patient contact slide-out: (1) replace the readiness-only "Completed Forms" review/handoff section with a simpler list that opens a PDF of the submission, and (2) collapse the three overlapping appointment-related sections (`Appointment` / `Today's session` / `Visit history`) into a single unified timeline.

What started as a UX cleanup turned into a multi-pass plan + implement loop with three rounds of review feedback. Two things kept escalating scope:

1. The slide-out's data path (`/api/patient/[id]`) and the existing form-submission JSON route (`/api/forms/submissions/[id]`) both used `createServiceClient()` with no auth — guessable-ID PHI exposure. The refresh expanded what those routes return, so closing the gap had to ride along.
2. The "active row" in the new unified appointments timeline (the row corresponding to the run-sheet session or readiness dashboard row the slide-out was opened from) had to survive a 10-row cap, work for on-demand sessions without an `appointment_id`, and not leak data across patients via the new query params.

Final commit not yet pushed at the time of writing — implementation, two review rounds, and a third round of fixes all landed across a single pending diff.

## Plan-first

Wrote `docs/specs/patient-contact-card-refresh-plan.md` before any code. It went through four review iterations before implementation:

- Round 1 caught: the forms data source was incomplete (intake-package submissions skip `form_assignments` entirely, so the existing readiness `deliver_form`-only filter silently hides them); the PDF route's auth couldn't lean on "service-role auth" hand-waving; the existing JSON submission route's payload was insufficient for the PDF; the appointments-merge needed to query `appointments` directly with timezone awareness.
- Round 2 caught: `appointment_types.modality`, not `appointments.modality`; expanding intake-package action rows to one row per form would corrupt the workflow-timeline and readiness state-derivation pipeline; bucketing-around-midnight needs a real timezone path; on-demand session active-row matching needed `session_id`, not `appointment_id`; the cap had to be applied after sort+merge, not at SQL level; PDF disposition needed to be one consistent thing across surfaces.
- Round 3 caught: the existing JSON submission route also needs auth (same exposure shape as the PDF route); the intake-package submission query should filter on `journey.form_ids` (the configured list), not `forms_completed` (the JSONB completion map) — otherwise rows with missing JSONB entries silently vanish.
- Round 4 caught: `completed_at` resolution should be spelled out per source, on-demand session synthesis needs `s.location_id` + `locations.timezone` + `s.room_id` joined; `total_appointment_count` must include on-demand rows; date library limits — no `date-fns-tz` in the repo, must hand-roll with `Intl.DateTimeFormat({ timeZone })`; `created_at` and `location_timezone` should appear on the response shape so the client can re-derive labels across midnight.

Final plan: 1100 lines. After that the build was almost mechanical.

## What shipped

### Piece 1 — Auth helper

`src/lib/auth/staff-access.ts` — two exported functions:

- `requireAuthenticatedUser()` — SSR cookie auth check, returns user ID or 401. Critical: must be called *before* any service-role lookup of the resource ID, otherwise unauthenticated callers can distinguish valid IDs (401, "exists, log in") from invalid ones (404, "not found"). Found this gap during round-2 review of the round-1 implementation, where the submission route was looking up `form_submissions` with the service client first, then calling the helper. Re-ordered both routes.
- `assertStaffCanAccessPatient(serviceClient, patientId)` — cookie auth → service-role patient lookup → `staff_assignments` join through `locations.org_id`. Returns 401 (no user), 404 (patient missing OR org mismatch — same status to avoid existence leak), or `{ ok: true, userId, orgId }`.

### Piece 2 — `/api/patient/[id]` rewrite

Old shape: `current_session` + `visit_history` + `form_assignments`. New shape: `appointments` (unified past/today/upcoming/awaiting_scheduling), `total_appointment_count`, `form_assignments` (now with `appointment_id`), `form_submissions` (new). Plus auth gate at the top.

Candidate fetching:

- Three separate queries — future (scheduled_at ≥ now, asc, limit 15), past (scheduled_at < now, desc, limit 15), awaiting (scheduled_at IS NULL, by created_at desc, limit 5). Round-2 review caught that "past + null" combined would queue null rows behind every past row before the limit, hiding awaiting-scheduling from the candidate set whenever a patient had >15 past appointments.
- On-demand sessions (`sessions.appointment_id IS NULL`) via `session_participants` joined to `sessions` + `locations` + `rooms`. Synthetic rows with `appointment_id: null`, `session_id: s.id`, `type_name: 'On-demand'`, `modality: 'telehealth'`. Bucketed by `session_started_at ?? created_at`.
- `total_appointment_count` includes on-demand rows. Computed from the candidate-set length when both queries returned under their limits, else from a separate `head: true` count plus the on-demand count from the `session_participants` query.

Bucketing:

- Per-row `location_timezone` baked into the response. Bucketing uses `Intl.DateTimeFormat({ timeZone, year/month/day })` to compute calendar-day triples and compare them — never `Date#setHours` or `Date#getDate`, both of which silently use `process.env.TZ`. Helper at `src/lib/datetime/timezone-bucket.ts`. Fallback timezone is `Australia/Sydney` for the rare row with `location_id IS NULL`.
- Appointment-driven rows with `scheduled_at IS NULL` always go to `awaiting_scheduling` regardless of `created_at`. On-demand sessions can land in `today` via the `session_started_at ?? created_at` placement.

Within-bucket sort: upcoming asc, today asc by scheduled_at then by created_at for untimed, past desc, awaiting most-recently-created. Then concatenate buckets in display order (upcoming → today → past → awaiting), then slice 10.

### Piece 3 — Active-row preservation (the painful part)

The slide-out passes `appointment_id` (readiness mode) and `session_id` (run-sheet mode, or just session_id for on-demand) as query params. The API has to ensure the row matching either of those is in the final 10, even if it'd otherwise be dropped (e.g. patient with 14 future bookings, the active one is #11).

Round-2 implementation: prepend the active row to the whole list, drop the last row.

Round-3 review caught two things wrong with that:

1. **PHI leak across patients.** A staff user authorised for patient A could pass `?appointment_id=B-row` and the service-role `fetchAppointmentById` would happily return B's row metadata regardless of who B was. Same with on-demand sessions. Even though `assertStaffCanAccessPatient` had verified the slide-out's `patientId` belongs to the staff's org, the *force-include lookup* didn't carry that constraint forward.

   Fix: `fetchAppointmentById` takes `patientId` and adds `.eq("patient_id", patientId)`. `fetchOnDemandSessionById` takes `patientId` and does an explicit `session_participants.patient_id = patientId` membership check before the session lookup. A request with someone else's ID returns null without leaking row metadata.

2. **Bucket order violation.** Prepending to the whole list could put a past row above upcoming rows. The bucket display order has to win.

   Fix: two paths. (a) If the active row isn't in any bucket at all, force-fetch it (via the now-scoped helpers), `unshift` it into its own bucket, re-assemble buckets in display order, slice 10. (b) If it was in a bucket but past position 9, find the right insertion point in the sliced list (just before the first row of a later bucket) using `findBucketInsertionIndex`, splice it in, re-slice.

### Piece 4 — Form submission PDF route

`src/app/api/forms/submissions/[id]/pdf/route.tsx` — new. Uses `@react-pdf/renderer` for real `application/pdf` output, `Content-Disposition: inline` (open in new tab, browser viewer lets the user download/save).

Auth: `requireAuthenticatedUser()` first (no service-role lookup yet), then service-role submission lookup, then `assertStaffCanAccessPatient(serviceClient, submission.patient_id)`. 401 → 404 progression matches the JSON route.

Data path:

- Schema source: prefer `form_assignments.schema_snapshot` (taken at send time), fall back to `forms.schema` for intake-package submissions which have no assignment row. Footer note appears on the PDF when the fallback was used: "Rendered from the form's current schema (assignment-level snapshot was unavailable)."
- Renders: org logo + name header, form title, patient name + DOB, submitted timestamp, walked Q&A, footer with `form_id` + `submission_id` for traceability.

Answer normaliser at `src/lib/forms/format-answer-pdf.ts`. Separate from the existing `extractFieldsFromSchema` (which is for the readiness transcription handoff and produces flat copy-paste text). Rules:

- Empty/null/empty-array → em dash
- Boolean → "Yes" / "No"
- Date strings → `en-AU` formatted ("12 Apr 2026")
- Single-select (radio/dropdown/boolean) → label, not value
- Multi-select (checkbox/tagbox) → bulleted list
- Matrix → sub-table of row-label → cell-answer
- Object/composite → labelled sub-rows
- File uploads → omitted in v1, label-only placeholder ("file attached — view in Coviu")

Filename slugification: `{patient-last-name}-{form-name}-{yyyymmdd}.pdf`.

### Piece 5 — JSON submission route auth

`src/app/api/forms/submissions/[id]/route.ts` — added `requireAuthenticatedUser` first, then `assertStaffCanAccessPatient`. Response shape preserved exactly — every existing caller continues to work.

### Piece 6 — Readiness fetcher: `completed_form_submissions`

Added a new sibling array on `ReadinessAppointment` (typed via `CompletedFormSubmission` in `src/stores/clinic-store.ts`) populated by two scoped queries unioned by `submission_id`:

1. `form_assignments` joined by `appointment_id` where `status = 'completed' AND submission_id IS NOT NULL` — covers `deliver_form` action submissions.
2. `form_submissions` filtered by `(appointment_id, form_id)` pairs from each `intake_package_journeys.form_ids` — covers intake-package submissions, which write directly to `form_submissions` without an `form_assignments` row (see `src/app/api/intake/[token]/complete-item/route.ts:76-84`).

Filter on `form_ids` (the configured list), not `forms_completed` (the JSONB completion map). Round-3 review caught that filtering on the JSONB would silently hide submissions where the per-form timestamp wasn't populated. The JSONB only drives `completed_at` resolution: `forms_completed[form_id] ?? form_submissions.created_at`.

`appointment.actions` is left untouched — it drives the workflow timeline and readiness state-derivation pipeline at `src/lib/clinic/fetchers/readiness.ts:264`. Earlier plans had me expanding intake-package actions to one row per form, which would have broken that.

Round-3 polish: had to top up `formMap` with form IDs from journey rows that weren't in `allFormIds` (assignment-block + action form_ids). Without that, intake-package submissions rendered with `form_name: "Form"` instead of the real name.

### Piece 7 — Slide-out rewrite

Component: `src/components/clinic/patient-contact-card.tsx`. Substantial rewrite:

- New `PatientDetails` type matching the rewritten API.
- Three old appointment-related sections (`Appointment`, `Today's session`, `Visit history`) replaced with a single unified `Appointments` section. Active-row hoisted to top of its bucket on the client (independent of the server hoist — server hoists for inclusion in the slice, client hoists within bucket for visual emphasis). Active row renders the existing run-sheet detail block (StatusBadge + modality). Other rows are static.
- New `Completed forms` section. One row per submission (de-duplicated across `form_assignments` + `form_submissions`). Single "View" button opens `/api/forms/submissions/[id]/pdf` in a new tab. Hover shows full submitted timestamp.
- Dropped the legacy run-sheet "Forms" section (status badge + Resend button per assignment) — read-only slide-out, resend stays on the readiness dashboard which is the canonical surface for outstanding-form chasing.
- Dropped `onOpenFormHandoff` prop. Updated `readiness-shell.tsx` to stop passing it. The readiness shell's own form-handoff panel still exists as a separate surface; the slide-out just doesn't fork into it anymore.
- Run-sheet on-demand session (`session.appointment_id IS NULL`): falls back to standalone-mode forms list (most-recent 10 patient-wide). Spec called this out specifically.

Display polish (round-2 fixes):

- "Upcoming" tag only when `scheduled_at` is within the next 7 days, not on every future row.
- Modality renders on upcoming rows in addition to active rows. Suppressed on past/awaiting to keep history compact.
- Hover timestamps on completed-form rows.

Error handling (round-2 fix): the original implementation did `fetch(url).then((res) => res.json()).then(setDetails)` regardless of HTTP status. On 401/404 the JSON would be `{ error: "..." }` and rendering `details.patient[0]` would crash. New flow: check `res.ok`, set `fetchError` state with status-specific copy, render an error pane instead of trying to dereference `details.patient`. Cancellation flag prevents late state writes after unmount.

## Bugs surfaced by this work

### `appointment.actions` `deliver_form`-only filter was hiding intake-package submissions

The original "Completed Forms" section in the slide-out filtered `appointment.actions` by `action_type === 'deliver_form'`. Intake-package submissions don't appear as separate `deliver_form` actions — they live inside the `intake_package` action and surface only through the journey's `forms_completed` JSONB. So the old slide-out silently omitted every intake-package form submission. Fixed by switching to the new `completed_form_submissions` array, which surfaces both sources.

### `/api/patient/[id]` and `/api/forms/submissions/[id]` had no auth

Both routes used `createServiceClient()` directly with no cookie check. PHI leak: anyone hitting the URL with a guessable UUID got the patient profile or the form responses. The slide-out is the only consumer of both, so it never showed up in normal browsing — but the URLs weren't behind any gate. Closed.

### `sessions.appointment_id` is not unique

The schema allows multiple sessions per appointment (started, abandoned, fresh one created). My initial draft used `LEFT JOIN sessions s ON s.appointment_id = a.id`, which produces duplicate appointment rows. Replaced with a separate `sessions` fetch + `latestSessionByAppt` map keyed by `appointment_id`, picking the most recent session per appointment. Plan section called this out explicitly after round-2 review.

### Form name lookup gap for intake-package submissions

`formMap` was built from `formIds` (workflow_action_blocks form_ids) + `actionFormIds` (appointment_actions form_ids). Intake-package submissions reference forms via the journey's `form_ids` — neither path. Resulting rows rendered `form_name: "Form"`. Fixed by topping up `formMap` with any unseen IDs from journey rows before the grouping loop.

## What was reverted along the way

- Schema migration for the round-1 forms data approach. Round-2 review redirected to `completed_form_submissions` as a sibling array on the readiness payload, so no schema change was needed.
- `expand intake-package actions to one row per form`. Same review caught that this would corrupt the workflow timeline and state derivation. Replaced with the sibling-array approach.
- `Content-Disposition: attachment` for readiness mode and `inline` for run-sheet mode. The user simplified it: just `inline` everywhere. User can save from the browser viewer if they need to attach to a PMS.
- `onOpenFormHandoff` prop on `PatientContactCard`. Slide-out is read-only; transcription handoff stays on the readiness dashboard's own panel.

## What was deferred

- File upload rendering inside PDFs. v1 shows a label-only placeholder ("file attached — view in Coviu"). Storage signing for inline file content adds work; not blocking for v1 since the prototype's SurveyJS forms don't include file uploads anyway.
- "Show all" expansion on the appointments list. Defaulted to showing 10 with a `+ N earlier appointments` non-actionable footer when truncated.
- Per-clinic locale on date formatting in the PDF. Hardcoded to `en-AU` (matches the rest of the codebase). Normaliser accepts a parameter; pass-through if a locale field is ever added to the patient or org model.
- `assertStaffCanAccessPatient` helper extraction. Three routes now do the same SSR-auth + staff-org-membership flow. Plan suggested extracting after the third copy; ended up doing exactly that (`requireAuthenticatedUser` + `assertStaffCanAccessPatient` in `src/lib/auth/staff-access.ts`).

## Files touched

New:

- `src/lib/auth/staff-access.ts`
- `src/lib/datetime/timezone-bucket.ts`
- `src/lib/forms/format-answer-pdf.ts`
- `src/app/api/forms/submissions/[id]/pdf/route.tsx`
- `docs/specs/patient-contact-card-refresh-plan.md`

Modified:

- `src/app/api/patient/[id]/route.ts` — auth + complete payload rewrite + active-row hoist + force-include with patient scoping
- `src/app/api/forms/submissions/[id]/route.ts` — auth, response shape preserved
- `src/lib/clinic/fetchers/readiness.ts` — `completed_form_submissions` enrichment + form_name top-up from journey form_ids
- `src/stores/clinic-store.ts` — `CompletedFormSubmission` type, field on `ReadinessAppointment`
- `src/components/clinic/patient-contact-card.tsx` — full rewrite: unified Appointments, Completed forms PDF list, error state, active-row matching, dropped legacy Forms-with-Resend section
- `src/components/clinic/readiness-shell.tsx` — removed unused `onOpenFormHandoff` prop pass
- `package.json` — added `@react-pdf/renderer`

## Smoke

Typecheck clean across the project. No browser smoke yet — flagged for the user to walk through:

- Run sheet → click patient → unified Appointments + Completed forms PDF (regular session)
- Run sheet on-demand session → click patient → Completed forms falls back to standalone (10 most recent across all appointments)
- Readiness dashboard → click patient → unified Appointments + Completed forms (intake-package + deliver_form submissions both surface)
- Patient profile (no session, no appointment in context) → standalone mode
- Click "View" on a completed form → PDF opens inline, renders patient header + Q&A + traceability footer
- Active row at position 11+ in a future-heavy patient → still renders in slide-out (force-include path)

## Risks not yet addressed

- The PDF route's `form_assignments.schema_snapshot` fallback to `forms.schema` is a real fidelity loss for intake-package submissions if the form has been edited since the patient submitted. Footer note flags it. Long-term fix: snapshot the schema onto `form_submissions` itself at submission time. Out of scope for this work.
- The active-row force-include's `fetchAppointmentById` adds an extra DB round-trip when the active row is outside the candidate window. For typical patients with under 15 future bookings this never triggers. Worth watching if it does.
- Three routes now do near-identical SSR auth + staff-org-membership logic. The helper covers it but the call-site boilerplate (cookie check → service-role lookup → membership check → 401/404) is still copy-pasted. A second helper that wraps the whole pattern would be cleaner. Held off because the resource-lookup step (submission vs patient vs other) varies and inlining is still readable. Revisit if a fourth route needs the same shape.
