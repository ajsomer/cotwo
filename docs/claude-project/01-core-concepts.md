# 01: Core Concepts

This is the conceptual vocabulary every other doc in this set depends on. Keep it open in another tab while you read the feature docs. The terms here show up everywhere and getting them wrong is the easiest way to build something that sounds right but does the wrong thing.

---

## The three entities: Appointments, Sessions, Rooms

Coviu's data model has three entities that look similar but mean different things. Mixing them up is the single most common source of bugs in this codebase.

**Appointments** are the planning entity. They are created days, weeks, or months in advance, by PMS sync (Complete tier) or manual entry (Core tier). They carry the scheduling context: which patient, which clinician, which appointment type, what time, which room. The workflow engine acts on appointments. Pre-appointment actions (SMS reminders, intake packages, form deliveries) are scheduled relative to `appointments.scheduled_at`. An appointment exists whether or not anyone has actually shown up.

**Sessions** are the doing entity. They are spawned from appointments at run sheet build time (the morning scan), or for on-demand entries, created directly at the point a patient enters with no pre-existing appointment. A session tracks the patient's live visit lifecycle: arrival, consultation, payment, outcome selection. Video calls are ephemeral within sessions. Real-time updates on the run sheet reflect session state changes, not appointment changes.

**Rooms** are organisational containers. They group sessions on the run sheet, one room container per row's worth of clinical capacity. A room belongs to a location. Room types include single clinician (Dr Smith's Room), shared clinician (Nurse Room), triage (On-Demand Room), and group (Group Therapy Room). Rooms do not hold persistent video connections; they are an organisational abstraction.

The rule of thumb: if you're talking about *what was scheduled*, you're talking about an appointment. If you're talking about *what's happening today*, you're talking about a session. If you're talking about *where on the run sheet it lives*, you're talking about a room.

## Session lifecycle

Sessions move through a small state machine, but the displayed state is not always the stored state.

**Stored statuses** (the column value in `sessions.status`):

- `queued`: session exists, patient hasn't arrived
- `waiting`: patient is in the virtual waiting room (telehealth only)
- `checked_in`: patient has physically arrived (in-person only)
- `in_session`: call is active or appointment is happening
- `complete`: session is over, needs receptionist processing (payment, outcome)
- `done`: fully processed, archived from the active run sheet

**Derived display states** (calculated in application code, never stored):

- `upcoming`: stored status is `queued`, the appointment is within ~10 minutes, the patient hasn't arrived (the original spec also required `notification_sent`; the current `isUpcoming()` does not check that flag — see `feature-runsheet.md`)
- `late`: stored status is `queued`, scheduled time has passed, patient hasn't arrived
- `running_over`: stored status is `in_session`, session has exceeded scheduled duration

The reason for the split: derived states depend on the current time, which changes constantly. Persisting them would require background jobs to flip flags every minute. Calculating them on render is cheap and always correct. The cost is that you cannot query for "all late sessions" in SQL; you have to fetch and filter in code. See `feature-runsheet.md` for how this plays out in priority calculations.

## The four entry points

Patients reach the platform through one of four entry points. All four converge on the same arrival flow component (`entry-flow.tsx`); the entry point only changes which token is in the URL and what context the flow has at the start.

1. **On-demand link** (Core and Complete, telehealth only). The clinic sends a link tied to a room (`rooms.link_token`). The patient clicks, verifies their phone, and a session is created on the spot. No pre-existing appointment.

2. **Run sheet manual** (Core and Complete, telehealth only on Core). A receptionist enters appointments the night before or morning of. Sessions are spawned at run sheet build time. Patients receive a one-shot SMS (Core) or workflow-driven messages (Complete) with a link tied to the session (`sessions.entry_token`).

3. **Run sheet integrated** (Complete only, telehealth and in-person). PMS sync pulls appointments. The workflow engine fires pre-appointment actions over days or weeks. Sessions are spawned on the morning of the appointment.

4. **QR code** (Complete only, in-person only). The patient scans a QR code in the waiting room (`locations.qr_token`), verifies their phone, and is matched to the appointment.

The entry point determines what appears on the run sheet (a session shows up regardless), what kind of token is in the URL, and which entry-flow branches are taken. It does not change the patient experience. After the primer landing screen (which is not a numbered step), the patient moves through the same six steps regardless of entry point: phone OTP, identity confirmation, outstanding intake gate, card capture, device test, and arrive. Steps that don't apply to a given clinic or patient (card capture when payments are off, outstanding intake when nothing is pending) are skipped, so the displayed step count is dynamic.

## Patient identity

Patients do not have accounts. Identity is established per-visit through phone OTP, then matched against existing contact records in the clinic.

**Identity is clinic-scoped, not platform-scoped.** A patient who exists in Clinic A and Clinic B has two separate `patients` rows, one per organisation. There is no cross-clinic patient identity. This is intentional: clinical records belong to the clinic, not to the patient, and merging across clinics would create privacy and compliance problems.

**Phone number is the key.** Patients are looked up by phone in the org-scoped `patient_phone_numbers` table. A single phone number can be linked to multiple patients within the same org (a parent's phone number used for several children). The arrival flow handles this with the multi-contact picker, where the patient confirms which contact this visit is for.

**No patient-facing accounts** means there is no "log in" for patients. Every visit verifies phone ownership fresh via OTP. There is also no patient-facing settings page, no patient-driven password reset, no patient-managed contact list. The clinic owns and edits the contact records.

For new patients (no record on this phone in this org), the arrival flow captures first name, last name, and date of birth. For returning patients, the flow confirms the existing record. The "someone else" option is always available so a new contact can be added on the same phone.

## Roles

Four roles, with sharply different permissions:

- **Clinic Owner**: first user to sign up, paid seat, one per organisation. Counts as both a Practice Manager and a Clinician for permission purposes, plus carries account ownership (billing, subscription).
- **Practice Manager**: non-clinical admin, free seat. Full platform configuration but does not appear on the run sheet as a provider and does not have clinician capabilities.
- **Receptionist**: day-to-day operations. Run sheet, payments, outcome pathway selection. Cannot modify configuration.
- **Clinician**: session-level access. Starts telehealth calls from the run sheet, preference-level settings only.

A frequent failure mode in role checks: code that filters on `role === 'practice_manager'` or `role === 'clinician'` while forgetting that a `clinic_owner` is *both*. Always include `clinic_owner` in any practice-manager OR clinician check. See `reference-decisions.md` for the rationale.

The role-by-tier visibility matrix for sidebar items (and which roles can perform which actions) is in `feature-tiers-and-roles.md`.

## Cascading configuration

Clinics configure the platform top-down: organisation defaults, then per-location overrides, then per-clinician preferences within whatever guardrails the higher levels have set.

- **Organisation level**: branding, payment routing model, tier, default appointment types, default workflow templates.
- **Location level**: can override most org defaults. Has its own Stripe account (if location-level routing is selected), its own rooms, its own staff assignments.
- **Clinician level**: preferences within guardrails the org/location has set. Cannot override locked categories (payment routing, branding).

Some categories are locked at higher levels and cannot be overridden lower down. Payment routing is set at the org level (location vs clinician), branding is fixed at the org level, and tier is org-wide. The cascading model shows up across settings, the workflow engine, and runtime configuration. `feature-admin-and-config.md` is where this is fully laid out.

## Sidebar and navigation

There is one sidebar, one navigation structure, no separate admin layout. Visibility of nav items is determined by role and tier together, not by mode-switching, not by URL prefix.

The clinic-side layout is fixed: organisation branding at the top, a location switcher below it, navigation links in the middle, the user profile at the bottom. Patient-side has its own minimal layout (no sidebar, just the persistent header with clinic logo, room name, and step indicator).

The location switcher is the most consequential UI element on the clinic side. Switching locations changes which run sheet you see, which readiness signals are surfaced, which payments dashboard is loaded, and which real-time channel the run sheet subscribes to. **Notifications, however, fire across all assigned locations** so the receptionist doesn't miss an event happening at the location they aren't currently viewing; clicking the notification switches context.

## Modality

Two modalities: `telehealth` and `in_person`. Most of the codebase is modality-agnostic. Sessions, payments, the run sheet, and the workflow engine all work for both. The places where modality matters:

- **Tier gating.** In-person is Complete-only. Core has no `in_person` appointment types and no QR check-in.
- **Arrival flow.** Telehealth ends at a virtual waiting room (`waiting` status). In-person ends at a "you're checked in" confirmation (`checked_in` status). The intermediate steps are the same.
- **Process flow.** In-person sessions can be processed early (from `checked_in`), telehealth must wait until `complete` after the call ends.
- **Workflow engine action filters.** Action blocks have a `modality_filter` so a single workflow template can fire different actions for telehealth vs in-person appointments under the same template.

When code branches on modality, it is almost always because of one of the four points above.

---

## Where to look next

- `02-architecture.md` for how these concepts map onto the actual stack (Next.js, Supabase, Zustand, Realtime).
- `03-data-model.md` for the foreign-key chains that connect appointments, sessions, rooms, patients, and workflows.
- `feature-tiers-and-roles.md` for the role-by-tier visibility matrix.
- `feature-runsheet.md` for how derived state plays into priority calculation.
- `feature-patient-entry-flow.md` for the unified arrival flow that the four entry points all converge on.
