# Plan: Patient Contact Slide-out Refresh

**Status**: Plan, not implemented
**Date**: 2026-05-08
**Surfaces affected**: `src/components/clinic/patient-contact-card.tsx` and `src/app/api/patient/[id]/route.ts`

---

## Goals

Two related changes to the patient contact slide-out:

1. **Show completed forms as PDF-viewable list items.** Replace the existing "Completed forms" section's review/handoff button with a simple click-to-open-PDF affordance. The same section should appear in both readiness mode and run-sheet mode (today it only appears in readiness, alongside a separate forms-with-resend section in run-sheet mode).
2. **Merge the "Appointment" / "Today's session" / "Visit history" sections into a single unified "Appointments" timeline.** Today the slide-out has up to three separate sections covering overlapping concepts. Collapse them into one chronological list that handles past visits, today's session, and future bookings.

Both changes are display-layer only — no schema migrations, no workflow engine impact.

---

## Why

**Forms.** The current Completed forms section was designed around the readiness dashboard's transcription-handoff flow: clinician reviews the patient's submitted intake form, copy-pastes the answers into their PMS, marks it transcribed. That handoff is appropriate on the readiness dashboard itself (it's the receptionist's prep surface), but on the patient contact slide-out the clinician/receptionist just wants to see what the patient submitted. A read-only PDF render is the cleanest representation: it's self-contained, looks the same as the patient saw, and prints/saves cleanly. No transcription state to track on this surface.

**Appointments.** The slide-out today has overlapping fields:

- **`Appointment`** (readiness mode only): the upcoming appointment driving the readiness row — date, time, type, room.
- **`Today's session`** (run-sheet mode only): the session the run sheet row is for — time, type, room, derived state, modality.
- **`Visit history`** (always shown): list of past appointment dates and types from `visit_history`.

These are all the same conceptual entity (an appointment) viewed at different lifecycle points. A single "Appointments" timeline that shows past + today + upcoming in chronological order is easier to scan and removes the "is this the same data as up there?" cognitive load.

---

## Part 1: Completed forms — PDF view

### Behaviour

The slide-out gains one section, **"Completed forms"**, present in both readiness and run-sheet modes whenever the patient has at least one completed form submission tied to **the appointment currently in context**.

- **Readiness mode**: scoped to forms completed for `appointment.appointment_id` (the row the receptionist clicked).
- **Run-sheet mode, regular session** (`session.appointment_id != null`): scoped to forms completed for `session.appointment_id` (the session the run sheet row is for).
- **Run-sheet mode, on-demand session** (`session.appointment_id == null`): no appointment to scope against, so fall back to standalone behaviour — the patient's most recent 10 completed submissions across all appointments. (Detailed behaviour and rationale in the per-mode data source section below.)
- **Standalone mode** (slide-out opened with `patientId` only, no session/appointment context): show all completed forms for the patient across all appointments, capped at the most recent 10.

Each row renders as:

- Form name (e.g. "New patient intake")
- Submitted timestamp, relative ("Submitted 2 days ago") with full timestamp on hover
- A right-aligned chevron or "View" affordance — clicking the row opens the PDF

No status badge (every row in this section is, by definition, completed). No "Resend" button. No "Review" / handoff button. No transcription status. The transcription handoff continues to live on the readiness dashboard's existing in-place panel — this slide-out section is the read-only viewer.

If the patient has no completed forms in context, the section is hidden entirely. No empty-state copy.

### PDF rendering

Clicking a row opens the form submission as a real PDF the user can save/attach. URL pattern: `/api/forms/submissions/[id]/pdf`.

The PDF route does **its own enriched query** rather than calling through the existing `/api/forms/submissions/[id]` JSON route — the JSON route's payload is missing org branding, DOB, form_id, submission_id, and the schema fallback for intake-package submissions (see "Submission data shape" below). The existing JSON route's response shape is preserved for its own callers, but it must gain the same auth gate as the PDF route in this refresh (see "Existing JSON route — must be secured" below).

**PDF content (layout):**

- Clinic branding header: org logo + name (mirrors the patient-facing PDF viewer in the files library)
- Form title (e.g. "New patient intake")
- Patient name + DOB
- Submitted-at timestamp
- One labelled question/answer per row, in the order defined by `schema_snapshot`
- Footer: small "Submitted via Coviu — {form_id} — {submission_id}" line for traceability

#### Answer formatting

The existing `extractFieldsFromSchema` helper used by the readiness transcription handoff is **not sufficient as-is**: it returns empty strings for unanswered fields, comma-joins arrays, and JSON-stringifies matrix/object answers. None of those render well in a PDF that a clinician is expected to read end-to-end.

The PDF route needs its own normaliser (e.g. `formatAnswerForPdf(field, value)`), separate from the transcription helper, with these rules:

- **Unanswered or empty value** → render as `—` (em dash). Includes empty strings, empty arrays, `null`, and `undefined`.
- **Single-line text / numeric / date / boolean** → render as the formatted scalar value. Booleans as "Yes" / "No". Dates formatted with `en-AU` (the prototype's default locale; the patient model has no `locale` field, and the clinic-side codebase already uses `en-AU` in its date helpers — e.g. `src/components/clinic/patient-contact-card.tsx:271`). If a per-clinic locale ever gets introduced, the normaliser should accept locale as a parameter and pass it through; out of scope for v1.
- **Multi-line text** → preserve line breaks in the rendered block.
- **Single-select (radio / dropdown)** → render the chosen option's label, not its value/id.
- **Multi-select (checkbox / multi-dropdown)** → render as a bulleted list of chosen option labels, not a comma-joined string.
- **Matrix / grid questions** → render as a sub-table of row-label → cell-answer pairs, not a JSON-stringified blob.
- **Object/composite answers** (rare, but supported by SurveyJS) → render each sub-field on its own labelled line.
- **File uploads** → **omit in v1.** SurveyJS forms in this prototype don't support file uploads anyway, and serving file-upload contents through the PDF would require additional storage signing logic. If the schema includes a file-upload field, render the label with `(file attached — view in Coviu)` placeholder text. No download links from the PDF in v1.

The normaliser is a pure function (schema field + raw value → formatted display string or rich block) that the renderer walks per question. Keeping it separate from the transcription helper avoids regressing the readiness copy-paste flow, which has different formatting needs (transcription wants flat text fields the clinician can paste).

### Renderer choice — server-side PDF

The readiness-dashboard transcription flow stays in place (copy-paste handoff is the better workflow for getting structured fields into a PMS). The PDF download is purely additive — for clinics whose PMS prefers file attachments, or for clinicians who want to read the submission as a single document.

Two viable options:

- **`@react-pdf/renderer`** — JSX-based PDF generation. Lighter dependency (no Chromium), runs cleanly in serverless/Vercel without bundling a headless browser. Recommended.
- **`puppeteer` / `playwright`** — render an HTML template and capture a PDF. Higher fidelity for complex layouts, but heavy on Vercel (Chromium binary, cold-start cost) and requires `@sparticuz/chromium` or similar to fit Lambda size limits. Only worth it if the form layouts get complex enough to warrant it; for a labelled Q&A list, `@react-pdf/renderer` is plenty.

**Recommendation: `@react-pdf/renderer`.** One new dependency. Server route returns `Content-Type: application/pdf` with `Content-Disposition: inline; filename="..."` — the user's browser renders the PDF in the new tab, and they can save from the browser viewer if they need to attach it to a PMS.

### Behaviour

Every completed-form row, in every slide-out mode (readiness, run-sheet, standalone), gets a single "**View**" button. Clicking it opens `/api/forms/submissions/[id]/pdf` in a new tab. The endpoint serves the PDF inline (`Content-Disposition: inline`), the browser renders it, and the user can save it from the browser's PDF viewer if they need to attach it to their PMS.

For v1, no force-download mode and no per-surface variation. One button, one behaviour. The browser's built-in download affordance is good enough for the "save and attach to PMS" path.

### API surface

#### New route: `GET /api/forms/submissions/[id]/pdf`

Returns a real `application/pdf` response generated via `@react-pdf/renderer`. Always inline (`Content-Disposition: inline`); the user saves from the browser's PDF viewer if they need to attach to a PMS.

**Auth — explicit, not "service role bypasses RLS":** API routes are skipped by middleware auth (`src/lib/supabase/middleware.ts:127`), and `createServiceClient()` deliberately bypasses RLS. The PDF route must therefore do its own org-membership check before serving the PDF, otherwise any authenticated user could read any submission by guessing IDs. Concretely:

1. Read the cookie-bound auth user via the SSR Supabase client (`createServerClient`).
2. If no user → 401.
3. Service-role lookup of the submission to get its `patient_id` → `patients.org_id`.
4. Confirm the auth user has a `staff_assignments` row whose `location_id` belongs to that `org_id` (joined through `locations.org_id`). The `public.user_org_ids()` SQL helper that RLS uses can be invoked directly from the route via `supabase.rpc(...)` if convenient, but a plain SELECT on `staff_assignments` joined to `locations` is equally fine and easier to reason about.
5. If the membership check fails → 404 (not 403, to avoid leaking submission existence).
6. On pass, render the PDF.

This is a new check — the exact "PDF route looks up submission → patient → org → staff_assignment" flow doesn't exist elsewhere in the codebase. Other staff-only API routes use SSR auth plus their own membership checks against different join paths; this one needs to be implemented from scratch following the same shape, not assumed to exist as a helper.

#### Submission data shape — beyond what the existing JSON route returns

The current `/api/forms/submissions/[id]` route returns `form_name`, `patient_name`, `completed_at`, `schema`, `responses` (`src/app/api/forms/submissions/[id]/route.ts`). For the PDF, the renderer also needs:

- **Org branding**: `organisations.logo_url` and `organisations.name`. Resolved from `patients.org_id` (already fetched for auth).
- **Patient DOB**: from `patients.date_of_birth`.
- **`form_id` and `submission_id`**: for the footer traceability line.
- **Schema fallback**: today's route reads schema only from `form_assignments.schema_snapshot`. Intake-package submissions have no `form_assignments` row — they are written directly to `form_submissions` from the intake completion endpoint (`src/app/api/intake/[token]/complete-item/route.ts:76-84`). The PDF route must fall back to `forms.schema` (current published schema) when no assignment-level snapshot exists. This is a slight fidelity loss (the schema may have evolved since the patient submitted), but it is the only available source for intake-package submissions in v1. Worth flagging in the footer: "Rendered from the form's current schema" when the snapshot fallback was used. **Future**: snapshotting the schema onto `form_submissions` itself would close this gap; out of scope here.

The existing JSON route keeps its current response shape for its own callers; the PDF route does its own enriched query rather than chaining through the JSON one. **But the JSON route's auth must be added in this refresh** — see the next subsection.

#### Existing route: `GET /api/forms/submissions/[id]` — must be secured

`src/app/api/forms/submissions/[id]/route.ts` today uses `createServiceClient()` with no auth check and returns the patient's submitted form responses (`form_submissions.responses` JSONB). API routes are skipped by middleware auth (`src/lib/supabase/middleware.ts:127`) and the service-role client bypasses RLS, so **any unauthenticated network actor can read any patient's form responses by guessing UUIDs** — same exposure shape as the patient API gap, just on a different surface. The refresh must close this with the same auth flow as the new PDF route:

1. Read the cookie-bound auth user via the SSR Supabase client (`createServerClient`).
2. If no user → 401.
3. Service-role lookup of the submission to get its `patient_id` → `patients.org_id`.
4. Confirm the auth user has a `staff_assignments` row whose `location_id` belongs to that `org_id` (joined through `locations.org_id`).
5. If the membership check fails → 404 (not 403, to avoid leaking submission existence).
6. On pass, run the existing data fetches (form name, schema snapshot, responses) with the service-role client and return the existing JSON response shape unchanged.

The PDF route, JSON route, and patient API all need the same auth check. Factoring an `assertStaffCanAccessPatient(supabase, userId, patientId)` helper after the third copy is reasonable; v1 can copy-paste safely if the implementation lands as a single PR. **Same precondition as the patient API**: not optional, not deferrable — the existing exposure is broad enough that closing it has to ride with this work.

#### Slide-out data source — by mode

- **Readiness mode**: do **not** drive the completed-forms list off `appointment.actions`. Those rows drive the workflow timeline and readiness state derivation (`src/lib/clinic/fetchers/readiness.ts:264`); duplicating intake-package actions to one row per form would corrupt that pipeline.

  Instead, add a new sibling array on the readiness appointment payload:

  ```ts
  completed_form_submissions: Array<{
    submission_id: string;
    form_id: string;
    form_name: string;
    completed_at: string;        // resolution rules below
    source: 'assignment' | 'intake_package';
  }>
  ```

  `source` is named after where the row was found, not after the workflow action that triggered it — `form_assignments` rows don't directly carry "this came from a `deliver_form` action" provenance, and inferring it would require joining `form_assignments` to `appointment_actions` and matching by form_id (workable but extra work for a field the UI doesn't need). The slide-out doesn't actually care about the action type; this field exists for debugging and future analytics.

  Same `completed_at` precedence applies to the patient API's `form_submissions` array (see Part 1's "Patient API change" section) — both surfaces compute it the same way. The slide-out always reads the resolved `completed_at` directly without re-applying the precedence.

  The readiness fetcher builds this array via two queries scoped to the appointment:

  1. `form_assignments` joined to `forms` where `appointment_id = ... AND status = 'completed' AND submission_id IS NOT NULL` — covers `deliver_form` action submissions.
  2. `form_submissions` joined to `forms` where `appointment_id = ...` and `form_id IN (intake_package_journeys.form_ids)` for the journey row tied to the appointment — covers intake-package submissions, which are written directly to `form_submissions` without a `form_assignments` row (`src/app/api/intake/[token]/complete-item/route.ts:76-84`). Filtering on the journey's configured `form_ids` is intentional: filtering on `forms_completed` (the JSONB map of per-form timestamps) would mean any submission whose timestamp wasn't recorded in the journey JSONB silently disappears, which defeats the fallback. Configured `form_ids` is the stable list; the JSONB map is best-effort metadata.

  **`completed_at` resolution:**

  - Query 1 (`form_assignments`) → `form_assignments.completed_at`.
  - Query 2 (`form_submissions`) → `intake_package_journeys.forms_completed[form_id] ?? form_submissions.created_at`. The journey's per-form timestamp is authoritative when present; the fallback to `form_submissions.created_at` covers historical rows where the submission exists but the JSONB map lacks the per-form timestamp (or where the journey row was somehow created out of sync with its submissions).

  Union by `submission_id` (no duplicates if both queries somehow surface the same submission). The slide-out reads `appointment.completed_form_submissions` directly — one row per submission, regardless of action type. `appointment.actions` is left untouched.

  Today's contact card filters `appointment.actions` for `action_type === 'deliver_form'` (`src/components/clinic/patient-contact-card.tsx:130`), which silently hides intake-package submissions. That's a **bug surfaced by this plan**; fixed by switching to `completed_form_submissions` instead of filtering actions.
- **Run-sheet mode**: `details.form_assignments` filtered to `status === 'completed'`. **The current API does not return `appointment_id` on assignment rows** (`src/app/api/patient/[id]/route.ts:71`), so scoping to `session.appointment_id` requires extending the SELECT. Add `appointment_id` to the assignment select, then filter client-side to `appointment_id === session.appointment_id`. This also picks up intake-package submissions only if they had a `form_assignments` row, which they don't — so run-sheet mode also needs to fetch `form_submissions` directly for the active appointment, joined with `forms.name`, in addition to the assignment-based query. Two queries union'd by `submission_id`.

  **On-demand sessions** (`session.appointment_id IS NULL`, e.g. via the on-demand link entry path): there's no appointment to scope against. **Behaviour:** fall back to standalone-mode rendering — show the patient's most recent 10 completed submissions across all appointments, regardless of which session is active. This is consistent with the "no appointment context" principle and avoids hiding the section entirely on what is otherwise a legitimate run-sheet view.
- **Standalone mode**: same union of `form_assignments` (completed) and `form_submissions` (all) for the patient, capped at the most recent 10 by `completed_at` / `created_at`.

#### Patient API change (revised)

The previous draft said no patient API change was needed. That was wrong. Required changes to `src/app/api/patient/[id]/route.ts`:

- Add `appointment_id` to the `form_assignments` SELECT.
- Add a separate fetch for `form_submissions` rows for this patient (id, form_id, appointment_id, created_at) joined with `forms.name`. Return as a new `form_submissions` array on the response. The slide-out merges `form_assignments` (completed) and `form_submissions` rows by `submission_id` to produce a single de-duplicated completed-forms list.
- Changes to `visit_history` / `current_session` handled by the appointments-merge work in Part 2 below.

#### Patient API auth — must be added as part of this refresh

`src/app/api/patient/[id]/route.ts` today uses `createServiceClient()` directly with no auth check. API routes are skipped by middleware auth (`src/lib/supabase/middleware.ts:127`) and the service-role client bypasses RLS. That means **any unauthenticated network actor can fetch any patient's full profile** by guessing UUIDs — which is already a problem on the current shape (PHI: name, DOB, phone numbers, payment-method metadata) and gets worse with this refresh, which adds form submissions, appointment timeline, and (via the merged response) richer appointment metadata.

The refresh must add the same auth pattern as the new PDF route to this endpoint:

1. Read the cookie-bound auth user via the SSR Supabase client (`createServerClient`).
2. If no user → 401.
3. Service-role lookup of the patient to get `patients.org_id`.
4. Confirm the auth user has a `staff_assignments` row whose `location_id` belongs to that `org_id` (joined through `locations.org_id`).
5. If the membership check fails → 404 (not 403, to avoid leaking patient existence).
6. On pass, run the existing data fetches with the service-role client.

The same shape covers both routes; if it ends up being three or four lines of duplicated logic, factor it into a small `assertStaffCanAccessPatient(supabase, userId, patientId)` helper rather than copy-pasting. But the implementation is simple enough that v1 can copy-paste safely without committing to a helper API up front.

This is not optional and not deferrable. The refresh expands what this endpoint exposes; closing the existing auth gap is a precondition for shipping the expanded payload.

### Code touch points

| File | Change |
|---|---|
| `src/app/api/forms/submissions/[id]/pdf/route.ts` | **New.** PDF renderer using `@react-pdf/renderer`. Does its own auth: SSR Supabase client → user → org-membership check via `staff_assignments` + `locations.org_id` against the submission's patient's org. 404 on miss. Service role for the data fetch after auth passes. Always serves inline. Renders org branding header, patient + DOB, form Q&A from `form_assignments.schema_snapshot` with fallback to `forms.schema` for intake-package submissions, footer with submission_id and a "rendered from current schema" note when the fallback was used. |
| `src/app/api/forms/submissions/[id]/route.ts` | **Add same staff org-membership auth check; preserve response shape.** Today this route uses `createServiceClient()` with no auth and returns the patient's submitted form responses — guessable-ID PHI exposure. Add the same SSR-auth + staff-org-membership flow as the PDF route (401 if unauthenticated, 404 if not in the patient's org). Keep the existing JSON response shape after auth passes. |
| `package.json` | Add `@react-pdf/renderer` dependency. |
| `src/components/clinic/patient-contact-card.tsx` | Replace the existing "Completed Forms" section with the unified list — one row per `form_submissions` row (de-duplicated across `form_assignments` + direct intake-package submissions). Each row has a single "View" button opening `/api/forms/submissions/[id]/pdf` in a new tab. Render the section in all three modes. Drop the legacy "Forms" section at lines 497-575. Remove the `onOpenFormHandoff` prop and any resend buttons (resend is readiness-only and stays there). |
| `src/app/api/readiness/route.ts` and `src/lib/clinic/fetchers/readiness.ts` | Add a new `completed_form_submissions` array on each readiness appointment, populated by two scoped queries: (1) `form_assignments` joined to `forms` for `deliver_form` submissions, (2) `form_submissions` joined to `forms` for intake-package submissions (which lack `form_assignments` rows — see `src/app/api/intake/[token]/complete-item/route.ts:76-84`). **Do not duplicate `appointment.actions` rows.** The actions array continues to drive the workflow timeline and readiness state derivation unchanged. |
| `src/app/api/patient/[id]/route.ts` | **Two changes in one PR — security gap + payload extension.** **Security:** add SSR-auth user lookup + staff org-membership check via `staff_assignments → locations.org_id`, return 401 if unauthenticated and 404 if not in the patient's org (see "Patient API auth" section). The route currently uses `createServiceClient()` with no auth and leaks PHI. **Payload:** add `appointment_id` to the `form_assignments` SELECT; add a separate `form_submissions` query for the patient (joined with `forms.name`) returned as a new `form_submissions` array; replace `visit_history` and `current_session` with the unified `appointments` array (see Part 2 data source) plus `total_appointment_count`. Slide-out merges `form_assignments` and `form_submissions` by `submission_id` to handle both assignment-driven and intake-package submissions in one list. |

### What NOT to change

- The readiness dashboard's existing in-place transcription handoff panel stays. The PDF download is **purely additive**, not a replacement: copy-paste is the better workflow for getting specific fields into a PMS that accepts structured text, and the PDF covers the case where the PMS accepts file attachments instead. Both surfaces stay; clinicians pick whichever fits their PMS.
- `form_submissions` schema unchanged. No new tables.
- Resend on incomplete forms — removed from the slide-out entirely. The slide-out is a read-only surface; resend is a readiness-dashboard action and stays there. No "View" or "Resend" buttons appear on incomplete forms in the slide-out at all (incomplete forms are visible in the workflow timeline section as `scheduled`/`sent`/`opened` actions, which is sufficient context).

---

## Part 2: Merge Appointment / Today's session / Visit history into one section

### Single unified "Appointments" section

Replace the three current sections with one section titled **"Appointments"** that renders as a vertical chronological list (most recent at the top, future appointments above past ones — see ordering below).

Each row contains:

- **Date label** (e.g. "Today", "Tomorrow", "Yesterday", "Mon 3 Mar", or "12 Apr 2026" for older entries)
- **Time** (e.g. "2:30 PM") if the appointment had a scheduled time. Collection-only appointments (no `scheduled_at`) show no time.
- **Appointment type name** if available
- **Room name** if available
- **Status badge / lifecycle indicator** (see "Per-row status" below)
- **Modality** (Telehealth / In-person) for the active or upcoming row

Rows are tappable on the active row only (today's session expands inline into the existing run-sheet detail block: derived state badge + modality). Past and future rows are static.

### Per-row status

Status is derived per row based on the appointment's lifecycle, mirroring the existing run-sheet derived-state model:

- **Future rows**: small "Upcoming" tag if within the next 7 days, otherwise no tag.
- **Today's row** (the active row — see active-row matching below): renders the existing `StatusBadge` (queued / waiting / in-session / complete / done) plus modality. This is the "expanded" row described above.
- **Past rows**: no status (they're history). Just date + type.

If the active context doesn't match any appointment in the patient's history (edge case: race condition during creation), it's still shown at the top of the list as a synthetic row — same content as the existing "Today's session" / "Appointment" cards.

#### Active-row matching

The slide-out picks the active row from the `appointments` array based on the calling context, with one important branch for on-demand sessions:

- **Readiness mode** — match the row whose `appointment_id === appointment.appointment_id`. Readiness always has an appointment.
- **Run-sheet mode, regular session** — when `session.appointment_id != null`, match the row whose `appointment_id === session.appointment_id`. The appointment is the join key.
- **Run-sheet mode, on-demand session** — when `session.appointment_id == null` (on-demand telehealth sessions, see `src/lib/supabase/custom-types.ts:122`), `appointment_id` matching would falsely activate every synthetic on-demand row in the list (all of which have `appointment_id: null`). Instead, match by `session_id === session.session_id` to pick out the one specific session row that was synthesised for the active session.
- **Standalone mode** — no row is active. All rows render statically.

The `session_id` field on the appointment row exists specifically to enable the on-demand match path. Synthesised on-demand rows always populate `session_id`; appointment-driven rows populate `session_id` from the latest-session subquery (which may be null if no session has been spawned yet).

### Ordering

After bucketing (timezone-aware, see below) and before slicing to 10, sort the candidates within each bucket so the most actionable row floats to the top of its group:

- **Upcoming** — soonest-first (ascending `scheduled_at`).
- **Today** — active row first if present (identified using the active-row matching rules under "Per-row status → Active-row matching"), then remaining today rows by `scheduled_at` ascending. **Untimed today rows only ever come from synthetic on-demand session rows** that fell back to `session_started_at ?? created_at` for placement — appointment-driven rows with `scheduled_at = null` are never bucketed into today; they always go to `awaiting_scheduling` regardless of when they were created. Untimed today rows sort after the timed today rows by `created_at` ascending.
- **Past** — most-recent-first (descending `scheduled_at`, falling back to `created_at` for rows without a scheduled time).
- **Awaiting scheduling** — most-recently-created-first (descending `created_at`).

The buckets themselves render in the order **upcoming → today → past → awaiting_scheduling** (top to bottom in the slide-out), which puts the most actionable rows at the top and matches the existing "Appointment" / "Today's session" placement. After this sort, take the first 10 rows for display.

If no future appointments and no active session exist, the list is just past visits in reverse chronological order — equivalent to today's "Visit history" but with type info already there.

### Cap

Show up to **10 rows** combined (past + today + future). If more exist, render a small "+ N earlier appointments" footer underneath the list as a non-actionable hint that history is truncated. No "Show all" expansion in v1.

### Data source — appointments table, not sessions

Today's `visit_history` is built off `session_participants` joined to `sessions` filtered by `sessions.status === 'done'` (`src/app/api/patient/[id]/route.ts:98-113`). That works for "what visits has this patient completed" but doesn't cover future bookings, doesn't include cancelled/no-show appointments, and conflates "session done" with "appointment happened."

The new `appointments` array should query `appointments` directly, scoped to this patient via `appointments.patient_id`, with a left-join to the spawned `sessions` row (if any) for status enrichment. Concretely:

```sql
SELECT
  a.id AS appointment_id,
  a.scheduled_at,
  a.status AS appointment_status,
  at.modality,                 -- modality is on appointment_types, NOT appointments
  at.name AS type_name,
  r.name AS room_name,
  loc.timezone AS location_timezone,
  -- See "session join" note below
  (
    SELECT row_to_json(s)
    FROM (
      SELECT id, status
      FROM sessions
      WHERE appointment_id = a.id
      ORDER BY created_at DESC
      LIMIT 1
    ) s
  ) AS latest_session
FROM appointments a
LEFT JOIN appointment_types at ON at.id = a.appointment_type_id
LEFT JOIN rooms r ON r.id = a.room_id
LEFT JOIN locations loc ON loc.id = a.location_id
WHERE a.patient_id = :patient_id
  AND a.status NOT IN ('cancelled')
```

(Pseudo-code — the actual implementation will use Supabase's nested select syntax. The point is the columns and the join semantics, not literal SQL.)

**Schema corrections** (caught in review):

- **`modality` lives on `appointment_types`**, not `appointments`. Select `at.modality`.
- **`sessions.appointment_id` is not unique.** The schema allows multiple sessions per appointment (e.g. a session was started, abandoned, and a fresh one created). LEFT JOIN'ing `sessions` directly produces duplicate appointment rows. Pick the latest session per appointment via a correlated subquery (shown above) or a window function. The slide-out only needs one session row per appointment for the active-row badge; if the invariant ever tightens to "one session per appointment," this collapses naturally.

**Cap and ordering — fetch wider than 10, then bucket and slice:**

`ORDER BY ... LIMIT 10` at the SQL level can drop near-future appointments if the patient has many recent past rows. The correct flow:

1. Fetch up to **30 candidates** ordered by `COALESCE(scheduled_at, created_at) DESC` from the appointments query above.
2. Run the second query for on-demand sessions (see below) and merge.
3. **In application code**, bucket each row into `upcoming` / `today` / `past` / `awaiting_scheduling` using the location timezone (see timezone section below).
4. **Sort within each bucket** per the rules in "Ordering" above (today's active row first, then timed; upcoming soonest-first; past most-recent-first; awaiting_scheduling most-recently-created-first), then concatenate buckets in the display order **upcoming → today → past → awaiting_scheduling**.
5. Take the first 10.
6. Compute `total_appointment_count` over the **combined timeline** — appointment-driven rows (excluding `cancelled`) **plus** synthetic on-demand session rows. The displayed list and the count must agree on what's countable; a count that ignored on-demand rows would let the slide-out's "+ N earlier" footer say `+ 0` even when on-demand history is being truncated.

   **Counting strategy** depends on whether the candidate sets fit under the cap:
   - If both candidate queries returned fewer than their `LIMIT 30` (i.e. all rows were fetched), `total_appointment_count = appointment_candidates.length + on_demand_candidates.length`. No additional queries needed.
   - If either candidate query hit its limit, run two separate `count(*)` queries (one against `appointments` with the same `WHERE` clause minus the `LIMIT`, one against the `session_participants → sessions WHERE appointment_id IS NULL` shape) and sum them. The cost of two extra count queries on a code path that's already truncated is acceptable; the alternative (fetching everything) is not.

   The detection of "did we hit the limit?" is straightforward: compare each candidate set's length to its `LIMIT`. If equal, run the count query; if smaller, sum from the candidate sets.

Edge cases the API must handle:

- **`scheduled_at IS NULL`** on appointment-driven rows (collection-only appointments, see intake-package spec): bucket as `awaiting_scheduling` regardless of `created_at`. **Never bucketed into today, even if `created_at` falls on the local-timezone "today."** Render with no time on the row and no "Today / Tomorrow / Past" label. Synthetic on-demand session rows are different — they fall back to `session_started_at ?? created_at` for bucketing and can legitimately land in `today` (see the on-demand session note below).
- **`appointment_status = 'cancelled'`**: excluded at the SQL level by default. Toggle is a future enhancement.
- **`appointment_status = 'no_show'`**: included, rendered with a faded "No show" badge so it's visible in history.
- **Sessions without appointments.** The schema allows `sessions.appointment_id IS NULL` (`src/lib/supabase/custom-types.ts:122`), used today for on-demand telehealth sessions. Today's `visit_history` picks these up via `session_participants`. The new flow needs the same, with location and room enrichment so synthetic rows can be bucketed and rendered the same way as appointment-driven rows:
  ```sql
  SELECT
    s.id AS session_id,
    s.status,
    s.session_started_at,
    s.session_ended_at,
    s.created_at,
    s.location_id,
    loc.timezone AS location_timezone,
    r.name AS room_name
  FROM session_participants sp
  JOIN sessions s ON s.id = sp.session_id
  LEFT JOIN locations loc ON loc.id = s.location_id
  LEFT JOIN rooms r ON r.id = s.room_id
  WHERE sp.patient_id = :patient_id
    AND s.appointment_id IS NULL
  ORDER BY s.created_at DESC
  LIMIT 30
  ```
  Each row becomes a synthesised `appointments` entry with:
  - `appointment_id: null`
  - `session_id: s.id` (used for active-row matching in run-sheet on-demand mode)
  - `scheduled_at: s.session_started_at ?? null` (`null` is fine — `created_at` carries the stable timestamp)
  - `created_at: s.created_at`
  - `type_name: 'On-demand'`
  - `room_name: r.name ?? null`
  - `modality: 'telehealth'` (on-demand sessions are telehealth-only by design)
  - `location_timezone: loc.timezone` (required for bucketing; falls back to org primary location timezone if `s.location_id` is somehow null — defensive only)
  - `appointment_status: null`
  - `session_status: s.status`

  Merged with the appointment-driven candidates before bucketing. The bucketing step uses the row's `location_timezone` regardless of source.

### Timezone bucketing

"Today / Tomorrow / Yesterday" labels and the `today` bucket must be derived in the **appointment's location timezone**, not server UTC, otherwise rows around midnight get mislabelled. The locations table carries `timezone` (`src/lib/supabase/types.ts:604`); the appointment query above selects `loc.timezone`.

For each candidate row:

- Convert `scheduled_at` (UTC) to the appointment's location timezone.
- Compute `now` in the same timezone.
- Bucket against the timezone-local calendar day.

For on-demand sessions, the session is associated with a location via `sessions.location_id`. Same conversion applies. (Falls back to the org's primary location timezone if `location_id` is somehow null on a session — defensive only.)

For multi-location clinics where the staff member is browsing in one timezone but viewing a patient with appointments at another location, the bucket reflects the appointment's location, not the viewer's — that matches the appointment time the patient actually attended/will attend.

#### Implementation note: no date library currently in the repo

The repo today has no timezone-aware date library (no `date-fns-tz`, `luxon`, or `dayjs` with the timezone plugin). Native `Date` plus `Intl.DateTimeFormat({ timeZone })` is the only timezone-aware tool available, and the implementation must use it carefully. **Do not** derive buckets with `Date#setHours`, `Date#getDate`, or any other server-local conversion — these silently use the server's `process.env.TZ` (Vercel defaults to UTC, but local dev machines vary), and bucketing rows around midnight will be wrong on either platform.

Two acceptable implementation paths:

1. **Stick with native `Intl.DateTimeFormat`.** Build a small helper that, given a UTC `Date` and an IANA timezone, returns a `{ year, month, day }` triple computed via `Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)`. Compare the appointment's local-day triple to today's local-day triple (computed the same way for `now()` in the same timezone) to derive the bucket. No dependencies; the helper is ~30 lines.
2. **Add `date-fns-tz` (or equivalent).** If the helper above starts growing edge cases (DST transitions, partial days, week-boundary tooltips), promote to a real library. `date-fns-tz` is the lightest fit alongside the existing `date-fns`-style helpers in the codebase. Adding it is a one-line dependency change and a small import refactor; not justified solely for this work but reasonable if any other timezone-sensitive surface lands at the same time.

**Recommendation: option 1 for v1.** The bucketing logic is simple enough (today vs. tomorrow vs. yesterday vs. older vs. future) that a hand-rolled `Intl.DateTimeFormat` helper is fine, and avoids committing to a new dependency. If a follow-up needs richer timezone math (relative-time strings, recurring appointments, week-of), revisit the dependency call.

New response shape:

```ts
appointments: Array<{
  appointment_id: string | null;        // null for on-demand sessions without a prior appointment
  session_id: string | null;            // populated for synthetic on-demand rows AND for appointment rows that have spawned a session
  scheduled_at: string | null;          // null for awaiting_scheduling rows
  created_at: string | null;            // stable timestamp for sorting / labelling rows that lack scheduled_at (awaiting_scheduling, synthetic on-demand fallbacks)
  type_name: string | null;
  room_name: string | null;
  modality: 'telehealth' | 'in_person' | null;
  appointment_status: AppointmentStatus | null;
  session_status: SessionStatus | null;
  bucket: 'past' | 'today' | 'upcoming' | 'awaiting_scheduling';
  location_timezone: string | null;     // included so the client can render/debug timezone-derived labels even though `bucket` itself is API-derived
}>;
total_appointment_count: number;        // combined: appointment rows (excluding cancelled) + on-demand session rows. Not appointments-table-only.
```

`bucket` is derived in the API (using `location_timezone`, see Timezone bucketing) so rendering doesn't have to redo the conversion. `location_timezone` is included on each row for two reasons: (1) tooltip / debug "rendered in [timezone]" affordances if needed, and (2) so the client can re-derive the bucket if the row sits in the slide-out across midnight without an API refetch.

`created_at` is included so rows without a `scheduled_at` (`awaiting_scheduling`, on-demand fallbacks where `session_started_at` was null) still have a stable timestamp for the rendered date label and for client-side sorting if the slide-out ever needs to reorder.

The slide-out picks the active row using the active-row matching rules above. `details.visit_history` and `details.current_session` are removed from the response. The slide-out's `current_session` consumption is replaced by reading from the active row in `appointments`.

### Per-mode wiring

Active-row picking is described in detail under "Per-row status → Active-row matching" above. Summary:

- **Run-sheet mode**: match by `appointment_id` when `session.appointment_id` is set, else by `session_id` for on-demand sessions. Active row renders the run-sheet detail block (StatusBadge, modality).
- **Readiness mode**: match by `appointment_id`. Active row renders the readiness appointment block (date + type + room).
- **Standalone mode**: no active row.

### Code touch points

| File | Change |
|---|---|
| `src/app/api/patient/[id]/route.ts` | See the consolidated touch-point row in Part 1 — Part 2's appointments-array work ships in the same PR as the security fix and forms changes (one route, one PR). Summary for this section: replaces `visit_history` and `current_session` with a single `appointments` array (past + today + future), capped to 10 after merging on-demand sessions; returns `total_appointment_count` covering the combined timeline (appointments + on-demand sessions, see "Cap and ordering"). |
| `src/components/clinic/patient-contact-card.tsx` | Delete the three sections (lines 258-290, 430-465, 467-495 approx). Replace with one "Appointments" section. The existing helper functions (`formatTime`, `formatDate`) cover the rendering; add a small "relative date label" helper for "Today / Tomorrow / Yesterday" handling. |
| `PatientDetails` interface in the same file | Update to match the new shape: drop `current_session` and `visit_history`, add `appointments: AppointmentRow[]`. |

### What NOT to change

- The readiness dashboard, run sheet rows, and other surfaces that consume `current_session` or `visit_history` from elsewhere — those don't go through this API. Verify nothing else hits `/api/patient/[id]` and depends on the old shape (likely just the slide-out, but worth a grep before implementing).
- Workflow timeline section (lines 292-353) stays as-is. It complements the appointments timeline rather than duplicating it — workflow is "what automation has fired against this appointment," appointments is "what appointments exist." They sit alongside each other.
- The "Coviu appointments only — not a complete clinical history" footnote currently shown under visit history in readiness mode should be retained, but moved to the bottom of the unified appointments section.

---

## Implementation order (when this gets built)

1. **Close both existing PHI exposures, then extend the patient API payload.** Both `/api/patient/[id]` and `/api/forms/submissions/[id]` today use `createServiceClient()` with no auth and return PHI to any unauthenticated caller — they are the same exposure shape and need the same fix together. In one PR:
   - Add SSR-auth + staff-org-membership check to **both** routes (`patients.org_id` for the patient route, `submission → patient → patients.org_id` for the submission route). 401 if unauthenticated, 404 if not in the patient's org. Preserve the existing JSON response shape on both.
   - Then extend `/api/patient/[id]`'s response: unified `appointments` array (+ `total_appointment_count`), new `form_submissions` array, `appointment_id` on `form_assignments`. Verify no other callers depend on the old `visit_history` / `current_session` keys (grep confirms only `PatientContactCard` consumes this route).

   The two security fixes ride together; the payload extension can land in the same PR or a follow-up depending on review appetite, but the security fix must not be delayed waiting for the payload work.
2. **Slide-out: render unified Appointments section.** Drop the three old sections. This is independently shippable from the forms PDF work.
3. **API: enrich readiness payload** with a new `completed_form_submissions` array on each appointment (one row per submission), without modifying `appointment.actions`.
4. **API: add `/api/forms/submissions/[id]/pdf`** as a real PDF response using `@react-pdf/renderer`, with the explicit auth flow and answer normaliser described above. Verify it renders correctly for a `deliver_form` submission (has assignment-level schema snapshot) and an `intake_package` submission (no snapshot, falls back to `forms.schema`). Footer note appears in the latter case. Spot-check rendering of multi-select, matrix, and unanswered fields.
5. **Slide-out: replace Completed Forms section** with the merged list and single View button per submission. Remove the old run-sheet "Forms" section. Confirm intake-package forms now appear (today they're hidden because the filter is `deliver_form`-only).
6. **Manual smoke**: open the slide-out from the run sheet (regular and on-demand sessions), readiness, and patient profile (standalone) entry points; confirm all three render the unified appointments timeline, that the active row is correctly picked in each case (especially on-demand → `session_id` match), and that completed-form rows open the PDF inline.

---

## Open questions

None outstanding.
