# Standalone forms

**Date:** 2026-05-15

## Context

Forms today are only fillable as outstanding items inside the patient entry flow, anchored to an appointment via `form_assignments`. The user wanted forms to become standalone objects — shareable via a public URL, fillable without an appointment, with identity capture baked in. The primary use case is pre-booking intake (a prospect filling out a form before they have a booking) but the same plumbing covers ad-hoc collection from existing patients and public-facing intake.

This devlog covers two things that ran together: a long spec-then-build collaboration, and a mid-build pivot in how identity is captured.

## Spec rounds

Six rounds of spec feedback before any code. The spec lives at `docs/specs/standalone-forms-spec.md`.

Things that moved during review:

- **Eligibility split.** Started as one term "standalone-eligible"; review pointed out the share-tab contradicted it (drafts shouldn't be live but the share tab still needs to surface a URL). Split into **schema-eligible** (has identity field) and **shareable** (schema-eligible + published). Both terms used consistently throughout.
- **Existence-leak claim removed.** Spec originally said the typed-404 unavailable response "didn't leak existence." It does — an observer with a candidate token can distinguish "valid but unavailable" from "invalid". Accepted the trade-off explicitly in a dedicated subsection (token entropy is 122 bits, branding leak is the same envelope) rather than pretending otherwise.
- **Identity write rules became a hard rule.** Originally I floated "trust the patient record" as a recommendation in the Open Questions block. Review pushed to make it non-negotiable: new patient writes; existing patient never mutates; submitted values land in `responses.patient_identity` snapshot for audit.
- **Patient-selection authorization.** Submit was initially trusting the client-sent `patient_id`. Review caught that a tampered client could attach a submission to an arbitrary patient. Pivoted to server-re-resolving the OTP-match set on every submit and validating `kind ∈ {existing, someone_else, new}` against it (403 / 400 / 409 per case).
- **Server-owned namespace.** `responses._meta` was patient-controlled — a tampered client could spoof the duplicate-suspected metadata. Renamed to `responses.__server_meta`; submit route always overwrites/strips before persistence. Same convention applies to `responses.patient_identity` — server is the only writer of that block too.
- **Source attribution persistence.** `?src=qr` / `?src=sms` can be lost across multi-step navigation. Added sessionStorage keyed by token on first load, re-sanitized server-side. Whitelist mapping (`sms` / `qr` → typed, anything else → `standalone_public`).
- **DB invariants.** Added two CHECK constraints to make the schema lie-proof: `submission_source = 'entry_flow' OR appointment_id IS NULL`, and `review_status` consistency vs source.
- **Org-room scope creep flagged.** Adding `org:{org_id}` Socket.IO room solves the standalone-submission feed cleanly. Also a primitive future features will reach for. Flagged in Open Questions so we're deliberate about what else lives on it.

Each round closed cleanly — by round six there were no findings that survived to round seven.

## Schema

Migration `020_standalone_forms.sql`:

- `forms.public_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text` — covers backfill + future inserts.
- `forms.public_token_rotated_at / _by` — audit columns for the eventual regenerate action (route deferred).
- `form_submissions.submission_source` (CHECK) — `entry_flow` / `standalone_public` / `standalone_sms` / `standalone_qr`.
- `form_submissions.review_status` (nullable) — `pending` / `reviewed` / `archived`. Two CHECK constraints: source-vs-review consistency, and `standalone OR appointment_id IS NULL`.
- `form_submissions.reviewed_at / _by`.
- Partial index `idx_form_submissions_readiness_pending` on `(created_at DESC, form_id) WHERE submission_source != 'entry_flow' AND review_status = 'pending'`. Hot-path-only; reviewed/archived rows take the scan.

## The pivot

Original spec called for an `identity` SurveyJS custom question type. The form author would drop a "Patient identity" field into the toolbox. Eligibility = "exactly one identity field" (recursive schema walk). I built it that way.

Then mid-build the user pushed back:

1. **The toolbox approach didn't work in practice** — including the custom type in `questionTypes` silently dropped it from the toolbox. Required removing it from the filter list. Builders found this fiddly to reason about.
2. **The patient flow felt wrong** — identity was a separate React-rendered step before the SurveyJS body. Made the form feel split between two systems.
3. **The user asked for a different model:** identity should feel like part of the form, not a separate step. And new patient data should write to the patient record, not just snapshot.

Settled on: identity is a **locked platform page** baked into every form's schema at creation. Authors don't add it. Authors can't remove it. The patient sees one continuous SurveyJS survey — page 1 is the locked identity page, pages 2+ are the author's. Existing-patient branch stays confirm-only (no record mutation); new-patient and someone-else branches create the patient row directly.

Implementation:

- `src/lib/survey/identity-page.ts` — canonical page factory. `buildStaticIdentityPage()`, `ensureIdentityPage(schema)`, `defaultFormSchema()`. Reserved page name `__patient_identity`, reserved field names `__identity_first_name` / `_last_name` / `_date_of_birth` / `_email`.
- POST `/api/forms` calls `defaultFormSchema()` for new forms; PATCH defensively runs `ensureIdentityPage` on any incoming schema so a tampered client can't strip the page.
- Migration `021_backfill_form_identity_page.sql` — idempotent SQL update that prepends the identity page to any existing form's schema. Uses `WHERE NOT EXISTS` against the reserved page name.
- Form builder (`SurveyCreator`) wires `onElementAllowOperations` to disable delete / drag / copy / type-change / required-toggle on any element whose name is in the locked set. Authors see the page but can't break it.
- Patient runtime (`patchIdentityPageForOtp`) takes the static page from the schema and adds the dynamic radiogroup of existing matches + visibility rules on capture fields, depending on the OTP result.

The `identity` custom question type and the `countIdentityFields` traversal got ripped out. The eligibility model collapsed from "schema-eligible + published" down to "published". Cleaner.

## Patient runtime

`/f/{public_token}` is a server component that fetches the form via the standalone API and dispatches to a client component for one of three modes:

- **shareable** — full multi-step flow: primer → OTP → SurveyJS body → confirmation.
- **unavailable** — branded screen with reason-specific copy (`draft` / `archived` / generic `unavailable`).
- **invalid** — generic "this link isn't valid", no branding.

Two 404 shapes from the API distinguish unavailable (typed body) from invalid (flat). That's the accepted existence-leak trade-off documented in the spec.

The survey itself renders to match the intake-process FormStep: no outer card border, form name as `<h1>` above the survey body, no SurveyJS progress bar (the `PersistentHeader` carries the stepper).

## Submit route

`POST /api/forms/standalone/[public_token]/submit` is the security-critical bit. In order:

1. Re-resolve the form by public token and re-check `status = 'published'`. Don't trust the GET's result.
2. Verify the OTP token, extract the verified phone (E.164).
3. Server-re-resolve the OTP-match set from `patient_phone_numbers` joined to `patients` for the form's org. Don't trust the client's match-set claim.
4. Validate the patient selection kind:
   - `existing` — `patient_id` must be in the server-resolved match set. 403 if not.
   - `someone_else` — match set must be non-empty (the shared-phone case). 400 if empty.
   - `new` — match set must be empty. 409 if not.
5. Apply the identity write rules: create a `patients` row + `patient_phone_numbers` row for new / someone_else; reuse the patient for existing.
6. Compose the server-owned `responses.patient_identity` snapshot. Phone is forced to the OTP-verified value regardless of what the client sent.
7. Soft duplicate check on someone_else against (first_name, last_name, DOB) of matched patients. If hit, write `responses.__server_meta.duplicate_suspected = true` + `possible_duplicate_patient_id` + `..._name`.
8. Sanitize `source` body field to the whitelist.
9. Insert with `appointment_id = NULL`, `review_status = 'pending'`.
10. Emit `submission_changed` to `org:{org_id}` Socket.IO room using the server-resolved org id.

Step 6 / 7 keys are server-owned: anything the client put under `patient_identity` or `__server_meta` is stripped before persistence.

## Socket.IO org room

`server.ts` got a new `join:org` handler. Auth middleware now resolves the user's allowed org IDs from `staff_assignments → locations.org_id` alongside the existing location IDs. The join handler rejects (silently) if the user isn't assigned to the requested org. Patient flows never join org rooms.

Submit route's emit uses the server-resolved org id (from `forms.org_id`), not a client-supplied value — so a forged submit payload can't fan out to a different org's room.

`ClinicDataProvider` joins `org:{org_id}` on mount and listens for `submission_changed`. On any event, refreshes the standalone-submissions slice in the store. Real-time updates with no polling.

## Clinic surfaces

### Forms list

`/forms` got a "Copy link" button per row. Visible on any non-archived form. Copies `{origin}/f/{public_token}` to the clipboard with a transient "Copied!" affordance. Draft-state tooltip warns that the link won't resolve until publish.

### Readiness section — fold into Form Completed

Initial implementation added a dedicated "Standalone submissions" section at the top of the Readiness dashboard. User pushed back: there's already a "Form Completed" priority slot for appointment-bound submissions awaiting transcription, and standalone submissions are the same conceptual thing — a form that's been filled in and needs review. Don't make another section.

Refactored: standalone-submission rows render inside the existing Form Completed priority slot card, alongside appointment-bound rows. The slot's count badge sums both. The slot still appears when there are no appointment-bound rows in it, as long as there's at least one standalone row. Empty-state ("All patients are on track") only fires when both lists are empty.

The standalone row matches the appointment row's visual treatment — left amber border, amber tint, 94-wide time column, h-12 body. Time column shows submission age (`5m` / `2h` / `3d`) instead of a scheduled time. Patient name is a clickable button that opens the `PatientContactCard` (just `patientId`, no appointment context). "Review" action button on the right opens a dedicated slide-over.

### Standalone submission panel

`StandaloneSubmissionPanel.tsx` mirrors `FormHandoffPanel`'s layout intentionally — same header card pattern, same field-list pattern, same SlideOver wrapper. Differences:

- Uses `customHeader` on SlideOver so the title sits inline with the X close button. Subtitle metadata stacks below.
- Footer has `Download form` (always, when detail loaded) and `Mark reviewed` (only when status is pending). No "Copy all fields" button. No Archive button (the route exists server-side, just not exposed in v1 UI).
- Field list runs the response payload through `extractFieldsFromSchema` — same helper the appointment-bound handoff uses. Identity values are projected from the canonical `responses.patient_identity` snapshot back to their schema-key namespace so they render inline alongside author fields. Reserved scratch keys are stripped before display.

Download button goes to the existing `/api/forms/submissions/{id}/pdf` route. Also added the same button to the appointment-bound `FormHandoffPanel` so the two panels are consistent — that required teaching `/api/readiness/form-submission` to return `submission_id` (it was returning fields + timestamp only).

### Review / archive routes

- `POST /api/forms/standalone/submissions/{id}/review` — `pending → reviewed`, idempotent on already-reviewed, 409 on archived or entry-flow rows.
- `POST /api/forms/standalone/submissions/{id}/archive` — `pending|reviewed → archived`, idempotent on already-archived, 409 on entry-flow rows.

Both stamp `reviewed_at` / `reviewed_by` and emit `submission_changed` on the org room. The state machine is documented in the spec.

## Type / store changes

- Added `assertStaffCanAccessSubmission(supabase, submissionId)` in `src/lib/auth/staff-access.ts`. Anchors auth on `form_submissions.form_id → forms.org_id`, not on the patient. Form is the durable record; patients can be merged.
- Added `broadcastOrgSubmissionChange` in `src/lib/realtime/broadcast.ts`.
- `clinic-store.ts` got `standaloneSubmissions: StandaloneSubmissionRow[]`, a loaded flag, `refreshStandaloneSubmissions(orgId)`, and a setter.
- `ActivePanel`'s `detail` variant got a `patientId` field so we can open `PatientContactCard` in patient-only mode (no appointment context) without synthesising a fake appointment shape.

## Bugs caught during build

- **`questionTypes` filter swallowed the custom identity type** (pre-pivot). Wasted an hour on this before realizing the strict whitelist behaviour. Resolved when we pivoted to the schema-baked approach.
- **Hydration mismatch in the FormFillClient** — SurveyJS generates per-instance ids that differ between SSR and client renders. Pre-existing, but the standalone runtime needed `dynamic = "force-dynamic"` on the page to avoid surfacing it for `/f/{token}` too.
- **Spread of `appointment.actions` when `appointment` is null** crashed `PatientContactCard` when I synthesised `{ patient_id }` for the standalone row's patient-name click. Fixed by adding `patientId` to the `ActivePanel` detail variant and letting the card run in patient-only mode.
- **Doubled clinic header** in the standalone flow — `BrandedShell` rendered a header AND wrapped `PhoneVerification` which renders its own. Dropped `BrandedShell`; each stage renders `PersistentHeader` directly, mirroring the entry flow.
- **`registerIdentityQuestion()` HMR loop** (pre-pivot). The module-level `let registered = false` flag survived module re-eval but `ComponentCollection.Instance` got reset, so we thought we'd registered but the type was gone. Fixed by checking the collection itself for idempotency. Then made moot by the pivot — no custom type at all.

## What shipped (commit so far)

One commit on branch `standalone-forms-foundation`, pushed and PR opened at https://github.com/ajsomer/cotwo/pull/1: "Standalone forms foundation". 17 files, 2093 insertions. Covers migration 020, the identity contract, the patient runtime, the GET + submit + review + archive API routes, the Socket.IO org room, the form-builder lock-down, the forms-list Copy link, the Readiness Form Completed integration, and the slide-over review panel.

Migration 020 and 021 both applied to the hosted Supabase project via `npx supabase db push`. End-to-end smoke-tested with a real submission: Aiden Somerville / +610450336880 / new patient resolution. Patient row created with the verified phone attached, submission row in the inbox with the canonical snapshot, real-time refresh on Readiness, PDF download works.

## Deferred (next iteration)

- Share-via-SMS action from the form builder (the route is there, the UI affordance isn't).
- Regenerate public token action + audit-stamping (`public_token_rotated_at / _by` columns are in place).
- QR code download from the form builder.
- Auto-attach standalone submissions to an existing pending appointment when one exists (spec'd as out-of-scope for v1).
- Workflow-engine integration — a standalone submission shouldn't fire post-appointment actions today. Future enhancement.
