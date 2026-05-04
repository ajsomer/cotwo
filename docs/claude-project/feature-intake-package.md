# Feature: Intake Package

Complete-tier only. The intake package is the bundled action type that replaces individual `deliver_form` actions. Instead of texting the patient three separate links for three forms, plus another for card capture, plus another for consent, the intake package is one URL that walks them through everything in a single journey.

It has its own table, its own component, its own journey UI, and its own transcription handoff flow. It touches the readiness dashboard (where transcription happens), the patient entry flow (where the outstanding intake gate routes patients to it), and the workflow engine (where it's an action type). Without a dedicated doc, those three docs each explain part of the picture and leave the reader to stitch the rest.

---

## What the package is

A bundled pre-appointment journey containing:

- **Forms** (zero or more, configured in the action block).
- **Card capture** (yes/no, configured).
- **Consent** (yes/no, configured).

The patient gets one SMS with one URL. They click, verify their phone (confirm-mode: see below), and walk through the bundled items. Progress persists, so a patient who does half the package and closes the tab picks up where they left off.

When all configured items are complete, the journey marks itself complete. The receptionist sees it on the readiness dashboard with a "needs transcription" priority. They open the handoff panel, copy the data into the PMS, and mark transcribed.

## Data model

Two tables matter:

**`intake_package_journeys`** is the runtime journey state. One row per (appointment, package). Carries:

- `journey_token`: the URL slug for the patient-facing link.
- `appointment_id`: which appointment this is for.
- `patient_id`: which patient (set at journey creation, not OTP-derived).
- `status`: `'in_progress'`, `'completed'`, etc.
- `includes_card_capture`, `includes_consent`, `form_ids`: which items are in the package.
- `card_captured_at`, `consent_completed_at`, `forms_completed`: per-item completion timestamps.
- `completed_at`: set when the patient finishes every item in the package.

There is **no** `transcribed_at` column on the journey. Transcription state lives on the corresponding `appointment_actions` row, not on the journey. (An earlier draft of this doc said otherwise; the journey table doesn't carry that column.)

**`appointment_actions`** holds the workflow-engine view of the package. One row per `intake_package` action block. Its `result` carries the journey ID and token; its `status` is the source of truth for transcription, mirroring the journey lifecycle (`scheduled` → `sent` when the SMS goes out → `completed` when the journey completes → `transcribed` when the receptionist marks transcribed via the handoff panel). The "needs transcription" priority on the readiness dashboard reads this status.

The two tables are kept in sync: the journey is the patient-facing record, the action is the workflow-engine view. Don't try to flatten them.

## The two parallel intake paths

The codebase has both `intake_package` (bundled) and `deliver_form` (individual) action types. They exist for different reasons.

**`deliver_form`** is the older mechanism. Each form is its own action block, its own SMS, its own URL. The patient gets three separate texts for three forms. Progress is tracked via `form_submissions` directly. Still supported because some legacy seed data uses it and the engineering handoff might need to migrate gradually.

**`intake_package`** is the newer, bundled mechanism. One action block, one SMS, one URL, one journey. Better patient experience by every measure.

New workflows should use `intake_package`. Old templates that used `deliver_form` continue to work. The readiness dashboard and the transcription handoff support both, but the bundled path gets first-class treatment (transcription priority, handoff panel, etc).

This is a deliberate two-mechanism split, not a transitional state. See `reference-decisions.md` for the rationale.

## The journey UI

`<IntakeJourney>` (in `src/components/patient/intake-journey.tsx`) is the patient-facing component. The standalone `/intake/[token]` route renders it directly, server-fetching the full `IntakeJourneyContext` (org, location, appointment, journey progress, forms list).

The journey is a small state machine:

`phone` → `identity` → `identity_picker` (if multi-contact) → `checklist` → (per-item phases: `card`, `consent`, `form`) → `done`

The `checklist` phase shows the patient what's outstanding and lets them pick what to do next (or "Continue" through them in order). After completing one item, the journey re-fetches the journey state and jumps to the next incomplete item, skipping the checklist as a landing pad. The patient sees the checklist once at the start (or again if resuming via a reminder link), not between every step.

When everything is complete, the journey reaches `done` and shows a confirmation screen. The `appointment_actions` row is flipped to `completed` (and the readiness dashboard's "needs transcription" signal kicks in).

## Confirm-mode identity (Phase 8)

The journey identity step is **confirm-only**, not capture. The clinic asserted the patient's identity at add-patient time; the journey's job is to verify the patient owns the asserted phone number, not to ask them who they are.

What this means:

- Phone OTP step verifies phone ownership.
- The verify endpoint (`/api/intake/[token]/verify`) looks up which contacts on this phone match the journey's `patient_id`.
- If exactly one contact matches: `matched`. Move to checklist.
- If multiple contacts on the phone: `multi_match`. Render picker; patient picks; verify endpoint records the choice.
- If the journey's `patient_id` doesn't match any contact on the phone: `no_match`. Show "contact your clinic" screen.

Notably, the journey **does not capture a new patient**. If the phone doesn't match an existing contact in this clinic, the journey hits a dead end. That's correct: the clinic has the patient's identity already (it's why they sent the package), so a "create a new contact" path here would create a duplicate.

## The outstanding intake gate

Recently added (Phase 9). The arrival flow (`<EntryFlow>`) checks for outstanding intake packages after identity confirmation, before card capture or device test. If a patient has an unfinished package, the flow embeds the journey UI inline and forces the patient to complete the package before reaching the waiting room.

The embedded journey is `<EmbeddedIntakeJourney>` (a wrapper that fetches the `IntakeJourneyContext` from the existing GET endpoint and renders `<IntakeJourney>` with `skipIdentity` and `preConfirmedPatient`). The journey's identity step is skipped because the arrival flow has already verified it.

Hard block. The patient can't reach the waiting room until the package is done. There's a future seam for clinician override (`overrideAllowed` in the API response, currently always `false`).

For the gate's design see `feature-patient-entry-flow.md` and `docs/plans/outstanding-intake-arrival-gate.md`.

## The transcription handoff

The receptionist's job after the patient completes the package. The flow:

1. Patient finishes the journey. `intake_package_journeys.status` is `completed`, `appointment_actions.status` is `completed`.
2. Readiness dashboard surfaces the appointment with the "needs transcription" priority (hardcoded second-highest).
3. Receptionist clicks the row, opens the `IntakePackageHandoffPanel`.
4. Panel shows: each completed form's submitted answers, card on file (last four, brand), consent status.
5. Receptionist reads the data and types it into the PMS (Cliniko or whatever).
6. Receptionist clicks "Mark as transcribed."
7. `appointment_actions.status` flips to `transcribed` (the journey table doesn't get touched). The server emits a `readiness_changed` Socket.io event into the appointment's `location:{id}` room with `action_resolved` as the tag. The "needs transcription" priority drops off this appointment.

For the design and detailed UI behaviour see `docs/plans/intake-package-transcription-handoff.md`.

## Reminders

The `intake_reminder` action type is a child of an `intake_package` action. It re-sends the journey URL if the package isn't complete by some offset (typically 1-2 days before the appointment).

Implementation:

- The reminder action is scheduled when the package is scheduled.
- At fire time, the handler checks the parent action's status. If `completed`, the reminder is `skipped`. Otherwise it sends another SMS with the same journey URL.
- The journey resumes wherever the patient left off.

## Console-log helper

In the prototype, the SMS is stubbed (see `conventions-prototype-vs-production.md`). The intake package handler logs the journey URL to the server console when the SMS would be sent. The readiness add-patient handler additionally logs the room URL (a separate URL useful for testing the outstanding intake gate via the room link entry point).

This is a deliberate prototype affordance. Both URLs are real and work; the stub just doesn't actually text them.

## Where to look

- **Journey component:** `src/components/patient/intake-journey.tsx`.
- **Embedded wrapper (for the gate):** `src/components/patient/embedded-intake-journey.tsx`.
- **Standalone page:** `src/app/intake/[token]/page.tsx`.
- **Resolver:** `src/lib/intake/resolve-journey.ts`.
- **API:**
  - `src/app/api/intake/[token]/route.ts` (GET full context)
  - `src/app/api/intake/[token]/verify/route.ts` (phone verification)
  - `src/app/api/intake/[token]/complete-item/route.ts` (per-item completion)
- **Outstanding check (for the gate):** `src/lib/intake/outstanding.ts`.
- **Workflow handler:** `src/lib/workflows/handlers.ts` (look for `handleIntakePackage`).
- **Handoff panel:** `src/components/clinic/intake-package-handoff-panel.tsx`.
- **Plan files:**
  - `docs/plans/patient-intake-checklist.md`
  - `docs/plans/intake-package-transcription-handoff.md`
  - `docs/plans/outstanding-intake-arrival-gate.md`

## Related docs

- `feature-workflow-engine.md` for the action-type system the package plugs into.
- `feature-patient-entry-flow.md` for the gate that routes patients to the package mid-arrival.
- `feature-readiness-dashboard.md` for the transcription handoff surface.
- `feature-tiers-and-roles.md` for the Complete-only gating.
- `reference-decisions.md` for why both `intake_package` and `deliver_form` exist.
- `03-data-model.md` for the journey table schema.
