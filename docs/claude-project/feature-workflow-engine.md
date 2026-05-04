# Feature: Workflow Engine

Complete-tier only. The bidirectional pre-appointment and post-appointment automation engine. Replaces the Core tier's one-shot SMS with configurable timed actions across days or weeks: SMS reminders, intake packages, form deliveries, card capture nudges, follow-up resources, PROMs, rebooking nudges, AI scribe routing.

This doc summarises the engine's mechanics. Full action-type detail and template configuration live in the spec.

---

## Why this is its own doc

The workflow engine is the substance of "Complete tier." It's the difference between "telehealth on a run sheet" and "the digital front door for the practice." Almost every Complete-only feature on the readiness dashboard, in patient flows, and in post-appointment automation is driven by the engine.

It's also where the most surprising bits of the data model live (the two parallel intake paths, the runtime/template split, the modality filter pattern). Worth reading carefully if you're touching any Complete-tier feature.

## Templates and runtime

Two layers:

**Templates** are the design-time configuration. A `workflow_templates` row plus its `workflow_action_blocks` defines a sequence of actions ("send an SMS 7 days before the appointment, then deliver a form 3 days before, then send a reminder if the form isn't done by 1 day before"). Templates are managed by Practice Managers in the Workflows settings page.

**Runtime instances** are what actually fires. When an appointment is created, the system reads the linked template and writes one `appointment_actions` row per action block at the corresponding scheduled time. These rows are scheduled, fired, retried, and resolved over the lifetime of the appointment.

The split is important. Templates are versioned at design time; runtime instances capture what was scheduled for *this specific appointment* at the time it was created. Editing a template doesn't retroactively change appointments that already have scheduled actions.

## Direction: pre vs post

Workflow templates have a `direction`: `pre_appointment` or `post_appointment`.

**Pre-appointment** templates fire actions before the visit. Typical sequence: SMS welcome, intake package, reminder, on-the-day session link.

**Post-appointment** templates fire actions after the visit, gated on the outcome pathway selected in the process flow. A patient who receives the "follow-up needed" pathway gets a different sequence than a patient who receives the "no further action" pathway.

The two phases are linked at the appointment-type level via `type_workflow_links`. Each appointment type can have a pre-appointment template, a post-appointment template, both, or neither. Practice Managers configure this in Settings → Appointment Types.

## Action types

The full enum is in `03-data-model.md`. Key action types worth understanding:

- **`send_sms`**: send an SMS to the patient. The simplest action. Stubbed to console-log in the prototype.
- **`deliver_form`**: send the patient a link to a single form. Legacy mechanism. Each form is its own action block, its own SMS, its own URL. Still supported but new workflows should use `intake_package`.
- **`intake_package`**: bundle multiple forms, card capture, and consent into a single journey URL. Newer mechanism; better patient experience. See `feature-intake-package.md`.
- **`intake_reminder`**: re-send the intake package URL if the patient hasn't completed it.
- **`capture_card`**: send the patient a link to capture a card on file. Standalone (without a full intake package).
- **`send_reminder`**: a generic reminder message before the appointment.
- **`add_to_runsheet`**: at the appointment time, mark the appointment as ready to spawn a session. The morning scan reads this and creates the session row.
- **`send_session_link`**: send the patient the actual link to join the call. Fires on the day of the appointment.
- **`send_resource`**: send a post-appointment resource (educational PDF, video link, etc.).
- **`send_proms`**: send a post-appointment PROM (patient-reported outcome measure).
- **`send_rebooking_nudge`**: post-appointment, prompt the patient to book again.
- **`task`**: a non-message action (internal task for staff, e.g. AI scribe routing).
- **`verify_contact`**: pre-appointment, ask the patient to verify their phone number is correct.
- **`send_file`**: send the patient a file (resource attachment).

When you're considering a new action type, the question to ask is whether existing types can express it via configuration. A "send a thank-you SMS" doesn't need a new type; it needs an `send_sms` action with a configured message.

## Action block configuration

Each `workflow_action_blocks` row carries:

- `action_type`: which handler runs.
- `offset_minutes`, `offset_direction`: when to fire relative to the appointment time. `7 days before`, `1 hour after`, etc.
- `modality_filter`: optional. Only fires for telehealth, only fires for in-person, or fires for both.
- `form_id`: for `deliver_form` actions; references the form to send.
- `config`: jsonb for action-specific parameters (SMS message text, package configuration, resource URL, etc.).
- `parent_action_block_id`: for chained actions (e.g. an `intake_reminder` is a child of an `intake_package`).
- `precondition`: jsonb for branching logic. "Only fire if the previous action ended in `failed`," etc.
- `sort_order`: rendering and execution order within the template.

The `config` jsonb is action-specific and the schema is enforced by the action handler, not by the database. Each action handler in `src/lib/workflows/handlers.ts` knows what shape its config takes and validates it on read.

## Modality filter

Important because a single workflow template can serve both telehealth and in-person appointments under the same appointment type, with different actions for each.

Example: an "Initial consultation" appointment type might have a pre-appointment template with:

- `send_sms` welcome (both modalities).
- `intake_package` (both modalities).
- `verify_contact` filtered to in-person only (because in-person patients won't be using their phone to enter the building's app, just to receive SMS).
- `send_session_link` filtered to telehealth only (because in-person patients don't need a session link).

The runtime checks each appointment's modality against the action block's filter. Filtered-out actions are written to `appointment_actions` with `status = 'skipped'` so the audit trail is complete; they don't fire.

## Scheduling and firing

When an appointment is created (manually, via PMS sync, or via add-patient on readiness):

1. The system looks up the linked workflow template via `type_workflow_links`.
2. For each action block in the template, it computes the scheduled time (`scheduled_for = appointment.scheduled_at + offset`).
3. It writes an `appointment_actions` row with `status = 'scheduled'`.
4. **Immediately-due actions fire synchronously.** If an action's `scheduled_for` is in the past or right now (e.g. an action with offset `0` minutes, or any action when an appointment is created the day-of), it fires inline as part of the scheduling. The fired actions are returned to the client so the demo operator sees the stubbed SMS URL immediately.
5. Scheduled-future actions wait for the periodic scheduler to fire them.

The periodic scheduler runs in the same Next.js process (no separate job runner in the prototype) and looks for `scheduled` actions whose `scheduled_for` has passed. See `conventions-prototype-vs-production.md` on background jobs.

## Action statuses

The `action_status` enum has 13 values. The full list is in `03-data-model.md`. The states an action moves through:

`scheduled` → `pending` (about to fire) → `firing` (handler is running) → terminal state.

Terminal states:

- `sent`: SMS or other message went out.
- `opened`: patient clicked the link.
- `completed`: patient finished the action (form submitted, package finished, card captured).
- `verified`: patient verified an item (used by `verify_contact`).
- `captured`: card capture succeeded specifically (used by `capture_card`).
- `transcribed`: receptionist marked the corresponding data transcribed into the PMS.
- `failed`: handler errored. Surfaces on the readiness dashboard as the highest priority.
- `skipped`: didn't fire because of modality filter or precondition.
- `cancelled`: appointment was cancelled, action will not fire.
- `dropped`: special case for actions that were superseded by a later action.

The granularity exists because the readiness dashboard needs to distinguish "sent but not opened," "opened but not completed," and "completed but not transcribed."

## Outcome pathways and post-appointment

Post-appointment templates are linked to **outcome pathways**, not directly to appointment types. The receptionist (or solo clinic owner) selects an outcome pathway in the process flow at the end of the visit, and that selection determines which post-appointment template's actions get scheduled.

The flow:

1. Process flow renders the outcome pathway picker (Complete only).
2. Receptionist picks "follow-up needed" / "no further action" / etc.
3. The corresponding post-appointment template is read.
4. Action blocks are scheduled relative to the appointment's actual end time.

Outcome pathways are configured per appointment type in Settings → Appointment Types.

## Worked example

A patient books an "Initial consultation" (a telehealth appointment type with both pre- and post-appointment templates).

**Pre-appointment template fires:**

- 7 days before: `send_sms` welcome.
- 5 days before: `intake_package` (forms + card + consent).
- 2 days before: `intake_reminder` if package isn't complete.
- 1 hour before: `send_session_link` (telehealth only).
- At appointment time: `add_to_runsheet`.

**Patient arrives, has the call, call ends.**

**Receptionist processes:** takes payment, picks outcome "follow-up in 4 weeks."

**Post-appointment template (for "follow-up in 4 weeks") fires:**

- Immediately: `send_resource` thank-you with summary.
- 1 day after: `send_proms` to gauge how the visit went.
- 4 weeks after: `send_rebooking_nudge`.

The full sequence is captured in `appointment_actions` rows with their statuses, and the readiness dashboard surfaces anything that needs human attention along the way.

## Where to look

- **Action handlers:** `src/lib/workflows/handlers.ts`.
- **Scheduler:** `src/lib/workflows/scanner.ts`.
- **Engine entry points:** `src/lib/workflows/engine.ts`.
- **Workflow builder UI:** `src/app/(clinic)/workflows/page.tsx`. (There is no `[id]` detail route; editing happens on the list page.)
- **Template-to-type linking:** `src/components/clinic/appointment-type-editor.tsx` (where Practice Managers wire types to templates).
- **Plan files:**
  - `docs/plans/workflows-tabbed-restructure.md`
  - `docs/plans/intake-package-transcription-handoff.md`

## Related docs

- `feature-tiers-and-roles.md` for the Complete-only gating.
- `feature-intake-package.md` for the bundled action type that's the most-used pre-appointment action.
- `feature-readiness-dashboard.md` for the surface where action statuses become tasks.
- `feature-process-flow.md` for the outcome pathway selection that drives post-appointment actions.
- `feature-pms-integration.md` for the data flow that feeds appointments into the engine.
- `03-data-model.md` for the full action_type and action_status enums.
- `conventions-prototype-vs-production.md` for the SMS stub and background job framing.
