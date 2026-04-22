# Intake Package Phase 7 + 8, seed-defaults refactor, immediate-fire workflow actions

**Date:** 2026-04-21

## Context

Picking up from last week's work on the intake package engine (migrations 013–014, workflow handlers, readiness dashboard). Phases 1–6 were done; Phase 7 (patient-facing journey) and Phase 8 (identity model refactor) were outstanding, along with a seed-defaults refactor needed for onboarding to work. Onboarding itself was also queued but deferred this session to finish verifying the patient path first.

## What shipped

### Piece 1 — Intake Package Phase 7 (`1648bc8`)

The `/intake/[token]` patient-facing journey. Until now, workflow-fired intake package SMS links landed on a 404 because no route existed. After this commit, the link renders a full flow: phone OTP → identity → checklist → card / consent / forms → done.

Files created:
- `src/app/intake/[token]/page.tsx` — server component, resolves journey by token, handles 404 and completed states
- `src/app/intake/[token]/layout.tsx` — 420px centred container
- `src/app/api/intake/[token]/route.ts` — GET journey state
- `src/app/api/intake/[token]/verify/route.ts` — attach patient to journey
- `src/app/api/intake/[token]/complete-item/route.ts` — mark card / consent / form done, flips `intake_package_journeys.status` and the matching `appointment_actions` row to `completed` when all configured items are in
- `src/components/patient/intake-journey.tsx` — orchestrator, reuses `PhoneVerification` and (at that point) `IdentityConfirmation`
- `src/components/patient/intake-card-capture.tsx` — card step wired to `/api/patient/card` + `complete-item`

Consent and form screens ended up inline in `intake-journey.tsx` rather than their own files. The original execution plan listed `intake-consent.tsx` and `intake-form.tsx` separately but the brief named only two components; colocating matched the brief and kept it compact. Trivial to extract later.

### Piece 2 — Seed-defaults refactor (`72c58d5`)

`src/lib/workflows/seed-defaults.ts` was still emitting legacy `deliver_form` / `capture_card` / `send_reminder` / `verify_contact` blocks for new orgs — migration 014 added `intake_package` / `intake_reminder` / `add_to_runsheet` but the seeder was never updated.

Now:
- Each pre-appointment template that had a `deliver_form` + `capture_card` combo emits a single `intake_package` block with `{ includes_card_capture, form_ids, includes_consent }`.
- Each `send_reminder` with a `form_not_completed` precondition becomes an `intake_reminder` child, parented to the intake_package via `parent_action_block_id`. Two-phase insert to get the parent id before inserting children.
- Appointment reminders (no precondition) stay as `send_reminder`.
- Every pre-appointment template gets an `add_to_runsheet` block at offset 0.

Two of the four pre-templates (`Telehealth-specific Setup`, `Minimal Reminder Only`) had no form or card work, so they skip `intake_package` entirely — they just emit `send_reminder` + `add_to_runsheet`. No point creating an empty journey row.

For `Standard New Patient Intake`, the intake_reminder offset is 11 days (derived as 14d package send − 3d legacy reminder target = 11d after package fires). Scanner logic computes reminder `scheduled_for` as `parent.scheduled_for + offset_days × 24h`.

### Piece 3 — Intake Package Phase 8 (`ce55547`)

Confirm-mode identity. The clinic asserts identity at add-patient time; the journey's job is to verify phone ownership and confirm the existing contact — not capture.

- `handleIntakePackage` in `src/lib/workflows/handlers.ts` now seeds the journey row with `ctx.patientId` (drawn from `appointments.patient_id`) and fails the action loudly if missing. The engine already fails the action when there's no patient on the appointment, so `ctx.patientId` is reliably populated.
- `/api/intake/[token]/verify` returns one of three shapes: `{ status: 'matched', contact }`, `{ status: 'multi_match', contacts }`, or `{ status: 'no_match' }`. No capture fallback — zero matches means clinic data-entry error, patient can't self-resolve.
- `src/components/patient/intake-journey.tsx` — dropped `IdentityConfirmation` import. Three new screens rendered inline: confirm ("Please confirm who this appointment is for" with a single button), picker (multi-match), and no-match error. `IdentityConfirmation` stays for `/entry/[token]` capture-mode paths.
- `src/components/clinic/appointment-type-editor.tsx` — the locked "Verify identity and create contact" row became "Verify identity and confirm contact", with copy clarifying contact records are created at add-patient time, not in the journey. (Mid-session I almost removed this row entirely; the user pushed back that the identity step is still valuable to surface in the builder UI even if it's locked, so it stayed — with new framing.)
- Specs updated: `intake-package-workflow-spec.md` (new "Identity model: confirm, don't capture" paragraph), `patient-entry-flows.md` (two-mode split: capture mode for `/entry/[token]`, confirm mode for `/intake/[token]`), `onboarding-spec.md` (dropped the cross-spec cleanup caveat, updated wording).

Confirm screen wording is "Please confirm who this appointment is for" — user preferred this over the spec's "Is this you?".

### Fire immediately-due actions at schedule time (`4031028`)

During end-to-end testing the user flagged that adding a patient didn't surface anything in the console — the intake package action was scheduled with `scheduled_for = now` but didn't execute until the next cron pass. The scanner was doing scheduling only; execution waited for `/api/cron/daily-scan`.

Fixed by extending `executeScheduledActions` in `src/lib/workflows/engine.ts` to accept an optional `{ appointmentId }` scope, then calling it at the tail of `scheduleWorkflowForAppointment`. Future-dated actions stay queued for the daily scan; anything with `scheduled_for <= now` fires synchronously.

### Surface fired actions to the browser console (uncommitted at time of writing)

Even with synchronous firing, the stubbed SMS only went to the Next.js server terminal. For demo purposes the user wanted it in the browser console. `/api/readiness/add-patient` now pulls back any `appointment_actions` rows with a non-null `fired_at` after scheduling and returns them in `fired_actions`. `add-patient-panel.tsx` console.groups them, with a special format for intake_package that logs the full `/intake/{token}` URL and the journey token. Click-to-copy in devtools.

### Intake journey: checklist no longer bounces between items (uncommitted)

The journey was returning to the checklist screen after every completed item. User clarified the checklist is a preview surface — shown once before start, shown again on resume via a reminder link — not a landing pad between steps.

`handleItemComplete` in `intake-journey.tsx` now refetches the journey, computes the next item from the fresh state, and navigates straight to it. Only goes back to `'checklist'` as a fallback on reload failure.

## Verification

- Build clean across every piece (`npm run build` green).
- Lint baseline unchanged: 31 errors / 45 warnings before and after. All new lint violations I introduced got fixed in-flight. The 31 pre-existing `no-explicit-any` errors live in patient-entry Supabase-join call sites and aren't in scope.
- No end-to-end browser verification. The critical path (new org seed → add patient → intake package journey fires → SMS link lands → patient completes items → readiness reflects completion) wasn't exercised against a live DB this session — the user explicitly paused to do it themselves before Piece 4 (onboarding).

## Deferred

### Piece 4 — Onboarding

Started reading the spec and drafting migration 019 (`pms_connections`, `stripe_connections`, `users.onboarding_stage`, `sessions.is_onboarding_demo`, `forms.is_platform_demo`). User paused the work mid-migration to verify the patient demo first. I deleted the half-written migration file. The onboarding task is back in `pending`.

### Intake package transcription handoff

During end-to-end review, the user noted the readiness dashboard doesn't surface a "form completed, ready to handoff to PMS" state for intake-package-based workflows — the existing `deliver_form`-based transcription flow doesn't apply because an intake package is a single action with multiple forms inside.

Wrote a full plan to `docs/plans/intake-package-transcription-handoff.md` for another agent to pick up. Key points:

- Add `intake_package_journeys.transcribed_at TIMESTAMPTZ`. No new tables.
- Extend `isIntakePackageNeedsTranscription` predicate in `src/lib/readiness/derived-state.ts`, route it to the same `form_completed_needs_transcription` priority slot.
- New endpoints: `POST /api/readiness/mark-intake-transcribed`, `GET /api/readiness/intake-handoff`.
- New component: `IntakePackageHandoffPanel` — renders all forms + card + consent in one panel, with a single "Mark as transcribed" action.
- `add_to_runsheet` stays untouched — fires on appointment time regardless of transcription state.
- Appointment stays on readiness after transcription, flipping from Form Completed → In progress. It only leaves readiness once `add_to_runsheet` fires and the run-sheet lifecycle wraps up.
- Role note called out explicitly: this is for **receptionists and practice managers**, not clinicians. Don't use clinician framing in copy.

## Notes / things to watch

- The `GET /api/forms/[id]` endpoint I'm calling from inside the intake journey to fetch form schemas uses the service role and has no auth check. For the prototype the token on the intake journey gates access, but in production this endpoint should probably take the journey token and verify the form is part of that journey's `form_ids` array before returning the schema. Flagged but not fixed.
- The synchronous execution path in `scheduleWorkflowForAppointment` now runs `executeScheduledActions({ appointmentId })` in sequence after the scheduler inserts rows. The API route holds the connection open for the full fire cycle. Fine for add-patient which fires one action (the intake_package at offset 0), but if a workflow template ever fires multiple immediate actions this could be noticeable. The daily scan continues to handle future-dated actions so nothing breaks either way.
- `src/lib/supabase/custom-types.ts` was modified before this session (shows up in `git status` as pre-existing work). I didn't touch it and haven't reviewed what changed.
