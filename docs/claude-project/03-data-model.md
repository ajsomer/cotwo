# 03: Data Model

The schema as a narrative, not a SQL dump. The goal is "you'll know which tables and joins matter, and where the surprises are." Column-level detail belongs in the codebase (`src/lib/supabase/types.ts` is generated from the live schema and is authoritative).

---

## Org hierarchy

The top-level chain is **organisations → locations → rooms → staff_assignments → clinician_room_assignments**.

- **`organisations`** carries the tier (`core` | `complete`), branding (`logo_url`, `name`), and serves as the org-scope boundary for everything below it.
- **`locations`** belongs to one organisation. Carries `qr_token` (used in QR check-in URLs) and a Stripe account ID when payment routing is at the location level. A clinic with multiple physical sites has one organisation and several locations.
- **`rooms`** belongs to one location. Carries `link_token` (the static URL used in on-demand entry links), `room_type`, and `payments_enabled`.
- **`staff_assignments`** links a `user` to a `location` with a role and employment type. **There is no `org_id` column on staff_assignments**; the org is always derived through `staff_assignments.location_id → locations.org_id`. Forgetting this and trying to filter staff by org with a missing column is the most common new-contributor confusion.
- **`clinician_room_assignments`** is a junction (staff_assignment_id ↔ room_id) controlling which rooms a clinician sees on the run sheet. A clinician with no row here sees no rooms; a clinician with a row for every room sees the full run sheet for that location.

`auth.users` (Supabase) and `users` are joined on `users.id = auth.users.id`: same UUID, no separate `auth_id` column. A trigger on `auth.users` populates `users` on signup.

## Patient identity

The patient chain is **patients → patient_phone_numbers → payment_methods**, all org-scoped.

- **`patients`** carries `org_id` (so the same person at two clinics is two rows), first name, last name, date of birth.
- **`patient_phone_numbers`** links phone numbers to patients. A single phone may link to multiple patients in the same org (parent's phone, multiple children). This is what powers the multi-contact picker in the arrival flow.
- **`payment_methods`** carries the Stripe payment method reference, card brand, last four, expiry, and a default flag.

There is no patient-facing user table. Patients have no `auth.users` row, no password, no settings page. Phone OTP creates a transient verification record (`phone_verifications`) that's consumed during the arrival flow. After verification, the OTP record is gone; the patient is identified for that visit via the entry token they came in on.

## Scheduling

Scheduling is **appointment_types → appointments**, with appointments being the planning entity.

- **`appointment_types`** is org-scoped. Carries modality (`telehealth` | `in_person`), default fee in cents, default duration, and a `pms_external_id` for sync mapping.
- **`appointments`** is the planning entity. Carries `patient_id`, `clinician_id`, `appointment_type_id`, `room_id`, `location_id`, `org_id`, `scheduled_at`, `phone_number` (for cases where the appointment was created before a patient record existed), and `status` (`scheduled`, `arrived`, `in_progress`, `completed`, `cancelled`, `no_show`).

Note that appointment status is separate from session status. An appointment can be `scheduled` while its session is `queued`, then `in_progress` while the session is `in_session`, etc. Don't conflate them; they evolve in parallel and the run sheet reads from session.

## Sessions

Sessions are **sessions → session_participants**.

- **`sessions`** is the doing entity. Carries `appointment_id` (nullable; on-demand sessions have no appointment), `room_id`, `location_id`, `status`, `entry_token` (unique, used in SMS link URLs), `notification_sent`, `patient_arrived`, and `video_call_id`.
- **`session_participants`** is the junction table (session_id ↔ patient_id ↔ role). Designed to support multi-participant sessions in the future. The MVP assumes one patient per session, but the table exists so adding a second is a data change rather than a schema change.

The session's `entry_token` is the authorisation primitive for patient-facing endpoints during the arrival flow. Patient-side code looks up sessions by token; there is no `auth.uid()` available.

`sessions.status` enum: `queued`, `waiting`, `checked_in`, `in_session`, `complete`, `done`. The derived display states (`late`, `upcoming`, `running_over`) are not stored; see `01-core-concepts.md`.

## Workflow engine (Complete only)

The workflow engine is **workflow_templates → workflow_action_blocks → type_workflow_links → appointment_actions**, with `outcome_pathways` as a sibling for the post-appointment side.

- **`workflow_templates`** carries the `direction` (`pre_appointment` | `post_appointment`) and the `terminal_type` (`run_sheet` | `collection_only`). A template is a sequence of action blocks.
- **`workflow_action_blocks`** carries `action_type` (key types include `send_sms`, `deliver_form`, `intake_package`, `add_to_runsheet`, `capture_card`, and `send_reminder`; the full enum is listed below), `offset_minutes`, `offset_direction`, optional `modality_filter`, and `config` (jsonb for action-specific parameters).
- **`type_workflow_links`** maps appointment types to workflow templates with a `phase` (`pre` | `post`). When an appointment of this type is created, this is the lookup that finds which template to fire.
- **`appointment_actions`** is the runtime instance: one row per (appointment, action_block) at the moment the workflow is scheduled. Carries `status` (`scheduled`, `pending`, `firing`, `sent`, `opened`, `completed`, `transcribed`, `skipped`, `failed`, etc.), `scheduled_for`, `fired_at`, and `result` (jsonb).
- **`outcome_pathways`** are linked to post-appointment workflow templates and presented to the receptionist during the process flow.

Action statuses are deliberately granular because the receptionist needs to see "sent but not opened" vs "opened but not completed" vs "completed but not transcribed."

## The two parallel intake paths

There are two ways forms reach a patient pre-appointment, and they exist for different reasons. **This is the single most surprising part of the workflow data model.**

- **`deliver_form` actions.** The original mechanism. Each form is its own `workflow_action_block` with its own `appointment_action` instance. Sends the patient an individual SMS per form. Tracks completion via `form_submissions` directly.
- **`intake_package` actions.** The newer, bundled mechanism. One action block per package, one `appointment_action` instance, one journey URL. The `intake_package_journeys` table holds the package's progress (which forms completed, card captured, consent given). Sends one SMS per package, not per form.

Both still exist. New workflows should use `intake_package` (bundled = better patient experience). Legacy data may still use `deliver_form`. The transcription handoff supports both paths but flags an `intake_package` differently in the readiness dashboard. See `feature-intake-package.md` for the full story.

## Forms

Forms are **forms → form_fields → form_submissions**, all org-scoped.

- **`forms`** carries name, description, status, and version metadata.
- **`form_fields`** is vestigial. It exists from an earlier design where forms were modelled relationally with one row per field. After the switch to SurveyJS, the entire form schema is stored as JSON on `forms.schema` and the per-field rows are no longer written or read by feature code. The table is kept rather than dropped because removing it is migration-risky for prototype value, and the cleanup is deferred to engineering handoff.
- **`form_submissions`** carries `form_id`, `patient_id`, `appointment_id`, `responses` (jsonb), and submission timestamp.

Forms in this codebase are SurveyJS-driven. The form builder is a SurveyJS Creator wrapped in a clinic-side page. The form runtime is SurveyJS rendering the stored schema. The `form_submissions.responses` jsonb is whatever shape SurveyJS produces; don't try to constrain it.

## Payments

Payments are **payments**, with Stripe holding the source of truth.

- **`payments`** carries `appointment_id`, `patient_id`, `amount_cents`, `status` (`pending`, `processing`, `completed`, `failed`, `refunded`), `stripe_payment_intent_id`, `stripe_account_id` (which Stripe Connect account the funds went to).

Stripe Connect routing is governed by the org-level setting `stripe_routing` (`location` | `clinician`). When the routing is `location`, the location's `stripe_account_id` is used. When `clinician`, the clinician's `staff_assignments.stripe_account_id` is used. See `feature-payments.md`.

## Real-time / live updates

A handful of supporting tables exist for the live update infrastructure.

- **`patient_presence`** tracks heartbeats from patients in the virtual waiting room. Used to detect "patient closed their browser" without polling.
- **`runsheet_events`** is an append-only log of broadcast events (used for fallback polling and for late-joining clients to catch up).

These are infrastructure tables, not feature tables. They exist to make Realtime and Socket.io reliable, not to model business state.

## Key enums

These show up across the codebase, and the values are load-bearing:

The values below are the live enum values from the schema. If you're writing code that branches on these, this is the authoritative list (and `src/lib/supabase/types.ts` is the generated mirror). If a value isn't here, it doesn't exist.

```
user_role: clinic_owner, practice_manager, receptionist, clinician
employment_type: full_time, part_time
room_type: clinical, reception, shared, triage
appointment_modality: telehealth, in_person
appointment_status: scheduled, arrived, in_progress, completed, cancelled, no_show
appointment_type_source: coviu, pms
session_status: queued, waiting, checked_in, in_session, complete, done
workflow_direction: pre_appointment, post_appointment
action_type: send_sms, deliver_form, capture_card, send_reminder,
             send_nudge, send_session_link, send_resource, send_proms,
             send_rebooking_nudge, verify_contact, send_file,
             intake_package, intake_reminder, add_to_runsheet, task
action_status: pending, sent, completed, failed, skipped, scheduled,
               opened, captured, verified, cancelled, firing,
               transcribed, dropped
payment_status: pending, processing, completed, failed, refunded
stripe_routing: location, clinician
```

## The bodies, summarised

If you take only one thing from this doc, take the list of things that surprise people:

1. **`staff_assignments` has no `org_id`**: derive through location.
2. **`users.id = auth.users.id`**: no separate auth_id column.
3. **Derived session states aren't persisted**: `late`, `upcoming`, `running_over` are application-layer.
4. **Two parallel intake paths exist**: `intake_package` (new, bundled) and `deliver_form` (legacy, per-form). Both still ship.
5. **`form_fields` is vestigial**: the schema is jsonb on `forms`.
6. **Patient identity is org-scoped**: same person at two clinics = two rows.
7. **Phone numbers can link to multiple patients in one org**: the multi-contact picker is not edge-case behaviour.
8. **Payment routing is org-locked**: the choice between location vs clinician routing is set at the org level and cannot be overridden.

---

## Where to look next

- `02-architecture.md` for how the schema maps onto the runtime stack.
- `feature-runsheet.md`, `feature-workflow-engine.md`, `feature-intake-package.md` for how the data model actually plays out at the feature level.
- `src/lib/supabase/types.ts` in the codebase for the authoritative column-level detail (generated from the live schema).
