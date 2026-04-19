# COVIU

Feature Spec

# Onboarding

Sign-Up Through to First Video Call

April 2026

**CONFIDENTIAL**

---

## Overview

| **Surface** | Onboarding (sign-up through to the user's first Coviu video call) |
| --- | --- |
| **Users** | Clinic owners (the first user who creates the account) |
| **Available to** | All tiers. Prototype assumes Complete trial by default. |
| **Real-time** | Yes. During step 5 the user's laptop run sheet updates live as the user walks through the patient flow on their phone. |
| **Priority** | Foundation feature for new accounts. Must ship before self-serve signup is exposed. |

Onboarding is the journey from account creation to the user running a real Coviu video call on their own test session. Five steps, under ten minutes, ending with the user having experienced both sides of the platform: the clinic-side run sheet admitting a patient, and the patient-side intake journey from SMS to waiting room. The activation moment is the video call itself — the user launches a call, picks up on their phone, and feels what a consultation looks like from both sides.

This spec replaces the prototype scope section of the Auth & Clinic Setup spec. Role model, permissions, auth infrastructure, and session middleware remain as specified there.

---

## Activation Goal

Coviu's historical adoption problem is not signup conversion — it's that clinic owners sign up, explore the platform, and never actually run a video call on it because they don't have a real patient to test with. The platform stays shelfware. Onboarding exists to solve that specific problem: by the end of the flow, the user has launched a Coviu video call with themselves as the patient on the other end. They know the call works. They know how to admit a patient. They know what the patient sees. The activation event is the call completing, not the SMS being sent.

---

## Prerequisites

This spec assumes the following are already built (most of them are):

**Built already:**

- **Intake package workflow engine (phases 1–6 of `docs/specs/intake-package-workflow-spec.md`).** Migrations 013 and 014 landed. `intake_package_journeys` table exists. Workflow engine handlers for `intake_package`, `intake_reminder`, and `add_to_runsheet` action types are wired in `src/lib/workflows/handlers.ts`. Readiness dashboard, add-patient panel, appointment-types settings UI, and the `configure_appointment_type` RPC are all built. The engine fires, journey rows are created, SMS is sent.
- **Existing `form_assignments`-based checklist** (`docs/plans/patient-intake-checklist.md`). Shown after identity in `/entry/[token]`. Reads outstanding forms via `/api/patient/outstanding-items`. This is the Core-tier / run-sheet surface and is unchanged by onboarding.
- **Form handoff slide-out on the readiness dashboard.** `FormHandoffPanel` + `/api/readiness/form-submission` + `/api/readiness/mark-transcribed` all built and functional.
- **Zustand + Realtime architecture** — `useClinicStore`, `ClinicDataProvider`, layout-level hydration. Onboarding extends this store with new slices; no new caching system.

**Not yet built — prerequisites for this spec:**

- **Intake package Phase 7** (`docs/specs/intake-package-execution-plan.md` Phase 7). The patient-facing intake journey page and its API routes do not exist: `src/app/intake/[token]/page.tsx`, `src/app/intake/[token]/layout.tsx`, `src/app/api/intake/[token]/route.ts`, `src/app/api/intake/[token]/verify/route.ts`, `src/app/api/intake/[token]/complete-item/route.ts`, `src/components/patient/intake-journey.tsx`, `src/components/patient/intake-card-capture.tsx`. Workflow-fired intake package SMS links currently land on a 404. Onboarding's test session SMS uses the same `/intake/[token]` route, so Phase 7 must land first. Tracked in `TODO.md`.
- **Refactored `seed-defaults.ts`.** The seeder still emits legacy action types (`deliver_form`, `send_reminder`, `capture_card`, `verify_contact`) instead of the new `intake_package` / `intake_reminder` / `add_to_runsheet` blocks. Both types work (handlers support both), but new orgs' default workflows don't produce intake package journeys. Onboarding's demo requires the test session to fire the intake package flow, so the seeder must be refactored first. Tracked in `TODO.md`.

### Migration numbering

This spec reserves `019_onboarding.sql` based on the state of `supabase/migrations/` at time of writing (latest file: `018_ondemand_outcome_pathway.sql`). If other migrations land first, adjust the number at implementation time.

### Primer screen removal

A cross-cutting change this spec makes (not a prerequisite): the **primer screen** (`src/components/patient/primer-screen.tsx`) is removed from production. The `/entry/[token]` flow starts at OTP directly. This is noted in `docs/specs/patient-entry-flows.md` as a follow-up correction.

---

## Role Model Reference

Role model, permissions matrix, and the Clinic Owner vs Practice Manager distinction are unchanged from the Auth & Clinic Setup spec. The first user who signs up becomes the Clinic Owner. Additional team members are invited later.

---

## Prototype Scope

### What we build

- **Merged signup + clinic creation.** Full name, email, password, clinic name, optional logo. Creates the user, organisation, and location in a single transaction. No address captured.
- **Connect your PMS.** Five options as selectable cards. Gentu connects successfully with fake pre-populated data (appointment types, forms, rooms, clinicians). Other platforms show a "coming soon" state. Skip available.
- **Set up your rooms.** Pre-populated from Gentu if connected, otherwise one default room named "Dr [First Name]'s Room". Clinic Owner auto-assigned to first room. Existing `/setup/rooms` page, unchanged except for the pre-population path.
- **Set up patient payments.** Stubbed Stripe Connect. Two-second loading state, returns as connected. Writes a fake `stripe_account_id` to the location so `payments_enabled` resolves true in the patient flow. Skip available.
- **First run sheet and test session.** Guided overlay with a single "Create a test session" action. User enters their own phone. SMS sends via existing provider. Session appears on the run sheet with `is_onboarding_demo = true`.
- **Onboarding-specific patient flow.** Reuses production screens in a fixed order with tooltips wrapped around each step. Drives the user through a compressed but honest version of a Complete-tier intake package.
- **Real-time clinic-side updates.** The run sheet session transitions through states as the user progresses through the patient flow on their phone. Driven by existing Supabase Realtime subscriptions on the existing `useClinicStore`.
- **Coach-mark sequence on the run sheet.** Points at the Admit button when the session reaches waiting. User clicks Admit, video call starts on both devices. Onboarding completes when the call ends.

### What we cut

- **Location address capture.** Removed from `/setup/clinic` entirely. The `locations.address` column remains nullable but is not captured at signup. QR code check-in does not depend on address (the QR itself encodes the location token). Existing locations keep their addresses; new locations are created with `address = NULL`.
- **Tier selection.** All prototype accounts are created at `tier = 'complete'`. Tier selection is a later conversation, handled on a pricing page in-app.
- **Trial banner placement.** Deferred. The trial assumption is noted but the persistent in-platform banner is out of scope.
- **Real Stripe Connect flow.** Stubbed. Returns as connected after two seconds with a fake `acct_` reference.
- **Team invitations.** Clinic Owner only during onboarding. Additional roles seeded via the existing demo seed file.
- **"For myself" individual contractor path.** Clinic Owner path only.
- **PMS integrations beyond the Gentu stub.** Cliniko, Halaxy, Nookal, and Power Diary show "coming soon" states that let the user skip.
- **Free trial mechanics.** No trial countdown, no conversion prompt, no billing card capture. The Complete trial is an assumption, not a flow.
- **Tooltip replay.** The annotated patient journey is shown once per user. No "show me again" option.
- **Consent in the demo intake package.** Omitted to keep the test session as short as possible. Consent remains available for real intake packages configured by practice managers.
- **Primer screen.** Removed from production (see Prerequisites).
- **Process button coach-mark after the test call.** Deferred. Tracked in `TODO.md` as a v2 onboarding enhancement.
- **Mobile-only onboarding arc.** v1 assumes laptop-first. Tracked in `TODO.md`.

### What we explicitly preserve (no behaviour change)

- **`AddSessionPanel` is untouched.** The onboarding test session is created via a dedicated API route, not via the add-session panel. The panel's multi-patient / multi-room behaviour stays intact for real use.
- **`EntryFlow` is untouched.** Onboarding forks to `OnboardingEntryFlow` via a flag on the session. Real patients hit `EntryFlow` exactly as they do today.
- **Run sheet rendering is identical for demo sessions.** The `is_onboarding_demo` flag affects patient-side rendering only. The run sheet row, status transitions, Admit button, and video call behaviour are standard.
- **`stripe_routing` defaults to `location`.** No changes to the payment routing model.
- **Existing `useClinicStore` and `ClinicDataProvider`** are extended with new slices for onboarding state. No new store, no new provider, no new caching layer.
- **Middleware gate extends the existing state chain.** New states (`no_pms`, `no_payments`) slotted in. Existing states (`no_org`, `no_rooms`, `complete`) retain current behaviour.

---

## The Flow

Five steps. The user progresses linearly. Step 5 is a guided landing on the run sheet that ends with the user having launched a video call.

### Step Indicator

A step indicator sits at the top of the setup pages showing all five steps: **Account**, **PMS**, **Rooms**, **Payments**, **First session**. The current step is highlighted in teal. Completed steps show a green tick. Future steps are grey. The indicator is visible on steps 2, 3, and 4. Step 1 (account) and step 5 (first session) use their own page layouts. On mobile, the indicator collapses to "Step 3 of 5" with the current step name.

### Step 1: Account

| **Route** | `/signup` |
| --- | --- |
| **Purpose** | Create a Supabase Auth account, a user record, an organisation, and a location in a single transaction. |
| **Fields** | Full name, email, password, confirm password, clinic name, logo upload (optional, PNG or JPG, max 2MB). |
| **Validation** | Email format. Password minimum 8 characters. Passwords match. Name and clinic name required. Logo optional. |
| **Submit action** | One API route handles the whole transaction. |
| **Redirect on success** | `/setup/pms` |
| **Error states** | Email already registered shows login link. Weak password shows inline message. Network error shows retry toast. Logo upload failure is non-blocking. |
| **Layout** | Coviu logo centred above a card (max-width 480px). Form fields stacked. Logo upload as a drag-and-drop zone with preview. 'Create account' primary button. 'Already have an account? Log in' link below. |

The sign-up screen captures everything needed to stand up the user, the organisation, and the location in one transaction. **Address is not captured.** The location record is created with `address = NULL`.

The logo upload is optional and non-blocking. Upload failure leaves the clinic without a logo; the user can add it later in Settings.

Login behaviour is unchanged from the Auth & Clinic Setup spec. On successful login, the progressive gate redirects to the next incomplete onboarding step.

### Step 2: Connect Your PMS

| **Route** | `/setup/pms` |
| --- | --- |
| **Purpose** | Record the user's PMS choice and, for Gentu, pre-populate the org with fake imported data. |
| **Options** | Five cards: Cliniko, Halaxy, Nookal, Power Diary, Gentu. Each shows the platform logo and a short descriptor. |
| **Gentu path** | User clicks Gentu. Card shows a 'Connecting to Gentu' state for ~2 seconds. On success, card updates to 'Connected' with a summary: '4 clinicians, 12 appointment types, 3 rooms imported.' A 'Continue' button appears. |
| **Other platforms** | User clicks Cliniko, Halaxy, Nookal, or Power Diary. A modal appears: 'This integration is coming soon. We will let you know when it is ready. You can continue setting up your clinic and connect your PMS later in Settings.' Two buttons: 'Continue without PMS' and 'Choose a different PMS.' |
| **Skip option** | 'Skip for now' link at the bottom of the page. Continues to step 3 with no PMS connection. |
| **Data written** | `pms_connections` row (provider, status, imported_data JSON). For Gentu: appointment types, forms, rooms, clinician users + staff_assignments. After Gentu seeding completes, `seedDefaultWorkflows(org_id)` is re-run so workflow templates link to the newly created appointment types. |

The PMS step comes before rooms because a real PMS integration would pre-populate the room structure along with clinicians, appointment types, and forms. The prototype preserves this ordering so that the Gentu path demonstrates the full pre-population experience.

#### Gentu pre-populated data

The Gentu stub seeds the following against the user's organisation:

- **Appointment types:** Names must match what `seed-defaults.ts` looks up — `Initial Consultation`, `Follow-up Consultation`, `Telehealth Consultation`, `Review Appointment`, `Brief Check-in`, plus seven placeholder types. Telehealth and in-person modality mix. Default durations and fees.
- **Forms:** `New Patient Intake`, `Mental Health Assessment (K10)`, `Patient Satisfaction Survey`. Published status. These match the form names the workflow seeder looks up.
- **Rooms:** Dr Sarah Chen's Room, Dr Marcus Webb's Room, Dr Kate Murray's Room.
- **Clinicians:** Dr Sarah Chen, Dr Marcus Webb, Dr Kate Murray, Dr Amy Tran. Seeded as `auth.users` + `users` + `staff_assignments` (role = clinician).

After the above is inserted, `seedDefaultWorkflows(org_id)` is called again. This re-run now finds appointment types to link to and published forms to reference, so the workflow templates come out fully wired. The first seed call (triggered by `/api/setup/clinic` in the merged account step) will have created the templates with no links — this is expected and harmless; the second call just fills in the links.

#### No-PMS floor

If the user skips PMS, their org has no appointment types, no forms, and only one room (created on step 3). The onboarding test session in step 5 needs at minimum one appointment type tied to an intake package workflow. This spec requires the merged account step to seed a floor of default data even before PMS selection:

- **One default appointment type:** "Initial Consultation" (telehealth, 30 minutes, fee 0).
- **Two default forms:** a short clinical intake ("What brings you in today?", "How long has this been going on?") and a minimal info form ("Preferred name"). Published.
- **Workflow templates** via `seedDefaultWorkflows` — these will bind to the default appointment type and default forms.

This seeding happens unconditionally in `/api/setup/clinic` after org + location + staff_assignment creation. The Gentu path later adds more appointment types and forms alongside the defaults. The no-PMS path has the floor and nothing else.

### Step 3: Set Up Your Rooms

| **Route** | `/setup/rooms` |
| --- | --- |
| **Purpose** | Confirm or create the rooms that will appear on the run sheet. |
| **Pre-populated (Gentu)** | Three rooms shown as editable rows with a green 'imported' indicator. Copy above: 'We have set these up from your Gentu data. Edit, delete, or add rooms as needed.' |
| **Empty (no PMS)** | One pre-filled row: 'Dr [First Name]'s Room'. Editable. '+ Add another room' below. Copy above: 'Rooms group sessions on your run sheet. You can change this later in Settings.' |
| **Minimum** | One room required to proceed. |
| **Auto-assign** | Clinic Owner automatically assigned to the first room via `clinician_room_assignments`. |
| **Submit action** | Create rooms, create clinician_room_assignment for Clinic Owner and first room, redirect to `/setup/payments`. |

This page already exists and works for the no-PMS empty path. The spec adds the Gentu-pre-populated path.

### Step 4: Set Up Patient Payments

| **Route** | `/setup/payments` |
| --- | --- |
| **Purpose** | Connect Stripe so the clinic can accept payments from patients. Stubbed for the prototype. |
| **Content** | Heading: 'Accept payments from patients.' Explainer: 'Connect Stripe to take payments from patients during check-in and after sessions. You can set this up now or skip and configure it later in Settings.' |
| **Primary action** | 'Connect with Stripe' button (teal). Clicking shows 'Connecting to Stripe' with spinner for ~2 seconds. On success: 'Connected: acct_onboarding_XXXX. Ready to accept payments.' A 'Continue' button appears. |
| **Skip option** | 'Skip for now' link. |
| **Data written** | `stripe_connections` row (status, stripe_account_id). On connect: `locations.stripe_account_id` also set to the fake account reference so `payments_enabled` resolves true in the patient flow. On skip: `locations.stripe_account_id` remains NULL and the card step is skipped in the test session. |

The payments step is about the clinic accepting payments *from patients*. It is not about billing the clinic for their Coviu subscription. The copy reflects this. Trial mechanics are assumed pre-communicated (marketing site, sales conversation) and are not surfaced during onboarding.

The skip path is honest to the real product behaviour: the patient flow's card step is gated by `payments_enabled`, which reads from `locations.stripe_account_id`. If the user skips payments, their test session's patient flow will also skip the card step. The tooltip for that step simply doesn't appear.

### Step 5: First Run Sheet

| **Route** | `/runsheet` (unchanged — onboarding state is read from `users.onboarding_stage`, not a query param) |
| --- | --- |
| **Purpose** | Land the user on the run sheet, guide them through sending themselves a test SMS, and drive the activation arc through to a completed video call. |
| **Initial state** | Empty run sheet with the user's room visible. Overlay appears immediately on first landing. |
| **Overlay content** | Heading: 'Your clinic is ready.' Body: 'Let's create your first session so you can see what patients experience. We'll send the SMS to your phone so you can walk through it yourself — and then we'll start a real Coviu video call.' Primary action: 'Send me a test session.' |
| **Action on 'Send me a test session'** | Opens a compact phone-number modal (not the AddSessionPanel). Single field: 'Your mobile number'. Primary button: 'Send SMS'. |
| **On 'Send SMS'** | POST to `/api/onboarding/test-session`. Creates appointment + session (with `is_onboarding_demo = true`) + intake package journey + SMS send. Sets `users.onboarding_stage = 'test_session_sent'`. Closes modal. |
| **Banner on success** | Teal banner at the top of the run sheet: 'We've sent the SMS to your phone. Tap the link to see what your patients experience. Come back when you're in the waiting room.' Dismissible via X. |
| **Step indicator** | Hidden from step 5 onwards — user is now on the real run sheet. |

The overlay appears only on first landing. Tracked via `users.onboarding_stage = 'not_started'`. Dismissal without creating a test session progresses `onboarding_stage` to `test_session_sent = false` but the overlay does not return — the user can always create a test session manually later via the normal Add Session flow.

After the SMS is sent, the user has two parallel things happening: the laptop shows the run sheet with the queued session, and the phone receives the SMS. From here, three coach-marks drive the rest of the activation arc (see [The Activation Arc](#the-activation-arc)).

---

## The Onboarding Patient Flow

When the user taps the SMS on their phone, they land on `/intake/[token]` (the intake package journey page, per the intake package spec). This spec adds a fork: if the intake package journey is tied to a session with `is_onboarding_demo = true`, the page renders `OnboardingEntryFlow` instead of the standard intake journey component.

### Why a fork

Three reasons:

1. **Fixed step sequence.** The demo needs to walk the user through the full patient surface area regardless of what the default workflow template configured. Hardcoding the sequence keeps the demo deterministic.
2. **Tooltip layer.** Every screen has an onboarding-specific tooltip. The standard intake journey has no tooltips.
3. **Compression framing.** A real intake package is sent days before the appointment and patients complete it across multiple sittings. The demo compresses all of that into one session and says so explicitly.

### Identity: confirm mode, not capture mode

The onboarding test session is a Complete-tier intake package journey. In Complete, the clinic provides the patient's first name, last name, phone number, and optionally DOB when adding them to the run sheet — proof of identity is asserted by the clinic at that point. The patient's phone OTP then proves **ownership** of the phone number the clinic asserted against. The identity step is a confirm-only screen: *"Please confirm who this appointment is for"* with the contact name, not a capture form.

For onboarding, the clinic is the user themselves. The user's own details from signup (`users.full_name`, plus the phone number they enter into the test-session modal) are used to create a patient contact upfront in `/api/onboarding/test-session`. When the user then taps their SMS and verifies their phone, the intake journey resolves the existing contact and renders confirm mode.

This matches what a real Complete patient experiences. It also removes the awkward moment where the user would otherwise re-type their own name.

Phase 8 of the intake package execution plan realigned the journey identity model to confirm-only, so `/intake/[token]` never renders a capture form. Capture mode is exercised only by `/entry/[token]` for Core-tier phone-only SMS entries, on-demand links, and QR paths.

### Sequence

The onboarding patient flow, in order, running inside `/intake/[token]` (Phase 7 route):

1. **Phone OTP** — verifies ownership of the phone number the clinic (user) provided at test-session creation. Uses `PhoneVerification`.
2. **Intake checklist** — the Phase 7 checklist screen. Shows the user what they're about to complete: confirm identity, save a card, complete 1 form, test device. Composed from the demo intake package's config.
3. **Identity confirmation** (confirm mode) — "Please confirm who this appointment is for" with the user's name. The contact already exists. Rendered inline by the intake journey (the shared `IdentityConfirmation` component is only used by `/entry/[token]` post-Phase-8).
4. **Card capture** — uses `CardCapture`. Skipped if the user skipped the payments step at setup and `locations.stripe_account_id` is NULL.
5. **Demo form** — one form, not two. Uses `FormFillClient` with the seeded per-org demo form (see "Platform-level demo form" below). A `form_assignments` row is created for the test patient on test-session creation so the Phase 7 journey recognises it as outstanding.
6. **Device test** — uses `DeviceTest`.
7. **Waiting room** — uses `WaitingRoom` with an onboarding-specific overlay nudge: *"Your clinician is about to admit you. Check your laptop — the Admit button is the green button on your session row."*

Seven steps. No primer. No second demo form. Keeping it lean matters: the user is a clinician, they've done ten things already in setup, and the activation moment is the video call that comes next.

### Platform-level demo form

One demo form exists per org, seeded into the org's own `forms` table on clinic creation. It is flagged so it never appears in the user's Forms library, workflow editors, or form picker dropdowns. The user cannot see it, edit it, or delete it. They can only encounter it through the onboarding test session.

Schema addition: `forms.is_platform_demo boolean default false`. Every forms-list query in the clinic UI adds `AND is_platform_demo = false`. The column is not nullable. The demo form still has an `org_id` pointing at the user's own org — no sentinel architecture, no nullable columns.

Seeded content: a short form with three fields — a text question ("What brings you in today?"), a multi-line question ("How long has this been going on?"), and a signature field. The signature field makes the demo visibly different from ordinary data capture and maps naturally to the tooltip: *"Forms can include signature fields for consent."*

The onboarding test-session route creates a `form_assignments` row against the test patient + demo form ID. The Phase 7 checklist picks it up via the existing assignment-resolution logic.

### Tooltip layer

A new `OnboardingTooltip` component wraps each screen. Reads `users.has_seen_patient_journey`. Dismissible. One tooltip per screen. Copy framed in terms of Complete-tier configurability.

| **Screen** | **Tooltip target** | **Tooltip copy** |
| --- | --- | --- |
| Phone OTP | OTP input field | Phone verification proves ownership of the number you have on file for this patient. Always required. |
| Intake checklist | The checklist itself | Configurable per appointment type in Workflows. Real patients receive this days before their appointment and can complete it across multiple sittings. |
| Identity confirmation (confirm) | Contact card | You provided this patient's name when you scheduled them. They just confirm it's the right person. First-time on-demand patients without a scheduled appointment go through a capture flow instead. |
| Card capture | Card form | Card storage is optional. Toggle it per intake package in Workflows. |
| Demo form | The form fields | Build your own forms in the Forms library. Drag and drop, any question types including signatures. |
| Device test | Device status section | Device tests run automatically for telehealth appointments. |
| Waiting room | Waiting message | Customise the waiting room message per clinic or per clinician in Settings. |

Tooltips dismiss on tap X or tap outside. Dismissal flips `users.has_seen_patient_journey = true`. Subsequent visits to any patient screen render without tooltips.

---

## The Activation Arc

The activation arc is the coach-marked sequence on the **laptop** (clinic side) that runs from test session creation through to the video call ending. This is the moment the platform feels real.

### Stages

`users.onboarding_stage` is an enum with four values: `not_started`, `test_session_sent`, `call_active`, `call_completed`. Progression is one-way. The stage drives which coach-mark is visible on the run sheet.

### Coach-mark sequence

`OnboardingCoachMark` is a new component distinct from the patient-side `OnboardingTooltip`. It anchors to run sheet elements and is driven by `onboarding_stage` combined with the current session state (which is already in `useClinicStore`).

1. **Stage = `test_session_sent`, session status = `queued`** → Coach-mark anchored to the test session row: *"Your test session is waiting for your patient to arrive. Tap the SMS on your phone to begin the patient journey."*

2. **Stage = `test_session_sent`, session status = `waiting`** → Coach-mark anchored to the Admit button: *"Your test patient is ready. Click Admit to start the video call."* The Admit button is pulsed (a CSS animation on the button when this coach-mark is active) so it's impossible to miss.

3. **Stage = `call_active`** → No coach-mark on the laptop run sheet. The call is active; focus is on the video window. A subtle persistent hint at the top of the video window: *"You're in a Coviu call. Pick up on your phone to see both sides."* Stage transitions to `call_active` when `admitPatient()` is called on the test session.

4. **Stage = `call_completed`** → Coach-mark anchored to the test session row (now in `complete` state): *"You just ran your first Coviu call. You've seen both sides of the platform. Welcome aboard."* Single dismiss button: 'Got it.' Dismissing clears the coach-mark permanently. Stage transitions to `call_completed` when the call ends (either side).

### Run sheet live updates

Driven by existing Supabase Realtime subscriptions consumed by `useClinicStore`. As the user progresses through the patient flow, the `useClinicStore` receives updates and re-renders the session row. No new subscription code.

| **Patient screen** | **Session state change** | **Run sheet behaviour** |
| --- | --- | --- |
| OTP verified | (no session status change) | Session row shows contact linked. |
| Intake checklist viewed | (no session status change) | — |
| Identity confirmed | Intake package journey row updated | — |
| Card captured | Intake package journey `card_captured_at` set | Session row card indicator updates to 'Card on file'. |
| Forms completed | Intake package journey `forms_completed` updated | — |
| Device test passed | Session `device_tested = true` | — |
| Waiting room entered | Session status → `waiting` | Session row background → soft amber, badge → 'Waiting', Admit button appears, coach-mark 2 appears. |
| Admit clicked | Session status → `in_session` | Video call begins on laptop; phone navigates to call. Coach-mark 2 dismisses, video hint appears. Stage → `call_active`. |
| Call ended (either side) | Session status → `complete` | Session row → blue badge 'Complete'. Stage → `call_completed`, coach-mark 4 appears. |

### Patient-side waiting room nudge

`WaitingRoom` component accepts a new prop `isOnboardingDemo?: boolean`. When true, renders an overlay at the top of the waiting screen: *"Your clinician is about to admit you. Check your laptop — look for the green Admit button."* Overlay is non-dismissible (it clears when the patient is admitted).

The real `WaitingRoom` is unchanged for real patients — the prop defaults to false.

### Video call

Reuses the existing LiveKit integration unchanged. The test session uses a standard LiveKit room. The user is connected on their laptop via the clinician's video interface and on their phone via the patient's video interface. They see and hear themselves on both devices.

### Onboarding completion

Onboarding is considered complete when `users.onboarding_stage = 'call_completed'`. The progressive gate, the coach-mark overlay system, and the stage tracking all key off this value.

If the user abandons mid-arc (closes the laptop after sending the SMS, doesn't click Admit, leaves the call early), they come back to whichever coach-mark matches their current stage + session state. The arc is resumable.

---

## Data Flow and State Management

This spec extends the existing `useClinicStore` (Zustand) with new slices. No new caching layer, no TanStack Query, no separate stores.

### Store additions

```typescript
// Extensions to useClinicStore
interface OnboardingSlice {
  stage: 'not_started' | 'test_session_sent' | 'call_active' | 'call_completed';
  hasSeenPatientJourney: boolean;
  testSessionId: string | null;
  coachMarkDismissed: Record<OnboardingStage, boolean>;
}
```

### User-scoped state (new pattern)

Every existing slice of `useClinicStore` is scoped by **location** or **org** — sessions for a location, rooms for a location, workflow templates for an org, etc. The onboarding slice is the first **user-scoped** data in the store: `onboarding_stage` and `has_seen_patient_journey` are columns on `users`, and they do not vary by selected location.

Two implications:

1. **No location-switch invalidation.** When the user switches locations in the app-level switcher, the clinic data slices flush and re-hydrate for the new location. The onboarding slice must *not* flush — it's the same user regardless of location. The hydration code in `ClinicDataProvider` needs to treat user-scoped and location-scoped state as distinct reset boundaries.
2. **Single source of truth.** Since the onboarding columns live on `auth.uid()`, they can be fetched once at layout render and never re-fetched on navigation. Location switches don't affect them. The only mutations come from onboarding-specific API routes, which return the new stage and update the store directly.

Future user-scoped slices (e.g. notification preferences, UI settings) should follow this same pattern. This spec is the first one to introduce it, so it's worth naming explicitly.

### Layout hydration

`ClinicLayout` (server component) already performs parallel pre-fetches. Extend the fetch list with `fetchOnboardingState(userId)` which reads the two onboarding columns from `users` and looks up the test session if `test_session_sent`. The result is hydrated into the store alongside the existing slices in `ClinicDataProvider`.

### Realtime subscriptions

No new channels. The test session is a normal session — it flows through the existing `runsheet` and `runsheet-participants` channels. The intake package journey is picked up by the existing intake journey subscription (added by the intake package build). The coach-mark visibility is derived client-side from the stage + session state, both of which are in the store.

### Mutations

Four new API routes. Each is a thin endpoint that writes to the database and returns the new state. No optimistic updates in v1 — the round-trip is fast enough for these flows and the complexity isn't worth it.

- `POST /api/setup/pms` — records connection, seeds Gentu data if applicable, re-runs `seedDefaultWorkflows`.
- `POST /api/setup/payments` — records stub connection, updates `locations.stripe_account_id`.
- `POST /api/onboarding/test-session` — creates appointment + session + intake journey + sends SMS, sets `onboarding_stage = 'test_session_sent'`.
- `POST /api/onboarding/advance-stage` — moves `onboarding_stage` forward (called from the admit action and the call-end handler).

Existing routes (`/api/setup/clinic`, `/api/setup/rooms`, `/api/patient/arrive`, Livekit admit, etc.) are modified minimally or not at all.

### Server components + caching

The setup pages (`/setup/pms`, `/setup/payments`) follow the existing pattern: thin server component for initial render, client component for interactivity. No data caching concerns — these are one-shot form submissions.

The run sheet page is already hydrated via layout-level prefetch. Onboarding state is added to the prefetch set. No page-level loading spinners; the overlay and coach-marks render based on the hydrated store.

---

## Schema Changes

### Migration `019_onboarding.sql`

```sql
-- PMS connections
CREATE TYPE pms_provider AS ENUM ('cliniko', 'halaxy', 'nookal', 'power_diary', 'gentu');
CREATE TYPE pms_connection_status AS ENUM ('connected', 'skipped', 'pending');

CREATE TABLE pms_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider pms_provider NOT NULL,
  status pms_connection_status NOT NULL,
  imported_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

-- Stripe connections (setup-step record, distinct from locations.stripe_account_id)
CREATE TYPE stripe_connection_status AS ENUM ('connected', 'skipped');

CREATE TABLE stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  status stripe_connection_status NOT NULL,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

-- Onboarding stage on users
CREATE TYPE onboarding_stage AS ENUM ('not_started', 'test_session_sent', 'call_active', 'call_completed');
ALTER TABLE users ADD COLUMN onboarding_stage onboarding_stage NOT NULL DEFAULT 'not_started';
ALTER TABLE users ADD COLUMN has_seen_patient_journey BOOLEAN NOT NULL DEFAULT false;

-- Onboarding demo flag on sessions
ALTER TABLE sessions ADD COLUMN is_onboarding_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_sessions_onboarding_demo ON sessions(is_onboarding_demo) WHERE is_onboarding_demo = true;

-- Platform demo flag on forms — hides the onboarding demo form from the clinic's UI
ALTER TABLE forms ADD COLUMN is_platform_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_forms_platform_demo ON forms(org_id) WHERE is_platform_demo = false;
-- Every forms-list query in the clinic UI must add `AND is_platform_demo = false`.
-- The demo form still has a real org_id pointing at the user's own org.

-- RLS: new tables scoped via staff_assignments → locations.org_id
ALTER TABLE pms_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read org pms_connections"
  ON pms_connections FOR SELECT
  USING (org_id IN (
    SELECT l.org_id FROM staff_assignments sa
    JOIN locations l ON l.id = sa.location_id
    WHERE sa.user_id = auth.uid()
  ));

CREATE POLICY "Staff can read org stripe_connections"
  ON stripe_connections FOR SELECT
  USING (org_id IN (
    SELECT l.org_id FROM staff_assignments sa
    JOIN locations l ON l.id = sa.location_id
    WHERE sa.user_id = auth.uid()
  ));

-- Service-role writes bypass RLS as usual.
```

### What is explicitly NOT changed

- `session_participants` — phone number stays on `appointments`, not here.
- `staff_assignments` — no `org_id` column added; org is derived via `locations.org_id`.
- `sessions.entry_token` — unchanged; remains the token used in SMS deep links.
- `users.id = auth.users.id` — unchanged; no `auth_id` column introduced.
- `organisations.tier` — remains a TEXT column with CHECK constraint; no enum migration.
- `appointments`, `appointment_types`, `rooms`, `locations`, `organisations` — no column additions or type changes. `locations.address` remains nullable; just stops being captured at signup.
- `intake_package_journeys` — unchanged; demo intake packages use the same table as real ones.
- Existing enums (`user_role`, `session_status`, `action_type`, etc.) — untouched.
- Existing RLS policies — untouched.

### Seed data changes

`supabase/seed.sql` is not changed by this migration. The development seed data already populates `Sunrise Allied Health` with addresses, clinicians, etc., and keeps working. New orgs created through onboarding do not go through the seed file — they go through `/api/setup/clinic`, which after this spec lands also seeds:

- One default appointment type (no-PMS floor, described above).
- Default forms (from the workflow seeder's expected names).
- The **platform demo form** — a single form with `is_platform_demo = true`, `org_id` pointing at the user's own org. Three fields: "What brings you in today?" (text), "How long has this been going on?" (text), signature field. Always seeded, regardless of PMS path. Every clinic has exactly one.
- Default workflow templates via `seedDefaultWorkflows`. After the seeder is refactored (prerequisite), these will be intake package workflows that bind to the default appointment type.

---

## API Routes

### New routes

**`POST /api/setup/pms`**

Body: `{ provider: 'cliniko' | 'halaxy' | 'nookal' | 'power_diary' | 'gentu' | null, skipped: boolean }`.

If `provider === 'gentu'`: seeds appointment types, forms, rooms, clinicians against the user's org. Then re-runs `seedDefaultWorkflows(org_id)` so workflow templates link to the newly created types. Writes `pms_connections` row. Returns `{ ok: true }`.

If `skipped` or another provider: writes `pms_connections` row with status `skipped`. No seeding. Returns `{ ok: true }`.

**`POST /api/setup/payments`**

Body: `{ skipped: boolean }`.

If not skipped: generates a fake `acct_onboarding_{random}` reference. Writes `stripe_connections` row with status `connected` and the fake ref. Updates `locations.stripe_account_id` for the user's location with the same ref so `payments_enabled` resolves true.

If skipped: writes `stripe_connections` row with status `skipped`. `locations.stripe_account_id` remains NULL.

**`POST /api/onboarding/test-session`**

Body: `{ phone_number: string }`.

This route creates the full Complete-tier intake package journey for the test session in one transaction:

1. **Create patient contact from the user's own details.** First name from `users.full_name` (split on first space; remainder becomes last name; if only one name, last name is empty). Phone number from the request body. Inserts into `patients` (with the user's org) and `patient_phone_numbers` (primary). Identity proof is asserted by virtue of the user being the clinician creating the record — same model as the real Complete flow.
2. **Create the appointment.** Tied to the seeded default appointment type (or the first Gentu-imported type if Gentu was connected), the user's location, the user's own room, scheduled ~5 minutes from now. `patient_id` set to the contact created above.
3. **Create the session.** `is_onboarding_demo = true`, status `queued`. This populates the run sheet immediately.
4. **Create the intake package journey.** One `intake_package_journeys` row. Config: `{ includes_card_capture: payments_enabled, includes_consent: false, form_ids: [demo_form_id] }`. The demo form ID is looked up by `org_id` + `is_platform_demo = true`.
5. **Create the form assignment.** One `form_assignments` row against the test patient + demo form, tied to the appointment. The Phase 7 checklist picks it up as an outstanding item.
6. **Send the SMS.** Via existing `sms.sendNotification`. Link is `${APP_URL}/intake/${journey_token}` (the Phase 7 route), not `/entry/${entry_token}`.
7. **Mark stage.** `users.onboarding_stage = 'test_session_sent'`.

Returns `{ session_id, journey_token }`. The `entry_token` on the session is still populated (for `add_to_runsheet` path compatibility) but not used by onboarding.

**`POST /api/onboarding/advance-stage`**

Body: `{ to: 'call_active' | 'call_completed' }`.

Transitions `users.onboarding_stage` forward (never backward). Idempotent. Called from:
- the admit button handler when the admitted session is the user's test session → `'call_active'`,
- the call-end handler (already exists for `markSessionComplete`) when the completed session is the user's test session → `'call_completed'`.

Returns `{ ok: true, stage }`.

### Modified routes

**`POST /api/setup/clinic`** — adds three things after the existing org + location + staff_assignment creation, before the first `seedDefaultWorkflows` call:

1. Seed the no-PMS floor: one default appointment type (`Initial Consultation`, telehealth, 30min) + default forms matching the names the workflow seeder looks up (`New Patient Intake`, `Mental Health Assessment (K10)`, `Patient Satisfaction Survey` — all with `is_platform_demo = false`).
2. Seed the platform demo form: one form with `is_platform_demo = true`, `org_id = org.id`, three fields as described in "Platform-level demo form" above.
3. Any forms-list query added by onboarding (or modified in existing UI) must exclude `is_platform_demo = true`.

No change to the request or response shape.

### Unchanged routes

`/api/patient/arrive`, Livekit token endpoints, admit/end-call actions, `createSessions` in `src/lib/runsheet/mutations.ts`, form submission endpoints — all unchanged. The Phase 7 `/api/intake/[token]/*` routes are used as-is. Demo sessions flow through the Phase 7 journey identically to real ones; the `is_onboarding_demo` flag on the session only affects the waiting room's tooltip nudge and the coach-mark visibility on the laptop side.

---

## Components

### New components

- **`OnboardingOverlay`** — first-run modal on `/runsheet`. Reads `onboarding_stage` from the store. Renders when stage is `not_started`.
- **`OnboardingTestSessionModal`** — compact phone-number modal. Calls `/api/onboarding/test-session`.
- **`OnboardingTooltip`** — floating tooltip for the patient-side flow. Wraps each step in the Phase 7 journey when `is_onboarding_demo = true` on the associated session. Reads `has_seen_patient_journey`.
- **`OnboardingCoachMark`** — floating coach-mark for the clinic-side run sheet. Anchors to DOM elements. Driven by `onboarding_stage` + current session state from the store.
- **`PmsSelectionGrid`** — the five-card grid for `/setup/pms`.
- **`StripeConnectStub`** — the button + states for `/setup/payments`.

No `OnboardingEntryFlow` component. The Phase 7 journey page (`src/app/intake/[token]/page.tsx`) is the only patient-side flow for onboarding. Tooltip visibility is gated by reading `is_onboarding_demo` from the session linked to the intake package journey, so no fork component is needed.

### Reused components (unchanged)

- `PhoneVerification`, `CardCapture`, `DeviceTest`, `WaitingRoom`, `FormFillClient`. (`IdentityConfirmation` is used by `/entry/[token]` only; the intake journey renders confirm-mode identity inline.)
- The Phase 7 intake journey page and its subcomponents (`intake-journey.tsx`, `intake-card-capture.tsx`, checklist screen).
- `AddSessionPanel` (not used by onboarding, left alone).
- All run sheet components (`RunsheetShell`, session rows, session-row indicators, Admit button).
- All LiveKit video call components.
- `ClinicDataProvider`, `useClinicStore`.
- `FormHandoffPanel` on readiness (slide-out for clinicians to review the patient's demo form submission, if they choose to go there post-call).

### Modified components

- **`WaitingRoom`** — accepts new optional prop `isOnboardingDemo: boolean`. When true, overlays the nudge message. Zero impact when false.
- **Phase 7 journey components** — wrap each step with `OnboardingTooltip` when `is_onboarding_demo` is true on the associated session. The tooltip component no-ops when the flag is false, so the change is additive.
- **Intake journey identity screen** — renders confirm-only for the single-match case and picker-only for multi-match. Onboarding always produces a single match since the test session's contact is created from `users.full_name` upfront.
- **`ClinicLayout`** — extends the prefetch set to include onboarding state.
- **`ClinicDataProvider`** — hydrates the onboarding slice into the store.
- **Forms-list queries** — every query that populates the clinic's Forms library, workflow editor form picker, or form assignment dropdown adds `AND is_platform_demo = false`. Precise list of files at implementation time.

---

## Middleware / Progressive Gate

The middleware already enforces a setup chain: `no_org → no_rooms → complete`. The new chain is:

`no_org → no_pms → no_rooms → no_payments → complete`

Each state maps to a redirect target:

- `no_org` → `/setup/clinic`
- `no_pms` → `/setup/pms`
- `no_rooms` → `/setup/rooms`
- `no_payments` → `/setup/payments`
- `complete` → `/runsheet`

State resolution in `getSetupState()`:

1. No `staff_assignments` row for user → `no_org`
2. No `pms_connections` row for org → `no_pms`
3. No `rooms` for location → `no_rooms`
4. No `stripe_connections` row for org → `no_payments`
5. All present → `complete`

The `x-setup-complete` cookie continues to work as a performance hint (5-minute TTL, skips the DB queries on subsequent navigations). Important: the cookie is set only when state resolves to `complete`. It does not need invalidation on intermediate step completion — each setup step redirects to the next step, which re-runs `getSetupState()` on arrival and never reads the cookie until state has actually reached `complete`. The cookie therefore has no interaction with the new `no_pms` / `no_payments` states beyond the existing `complete` check.

The one subtlety: if a user somehow has a `x-setup-complete` cookie from a prior session and their org state has regressed (e.g. an admin rolled back a `pms_connections` row), the cookie would serve a stale "complete" verdict for up to 5 minutes. This is a pre-existing property of the cookie, not introduced by this spec, and the JWT validation path still runs on every request — so the worst case is a clinic user hitting `/runsheet` with a stale setup verdict that corrects itself on cookie expiry. Not worth fixing in v1.

Once `state === 'complete'`, the user lands on `/runsheet`. `onboarding_stage` is not checked by middleware — it only drives the overlay and coach-mark rendering in the client.

---

## Edge Cases

| **Scenario** | **Behaviour** |
| --- | --- |
| User abandons setup mid-flow | Progressive gate redirects to the next incomplete step on next login. |
| User connects Gentu then navigates back | Connection persists. Rooms step shows imported rooms. |
| User skips PMS, skips payments, completes onboarding | Lands on run sheet. Test session still works — uses the seeded default appointment type. Patient flow skips the card step. |
| User doesn't enter phone on test session modal | Send button disabled until a valid mobile is entered. |
| User enters someone else's phone number | SMS sends to that number. The test session appears on the run sheet. The arc still works — the activation still requires the user to pick up the call, which they can do as long as they have access to that phone. |
| User closes the laptop after step 5 modal but before tapping SMS | On next login: `onboarding_stage = 'test_session_sent'`, session is `queued`. Coach-mark 1 still showing. Banner reminds them to tap their SMS. |
| User taps SMS after onboarding is already complete (`call_completed`) | `OnboardingEntryFlow` still renders (driven by `is_onboarding_demo` on the session), but `has_seen_patient_journey = true` suppresses tooltips. The user can re-run the flow as a refresher — read-only experience. |
| User deletes the test session before tapping SMS | Session removed. SMS link returns 'session not found'. `onboarding_stage` rolls back to `not_started`. Overlay returns on next `/runsheet` visit. |
| User onboards on mobile | v1: supported for setup steps 1–4. Step 5 shows a gate message: 'Open this on your laptop to send yourself a test session and run your first call.' Not a blocker for setup completion. |
| User's phone doesn't receive SMS | SMS provider (Vonage or console) returns an error or delivers late. Session row shows a 'Resend SMS' action. User can retry. |
| Gentu stub fails during the 2-second delay | Toast: 'Connection failed. Try again or choose a different PMS.' User can retry, pick another, or skip. |
| Stripe stub fails during the 2-second delay | Toast: 'Connection failed. Try again or skip.' User can retry or skip. |
| User refreshes a setup page mid-form | Form state not preserved. User re-enters data for that step. Completed steps remain complete. |
| User starts a test call, disconnects phone, never ends call | Call auto-ends when the LiveKit room times out (existing behaviour). `markSessionComplete` fires, `onboarding_stage` → `call_completed`. |
| User tries to run a second test session after completing onboarding | Uses the normal Add Session flow. `is_onboarding_demo` is false. No coach-marks, no tooltips. Production behaviour. |

---

## Accessibility

- **Keyboard navigation:** All fields and buttons reachable via Tab. Enter submits. Escape dismisses modals and tooltips.
- **Focus management:** After each redirect, focus moves to the first input on the new screen. After the first-session overlay appears, focus moves to the primary action button. When a coach-mark appears, focus does not change — the user's current context is preserved — but the coach-mark is announced via aria-live.
- **Tooltip accessibility:** `OnboardingTooltip` uses `role="tooltip"` and `aria-describedby` linking to the anchored element. Dismissible via Escape in addition to tap.
- **Coach-mark accessibility:** `OnboardingCoachMark` uses `role="status"` (not `alert`, to avoid interrupting). `aria-live="polite"`. The pulsed Admit button in coach-mark 2 has a visible focus ring as well as the pulse animation so keyboard users aren't dependent on the animation.
- **Real-time announcements:** The run sheet session status area uses `aria-live="polite"` so screen readers announce queued → waiting → in_session → complete transitions.
- **Step indicator:** `aria-current="step"` on the active step. Completed steps announced as "complete".
- **Colour contrast:** Teal tooltip background with white text passes WCAG AA. Coach-mark backgrounds meet contrast against the run sheet card background.

---

## Decision Summary

| **Decision** | **Choice** | **Rationale** |
| --- | --- | --- |
| Number of setup steps | Five (merged account, PMS, rooms, payments, first session) | Balances guided progression with minimal friction. |
| Signup + clinic creation | Merged into one step | Removes an interstitial page and pulls clinic name into the same transaction as the user. |
| Location address capture | Dropped entirely | QR check-in uses `qr_token`, not address. Address was capturing data with no consumer. |
| Tier default | `complete` (unchanged) | Matches existing code. Trial framing handled outside onboarding. |
| PMS step placement | Before rooms | Gentu pre-populates the room list, mirroring the real Complete-tier onboarding narrative. |
| Non-Gentu PMS options | Shown as "coming soon" | Honest about the product's integration roadmap without faking four integrations. |
| Payment step writes `locations.stripe_account_id` | Yes | So `payments_enabled` resolves true and the patient flow's card step renders. Honest to production behaviour. |
| No-PMS floor (default appointment type + forms) | Seeded in `/api/setup/clinic` | So the onboarding test session has something to bind to even if Gentu is skipped. |
| Test session path | Dedicated `/api/onboarding/test-session` route | Keeps `AddSessionPanel` untouched. Onboarding is a separate creation path. |
| Patient-flow path | Reuse Phase 7 intake journey, no fork component | `is_onboarding_demo` flag on the session (read via the journey) gates tooltip visibility. Zero behaviour change for real intake journeys. |
| Identity step mode | Confirm only (never capture) | The user as clinic provides the test patient's identity upfront via `users.full_name`. Mirrors real Complete-tier behaviour. Capture mode is exercised only by on-demand Core entries. |
| Demo intake package contents | Create contact (confirm) + card capture + 1 form (with signature field) + device test. No consent, no second form. | The user has already done setup. Keep the demo to the minimum that exhibits the surface area before the call. |
| Demo form location | Per-org form with `is_platform_demo = true` flag | No sentinel org, no nullable org_id. Flag hides the form from clinic UI. Every forms-list query excludes it. |
| Primer screen | Removed from `/entry/[token]` production flow | Single priming surface is the checklist. Patient entry flows spec notes this as a follow-up. |
| Activation goal | Video call completed, not SMS sent | Coviu's real adoption problem is the call, not the setup. Onboarding ends when the call ends. |
| Process button coach-mark after call | Deferred to v2 | Keeps v1 arc lean. Logged in TODO. |
| Mobile-only onboarding | Deferred to v2 | v1 laptop-first. Logged in TODO. |
| State management | Extend existing `useClinicStore` (Zustand) | No new caching layer. Follows the existing Zustand + Realtime + layout-hydration pattern. |
| TanStack Query migration | Not in scope | Separate phased initiative. See TODO / separate plan if needed. |
| Real-time updates | Reuse existing Supabase Realtime channels | No new channels. Demo session flows through existing subscriptions. |
| Coach-mark system | New component, client-only | Driven by store state, not a new server subscription. |
| Onboarding completion criteria | `users.onboarding_stage = 'call_completed'` | Explicit stage enum instead of boolean flags. Makes the arc resumable. |

---

## Open Questions

None remaining from the skeleton review. The following were explicitly deferred to TODO and are not open questions for this spec:

- Process button coach-mark after the test call (v2).
- Mobile-only onboarding arc (v2).
- TanStack Query migration (separate initiative, not bundled with onboarding).
