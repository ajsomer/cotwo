# Monday Agent Prompt — Execute Outstanding Onboarding Prerequisites

This file is a self-contained brief for a Claude Code agent starting fresh on Monday 2026-04-21. The agent should build the three outstanding pieces of work in sequence, verify each before moving to the next, and stop for human review at the stated checkpoints.

Copy everything below the divider into the agent's first message.

---

You are picking up a project mid-stream. The repository is `cotwo` at `/Users/ajsomer/Documents/Coviu/cotwo`. Read `CLAUDE.md` and `MEMORY.md` first for project context.

## Your goal

Build four outstanding pieces of work in order, culminating in the onboarding flow itself.

The four pieces, in required order:

1. **Intake package Phase 7** — the patient-facing intake journey page and its API routes. Full spec at `docs/specs/intake-package-execution-plan.md`, Phase 7 section.
2. **Seed-defaults refactor** — swap legacy workflow action types for the new intake package action types in `src/lib/workflows/seed-defaults.ts`.
3. **Intake package Phase 8** — refactor the identity model in the intake journey from capture-mode to confirm-mode. Full spec at `docs/specs/intake-package-execution-plan.md`, Phase 8 section (added 2026-04-18).
4. **Onboarding** — build the full 5-step onboarding flow per `docs/specs/onboarding-spec.md`. This is the downstream consumer of pieces 1-3.

Each piece has a dedicated verification checklist. Do not skip verification. Each piece must land cleanly before the next begins.

## Before you start

Read these files in order to understand current state:

- `CLAUDE.md` — project context, conventions, brand system
- `TODO.md` — see the three outstanding items near the top
- `docs/specs/onboarding-spec.md` — the downstream consumer. Your work enables this.
- `docs/specs/intake-package-workflow-spec.md` — the intake package engine, mostly built (phases 1-6). Understand it before modifying.
- `docs/specs/intake-package-execution-plan.md` — Phases 7 and 8 are your scope. Phases 1-6 are already built; use them as reference for style.
- `docs/plans/patient-intake-checklist.md` — the existing `/entry/[token]` outstanding-items checklist. Do not confuse with Phase 7's `/intake/[token]` journey. They are distinct surfaces.

Verify current state before coding:

- Run `ls src/app/\(patient\)/` — there should be no `intake/` directory. If there is, someone started Phase 7; read it before adding to it.
- Run `ls src/app/api/` — there should be no `intake/` directory.
- Check `src/lib/workflows/seed-defaults.ts` — line ~179-200 should still show legacy action types (`deliver_form`, `send_reminder`, `capture_card`). If they've been updated, the seeder refactor is already done.
- Check `src/components/patient/` — there should be no `intake-journey.tsx` or `intake-card-capture.tsx`.

If any of the above is already done, skip that piece and move to the next.

## Piece 1 — Intake Package Phase 7

**Reference:** `docs/specs/intake-package-execution-plan.md`, Phase 7 section.

**What you're building:** The `/intake/[token]` patient-facing journey. When a workflow fires an `intake_package` action, it sends the patient an SMS with a link to this page. Today that link 404s. After your work, it renders a full journey: phone OTP → identity confirmation → checklist → each configured item → completion.

**Files to create (from the spec):**

- `src/app/intake/[token]/page.tsx`
- `src/app/intake/[token]/layout.tsx`
- `src/app/api/intake/[token]/route.ts`
- `src/app/api/intake/[token]/verify/route.ts`
- `src/app/api/intake/[token]/complete-item/route.ts`
- `src/components/patient/intake-journey.tsx`
- `src/components/patient/intake-card-capture.tsx`

**Key implementation notes:**

- Follow patterns from `src/app/(patient)/entry/[token]/page.tsx` — same layout style, same service-role client pattern, same token-based auth (no staff auth).
- Reuse `PhoneVerification`, `IdentityConfirmation`, `FormFillClient`, `DeviceTest` components. Do not duplicate them.
- The checklist screen is new to Phase 7. It shows the items the patient will complete, composed from the intake package config on the `workflow_action_blocks` row (type `intake_package`). Look at the config JSON shape: `{ includes_card_capture, includes_consent, form_ids }`.
- Progress is stored on `intake_package_journeys`. Completion of an item updates the corresponding field (`card_captured_at`, `consent_completed_at`, `forms_completed`).
- When all items are done, flip `intake_package_journeys.status` to `'completed'` and update the corresponding `appointment_actions` row to `status = 'completed'`. Application code, not a database trigger.
- The journey link is the same in all SMS (initial + reminders). Patients resume where they left off.

**Important: identity at this stage uses capture mode, not confirm mode.** The Phase 8 work reverses this. For Phase 7, follow the spec as written — identity capture happens inside the journey. Do not preempt Phase 8.

**Verification checklist (must pass before moving to Piece 2):**

- Visit `/intake/{token}` with a valid token → see phone verification.
- Complete OTP → see identity confirmation (capture mode per Phase 7 spec).
- Complete all configured items in the package → journey marked `completed`.
- Visit the same link after completion → "All done" screen.
- Partial completion → leave → return → resume from last incomplete step.
- `appointment_actions` row for the `intake_package` action flips to `completed`.
- Run the build: `npm run build` → no TypeScript errors.
- Run lint: `npm run lint` → no new errors.

**Checkpoint:** Stop after Phase 7. Do not move to Piece 2 until you've run verification end-to-end with at least one test case. Report back what you built and what you verified before continuing.

## Piece 2 — Seed-Defaults Refactor

**What you're refactoring:** `src/lib/workflows/seed-defaults.ts` currently emits `deliver_form`, `send_reminder`, `capture_card`, `verify_contact` action blocks when seeding default workflow templates for a new org. Phase 2 of the intake package build added `intake_package`, `intake_reminder`, and `add_to_runsheet` as action types, but this seeder was never updated. New orgs therefore get workflows built on the legacy action types.

Both type families still work (handlers.ts supports both), but they don't produce `intake_package_journeys` rows. Onboarding requires the demo test session to produce a journey (so it can flow through your new Phase 7 page), so the seeder must emit the new types.

**What to change:**

Inside `getPreActionBlocks()` (line ~171):

- Every `deliver_form` + `capture_card` combination across pre-appointment templates should consolidate into a single `intake_package` action block with config `{ includes_card_capture: true, form_ids: [<form_id>], includes_consent: false }` (adjust per template — some may have no card, some multiple forms).
- Every `send_reminder` with a `form_not_completed` precondition becomes an `intake_reminder` child action block with `parent_action_block_id` pointing at the intake package action. Config: `{ offset_days: <derived from offset_minutes>, message_body: <existing message> }`.
- Reminders without a precondition stay as `send_reminder` — they're appointment reminders, not intake reminders.
- Add a final `add_to_runsheet` action block per pre-appointment template (fires at `offset_minutes: 0, offset_direction: 'before'`), since every run-sheet workflow needs this.

For `getPostActionBlocks()` — **leave as-is**. Post-appointment workflows still use the legacy granular action types. Intake package model is pre-appointment only.

**Cross-check by reading existing intake_package logic:**

- `src/lib/workflows/handlers.ts` `case "intake_package"` — see how the handler reads config.
- Migration `014_intake_package_workflow.sql` — see the `intake_package_journeys` table structure and the `parent_action_block_id` FK.

**Verification:**

- Create a fresh org via the `/api/setup/clinic` flow. Inspect the resulting `workflow_templates` + `workflow_action_blocks` — confirm pre-appointment templates now emit `intake_package` blocks (not `deliver_form` + `capture_card`).
- Run a scanner pass (manually trigger `src/lib/workflows/scanner.ts` or wait for the cron) on a test appointment. Confirm an `intake_package_journeys` row is created and an SMS is logged with an `/intake/{token}` link.
- Tap the `/intake/{token}` link in dev → lands on your Phase 7 page (end-to-end integration between Piece 1 and Piece 2).
- `npm run build` and `npm run lint` — no new errors.

**Checkpoint:** Stop after Piece 2. Report back. Confirm the end-to-end dev loop (setup new clinic → add patient → workflow fires → SMS logged → tap link → journey renders) works before moving to Piece 3.

## Piece 3 — Intake Package Phase 8

**Reference:** `docs/specs/intake-package-execution-plan.md`, Phase 8 section.

**What you're refactoring:** The identity model in the intake journey. Today (after your Piece 1) the journey includes a capture step where the patient types their name and DOB. That's wrong for the intake package path: the clinic provides identity at add-patient time. The journey should just verify phone ownership and confirm the existing contact.

**Key changes:**

1. **`handleIntakePackage` no longer creates a contact.** Journey row seeds with `patient_id` from the appointment.
2. **`/api/intake/[token]/verify`** returns one of three shapes: `matched` (single contact → confirm screen), `multi_match` (several contacts → picker), `no_match` (error — data entry problem).
3. **Intake journey identity screen** renders confirm-only. No name/DOB inputs.
4. **Workflow template editor** drops the locked "Create patient contact" checklist row.
5. **Three specs updated**: `intake-package-workflow-spec.md`, `patient-entry-flows.md`, `onboarding-spec.md`.

Read the full Phase 8 section of the execution plan before coding. It has a detailed file list and work breakdown.

**Explicit constraints:**

- Do NOT change `/entry/[token]` — capture mode is legitimate there. Phase 8 only touches `/intake/[token]` and related spec docs.
- Do NOT change the add-patient panel — it already captures identity correctly.
- Do NOT introduce new action types. This is a refactor, not a new feature.

**Verification:**

- Add a patient via add-patient panel → `patients` + `patient_phone_numbers` + `appointments.patient_id` all populated.
- Workflow fires `intake_package` → `intake_package_journeys.patient_id` is set (not NULL).
- Tap SMS → verify phone → see "Hi [first name]. Is this you?" — not a name/DOB form.
- Multi-contact phone → picker renders.
- Data-entry-error phone (no contact for this number in org) → error screen with "Contact your clinic", not capture form.
- Editor no longer shows "Create patient contact" in intake package config.
- `npm run build` and `npm run lint` — no new errors.

**Checkpoint:** Stop after Piece 3. Report back with a summary of:

1. What you built across Pieces 1-3.
2. Any deviations from the specs (and why).
3. Any spec ambiguities you resolved unilaterally (and what you decided).
4. Confirm pieces 1-3 are stable before moving to Piece 4.

## Piece 4 — Onboarding

**Reference:** `docs/specs/onboarding-spec.md` (read it in full — it's ~700 lines and comprehensive).

**What you're building:** The five-step onboarding flow for new clinic owners, culminating in them running a Coviu video call with themselves as the patient on the other end. This is the downstream consumer of Pieces 1-3 — they enable the patient-side test experience.

**The five steps (summary from the spec):**

1. **Account** (`/signup`) — merged signup + clinic creation. Captures user details, clinic name, optional logo. No address. Writes `auth.users`, `users`, `organisations`, `locations`, `staff_assignments` in one transaction.
2. **PMS** (`/setup/pms`) — five-card grid. Gentu stub pre-populates appointment types, forms, rooms, clinicians. Others show "coming soon". Writes `pms_connections` row.
3. **Rooms** (`/setup/rooms`) — existing page, adapted to read `pms_connections` for pre-population. Clinic Owner auto-assigned to first room.
4. **Payments** (`/setup/payments`) — Stripe Connect stub. Writes `stripe_connections` row + populates `locations.stripe_account_id` so `payments_enabled` resolves true. Skip path leaves it NULL.
5. **First run sheet** (`/runsheet`) — overlay, "send me a test session" modal, SMS sent via `/api/onboarding/test-session`. Real-time coach-marks drive the user from queued → admit → video call → onboarding complete.

**New migration required (`019_onboarding.sql`):**

- `pms_connections` table + enums
- `stripe_connections` table + enum
- `users.onboarding_stage` enum column
- `users.has_seen_patient_journey` boolean
- `sessions.is_onboarding_demo` boolean
- `forms.is_platform_demo` boolean
- RLS policies for the two new tables

If migration number 019 is taken by the time you start, shift to the next available. The spec calls this out.

**New API routes:**

- `POST /api/setup/pms`
- `POST /api/setup/payments`
- `POST /api/onboarding/test-session`
- `POST /api/onboarding/advance-stage`

**Modified API routes:**

- `POST /api/setup/clinic` — add seeding of no-PMS floor (default appointment type, default forms) + platform demo form + re-run `seedDefaultWorkflows` after Gentu imports.

**New components:**

- `OnboardingOverlay`, `OnboardingTestSessionModal`, `OnboardingTooltip`, `OnboardingCoachMark`, `PmsSelectionGrid`, `StripeConnectStub`.

No `OnboardingEntryFlow` — the Phase 7 journey is the only patient-side flow. Tooltips are wrapped into Phase 7 screens conditionally based on the session's `is_onboarding_demo` flag.

**Middleware changes:**

- Extend `getSetupState()` in `src/lib/supabase/middleware.ts` to include `no_pms` and `no_payments` states in the chain. Existing states keep their current behaviour.

**Store changes:**

- Extend `useClinicStore` with an onboarding slice (stage, hasSeenPatientJourney, testSessionId, coachMarkDismissed). User-scoped, not location-scoped — doesn't flush on location switch.
- `ClinicDataProvider` hydrates the slice on layout render.

**Key behaviour to get right:**

- The test session writes `is_onboarding_demo = true` on the session AND creates the contact from `users.full_name` upfront (so the Phase 8 identity-confirm flow works when the user taps the SMS).
- The demo form has `is_platform_demo = true`. Every forms-list query in the clinic UI must exclude it. Audit existing forms queries and add the WHERE clause.
- The SMS link from `/api/onboarding/test-session` points to `/intake/{journey_token}`, not `/entry/{entry_token}`. The user experiences the full intake package journey on their phone.
- Coach-marks on the run sheet are driven by a combination of `users.onboarding_stage` and the test session's live status via `useClinicStore`. Stages progress `not_started → test_session_sent → call_active → call_completed`.
- Onboarding is complete when the video call ends, not when the SMS is sent. Stage transitions to `call_completed` on the existing `markSessionComplete` path.

**Explicit constraints:**

- Do NOT modify `AddSessionPanel`. Onboarding creates its test session via a dedicated route.
- Do NOT modify `EntryFlow` (the `/entry/[token]` path). Onboarding uses `/intake/[token]` from Phase 7.
- Do NOT modify existing LiveKit integration — onboarding uses it unchanged.
- Do NOT modify the existing Zustand + Realtime architecture. Onboarding is an additive slice.

**Verification checklist (end-to-end):**

- Sign up a brand new user. Cycle through all five setup steps. Land on `/runsheet`.
- Overlay appears. Click "Send me a test session". Modal opens. Enter the user's own phone number. Click Send.
- SMS is logged to console with a link like `https://.../intake/{journey_token}`.
- Session appears on the run sheet in `queued` state. Coach-mark 1 anchored to it: "Your test session is waiting...".
- Tap the SMS link (on phone, or copy the link into a second browser window on laptop). The Phase 7 journey renders with onboarding tooltips wrapped around each step.
- Verify phone → confirm identity ("Hi [first name], is this you?" — confirm mode from Phase 8) → checklist → card → demo form (with the signature field) → device test → waiting room.
- Waiting room shows the onboarding-specific nudge: "Check your laptop — the Admit button is the green button...".
- Laptop run sheet shows session transitioning to `waiting`. Coach-mark 2 appears, anchored to Admit, with pulse animation on the button.
- Click Admit → video call begins on laptop. Phone side connects into the same LiveKit room.
- Call both sides. Hear yourself. See yourself.
- End the call from either side. Session transitions to `complete`. Coach-mark 4 appears: "You just ran your first Coviu call...".
- Dismiss coach-mark. `users.onboarding_stage = 'call_completed'`. Overlay never appears again on subsequent `/runsheet` visits.
- Sign up a second new user. Skip PMS, skip payments. Verify the test session still works but the card capture step is skipped in the patient journey (because `locations.stripe_account_id` is NULL).
- Open the clinic Forms library as the onboarded user. The demo form is NOT visible. The seeded default forms (`New Patient Intake`, `Mental Health Assessment (K10)`, `Patient Satisfaction Survey`) ARE visible.
- `npm run build` and `npm run lint` — no new errors.

**Checkpoint (final):** Stop when all four pieces are done and verified.

## Operating guidelines

- **Work in the main branch** unless you hit something destabilising, in which case stop and ask.
- **Commit frequently**, one commit per piece minimum. Use descriptive messages; follow the repo's existing commit style.
- **Do not skip verification.** If verification fails, fix before moving on.
- **If you encounter an unexpected state** — files that should be empty aren't, specs that contradict, migrations that fail — stop and report. Don't paper over it.
- **If you're unsure about a spec detail**, read the referenced code first. The specs are guides; the code is the source of truth on what currently works.
- **Budget your effort.** Piece 1 is the largest of the prerequisites (~7 files, complex). Piece 2 is small but touches a critical seeder. Piece 3 is a refactor with spec updates. Piece 4 (onboarding) is substantial — a migration, 4 new API routes, 6 new components, middleware changes, store changes, plus end-to-end testing. Rough total across all four: 2-3 focused days.
- **Commit between pieces** so each is reviewable in isolation.

## Handoff

When all four pieces are done and verified, leave a final message summarising:

1. Files created/modified, grouped by piece (paths only — no diffs).
2. Migrations added and their filenames.
3. The end-to-end dev loop you ran to verify Piece 4 (the full user journey from signup to completed video call).
4. Any open questions or risks you noticed.
5. Anything in the specs that turned out to be wrong or unclear — surface it so the specs can be corrected.

Good luck.
