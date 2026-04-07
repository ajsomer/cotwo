# Coviu Feature Spec: Workflow Engine

**Pre-appointment workflows, post-appointment workflows, and the action execution model**

---

## Overview

| | |
|---|---|
| **Surface** | Workflow editor (clinic-side configuration) and workflow execution engine (backend) |
| **Users** | Practice managers and clinic owners (configuration). Receptionists observe via the readiness dashboard. |
| **Available to** | Complete tier only. Core tier clinics see no workflow surfaces. |
| **Real-time** | No. Workflow execution is daily-scan based, not real-time. |
| **Priority** | Foundation feature for the Complete tier. Required for the digital front door positioning. |

The workflow engine is the automation layer of the Coviu platform. It allows practice managers to configure what happens automatically before and after each appointment — sending forms, sending reminders, capturing cards, verifying contact details, sending follow-up content, sending PROMs questionnaires, sending rebooking nudges. Practice managers configure once, the system runs forever.

This spec covers two related but distinct concepts:

- **Pre-appointment workflows** are properties of appointment types. Each appointment type has zero or one pre-workflow. When an appointment of that type is created, the pre-workflow runs automatically across the days or weeks leading up to the appointment.

- **Post-appointment workflows** are standalone named entities in their own library. They are selected reactively by the receptionist during the Process flow when the receptionist (instructed by the clinician) decides what should happen next. Once selected, the post-workflow runs automatically across the days or weeks following the appointment.

Both kinds of workflow share the same editor component, the same data model for actions, and the same execution engine. The differences are in how they are triggered (creation vs selection), where they are authored (appointment type config vs standalone library), and which action types are available.

> **The workflow engine is the operational backbone of the Complete tier. Pre-workflows are deterministic and run automatically. Post-workflows are reactive and run on demand. Both are configured once and execute forever.**

---

## V1 scope and what is deferred

V1 ships the full pre-appointment workflow loop end to end: editor, library, execution engine, integration with appointment creation, and integration with the readiness dashboard. Practice managers can build pre-workflows, attach them to appointment types, watch them execute against real appointments, and see execution state on the readiness dashboard.

V1 also ships the post-appointment workflow editor and library so practice managers can author post-workflows and the editor component is exercised across both surfaces. However, **post-workflow execution is deferred to v2**. The Process flow does not yet trigger post-workflows. The post-workflow library exists as a configuration surface but the actions inside post-workflows do not actually fire in v1.

This split is deliberate. Pre-workflows provide a complete demoable loop for the Diana prototype: appointment created → forms sent automatically → patient completes → readiness dashboard reflects state. Post-workflows require additional Process flow wiring and a different data path that is more invasive and less critical to the prototype demo. By shipping post-workflow editing in v1 and post-workflow execution in v2, we get the architectural alignment of designing both up front while deferring the implementation cost.

The action types, preconditions, state machines, and editor components are designed such that they generalise across pre and post. When v2 lands and post-workflow execution comes online, no editor or data model changes are required — only the Process flow integration and the post-workflow execution path.

### Explicitly out of scope for v1

- Post-workflow execution (the Process flow does not trigger post-workflows)
- Conditional branching beyond per-action preconditions (no if/then/else logic at the workflow level)
- Workflow-level scheduling outside of appointment anchors (no calendar-based or patient-state-based triggers)
- Per-clinician fee variation on appointment types
- Workflow analytics and reporting
- Webhooks or external API triggers
- Workflow version history or rollback
- Multi-step preconditions or compound preconditions (only single dropdown-selected preconditions per action)

These will be addressed in future iterations.

---

## Core concepts

### Workflows are linear sequences of timed actions

A workflow is an ordered list of actions, each with a fire time and an optional precondition. There is no branching, no nesting, no DAG. Reading a workflow top to bottom is reading forward in time. The visual representation is a vertical timeline.

This constraint is deliberate. Practice managers do not think in terms of decision graphs — they think in terms of "send this two weeks before, send this one week before, remind them three days before if they haven't completed it yet." Linear timelines match the mental model. Branching logic is handled at the action level via preconditions, which keeps the workflow flat and scannable.

### Actions have a type, a fire time, and an optional precondition

Each action in a workflow has three things:

- **Type** — what the action does (send form, send reminder SMS, capture card, etc.). The type determines what configuration the action needs.
- **Fire time** — when the action runs, expressed relative to the appointment. Pre-workflows use "X days/hours before appointment." Post-workflows use "immediately" or "X days/hours after appointment."
- **Precondition** — optional. A single condition picked from a small dropdown that determines whether the action fires when its scheduled time arrives. The default is "Always fires." Examples: "Only if intake form not completed," "Only if card not on file," "Only if no future appointment booked."

There is no support for compound preconditions (no AND/OR/NOT) in v1. If a practice manager needs more complex logic, they create multiple actions with different preconditions, or they request the feature for v2.

### Pre-workflows attach to appointment types, post-workflows are standalone

This asymmetry reflects how the two kinds of workflow are triggered.

Pre-workflows are deterministic: when an appointment of a given type is created, you know everything you need to know to schedule the pre-workflow's actions. There is no decision to make. So pre-workflows live as a property of the appointment type — one workflow per type, edited from the appointment type configuration.

Post-workflows are reactive: when an appointment is processed, the receptionist (instructed by the clinician) decides what should happen next based on what actually occurred during the consultation. The same appointment type can lead to many different outcomes depending on the patient's situation. So post-workflows are standalone named entities that get selected from a library at processing time. Multiple appointment types can use the same post-workflow.

### Workflows execute via daily scans, not real-time

Workflow actions do not fire in real-time. The execution model is three daily scans (matching Layer 2's existing scan model):

- **Pre-appointment scan** — runs once per day, identifies actions whose fire time falls within today's window, fires them
- **Run sheet scan** — runs once per day at the start of the day, generates the day's sessions from appointments, and queues any actions tied to today's appointments
- **Post-appointment scan** (v2) — runs once per day, checks completed appointments with selected post-workflows, fires post-workflow actions whose fire time falls within today's window

The daily scan model means workflows are not real-time. An action scheduled for "3 days before appointment" will fire some time during the day three days before — not at a precise moment. This is fine for the use case (patient communications are not millisecond-sensitive) and dramatically simplifies the execution model.

If an action's scheduled time is in the past at the moment the workflow is created (e.g. a "send form 14 days before" action on an appointment that is only 5 days away), the action fires immediately at the next scan. The intent is "make sure this happens" — firing late is better than not firing at all.

### Workflows snapshot at appointment creation, with mid-flight edits warned

When an appointment is created, the pre-workflow attached to its type is referenced by the appointment's workflow execution record. If the practice manager later edits the workflow, in-flight appointments are affected by the changes for any actions that have not yet fired.

A "mid-flight edit warning modal" appears when a practice manager tries to save changes to a workflow that has appointments currently executing it. The modal shows:

- The number of in-flight appointments
- A summary of what is changing (added actions, removed actions, retimed actions)
- A confirmation prompt

The practice manager confirms or cancels. If they confirm, the changes apply to in-flight appointments and the workflow execution recalculates remaining actions using the new definition and the original appointment date as the anchor.

This model prioritises practice manager flexibility over execution consistency. The alternative (snapshot the workflow at appointment creation and never modify in-flight executions) is simpler architecturally but means workflow edits don't take effect for two weeks while existing appointments drain. The mid-flight edit model is harder to implement but matches what practice managers actually expect.

---

## The workflows page

A single page in the clinic-side navigation called **"Workflows"** that contains both pre-appointment and post-appointment views via a toggle in the header.

### Page layout

**Header (full width)**
- Page title: "Workflows"
- Subtitle: "Configure what happens before and after each appointment"
- Toggle (right-aligned): "Pre-appointment | Post-appointment"

**Body (split pane)**
- Left pane (fixed 280px width): library of items relevant to the current toggle state
- Middle pane (flex): editor for the selected item

The toggle controls what appears in both panes. Switching the toggle does not preserve the selected item in the other view (because the items are different kinds of things). Each view has its own selection state.

### Pre-appointment view

**Left pane content:**
- Header: "Appointment types" with a "+" button to create a new one
- Below the header: flat list of appointment types
- Each row shows: type name, "X min · Y actions" or "X min · No workflow," small status dot (teal if workflow attached, grey if not)
- Selected row has a white background with a 1px border, unselected rows are flat
- Source indication: synced types have a small Cliniko/Halaxy/etc icon next to the name (or a small "Coviu" tag for Coviu-created types). No section grouping.
- Footer (only when integrated): "Last synced from [PMS] X hours ago" with a "Refresh now" link

**Middle pane content:**
- Top section: appointment type metadata
  - "Synced from [PMS]" badge if applicable
  - Type name (large, editable inline if Coviu-created, read-only if synced)
  - Subtitle: "X minutes · Default fee $Y.YY"
  - Save changes / Cancel buttons (top right)
- Divider
- Workflow section header: "Pre-appointment workflow" with subtitle "X actions running before each appointment"
- Right-aligned: "X patients currently in this workflow" (only if > 0)
- Workflow editor (see Editor component below) with the appointment anchor at the bottom

**Empty state (no appointment type selected):**
- Auto-select the first appointment type in the list on initial page load
- If the list is empty entirely (somehow), show "No appointment types yet. Create your first to get started."

**Empty state (selected type has no workflow):**
- Middle pane shows the type metadata as normal
- Workflow section shows: "No pre-appointment workflow configured for this appointment type." with a primary "+ Create workflow" button and a "Start from template" link

### Post-appointment view

**Left pane content:**
- Header: "Post-appointment workflows" with a "+" button to create a new one
- Below the header: flat list of post-workflows
- Each row shows: workflow name, "X actions · Used Y times" or "No actions yet," small status dot (teal if has actions, grey if empty)
- Selected row has a white background with a 1px border, unselected rows are flat
- No source indication (post-workflows are always Coviu-created)
- No footer

**Middle pane content:**
- Top section: workflow metadata
  - Section label: "Post-appointment workflow" (small, uppercase, muted)
  - Workflow name (large, editable inline)
  - Description (smaller, editable inline) — important because this is what the receptionist sees when picking from the list during the Process flow
  - Save changes / Cancel buttons (top right)
- Divider
- Workflow section header: "Workflow actions" with subtitle "X actions running after the appointment is processed"
- Right-aligned: "Used X times in the last 30 days" (only after v2 execution lands; v1 shows nothing or "Not yet active")
- Workflow editor (see Editor component below) with the "Appointment processed" anchor at the top

**Empty state (no post-workflow selected):**
- Auto-select the first post-workflow in the list on initial page load
- If the list is empty entirely, show "No post-appointment workflows yet. Create your first to get started."

**Empty state (selected workflow has no actions):**
- Middle pane shows the workflow metadata as normal
- Workflow section shows the editor with only the appointment anchor and the "+ Add action" placeholder

---

## The workflow editor component

The editor is a single component used by both the pre and post views. The only difference between them is the position of the appointment anchor (bottom for pre, top for post) and the available action types.

### Visual structure

A vertical timeline of action cards. The timeline runs through the icon column on the left, connecting each action visually. The appointment anchor sits at one end of the timeline (bottom for pre, top for post) and is visually distinct (filled teal icon, larger label, separated by a divider).

Each action card has two states: collapsed and expanded.

### Collapsed action card

A horizontal card showing:

- Left: action type icon (40px square, white background with 1px border)
- Middle: action name + subtitle
  - Action name (e.g. "Send form: New patient intake")
  - Subtitle: precondition summary (e.g. "Always fires" or "Only if intake form not completed")
- Right: fire time pill (e.g. "14 days before" or "1 day after" or "Immediately")

Click the card to expand it. The card expands inline; other cards stay collapsed.

### Expanded action card

The card grows vertically to reveal the configuration form for the selected action type. The header (action type label and fire time pill) stays visible at the top. Below the header, the configuration form contains fields specific to the action type:

- **All actions:** fire time picker (number input + unit dropdown)
- **All actions:** precondition picker (dropdown)
- **Send form:** form picker (dropdown of available forms)
- **Send reminder SMS:** message text area with variable insertion (`{first_name}`, `{appointment_time}`, `{clinic_name}`)
- **Send file/PDF:** file picker
- **Capture card on file:** no additional configuration
- **Verify contact details:** no additional configuration
- **Send rebooking nudge:** message text area, optional rebooking link template

Footer of the expanded card:
- Left: "Delete" button (red border, red text)
- Right: "Cancel" and "Apply" buttons

"Apply" saves the action's changes and collapses the card back to summary state. "Cancel" discards changes and collapses without saving. "Delete" removes the action from the workflow entirely (with no confirmation modal in v1; relies on the Save changes flow to give practice managers a second chance to back out).

The expanded card is the only place where action configuration happens. There is no separate side panel or modal. Inline editing only.

### Add action affordance

At the position furthest from the appointment anchor (top for pre, bottom for post), a placeholder slot with a dashed border and a "+" icon. Click it to open a small popover menu of available action types. Pick one and a new action card appears in expanded state, ready to configure. After the practice manager sets the fire time and clicks Apply, the new card sorts itself into the correct position in the timeline based on its time.

### Time-based sorting

Action cards are always rendered in fire time order. Pre-workflow actions are sorted by "days/hours before appointment" descending (earliest first at the top, closest to appointment at the bottom). Post-workflow actions are sorted by "immediately first, then days/hours after appointment ascending" (earliest first at the top under the appointment anchor, latest at the bottom).

Practice managers cannot manually reorder actions by dragging. Position is always derived from time. To move an action, the practice manager edits its fire time and the editor re-sorts.

### Save and Cancel

Save changes and Cancel buttons live at the page header level (top right of the middle pane), not inside the editor. They save or discard all changes in the middle pane: type metadata changes (when applicable) and workflow changes together. One commit point per page.

When Save changes is clicked:
- If the workflow has no in-flight appointments, save immediately and show a toast confirmation
- If the workflow has in-flight appointments, show the mid-flight edit warning modal first

### Mid-flight edit warning modal

A centred modal that appears when saving changes to a workflow with active in-flight appointments.

**Title:** "Update workflow?"

**Body:**
- "X patients are currently in this workflow."
- A summary of changes:
  - "Y actions added"
  - "Z actions removed"
  - "W actions retimed"
- "These changes will apply to in-flight appointments for any actions that haven't yet fired. Actions that have already fired will not be re-fired or undone."

**Footer:**
- "Cancel" (left, secondary)
- "Update workflow" (right, primary)

If the practice manager cancels, the changes remain unsaved in the editor. If they confirm, the changes save, the workflow execution recalculates for in-flight appointments, and a toast confirms.

---

## Action types

V1 ships a deliberately small set of action types. Resist adding more.

### Pre-appointment action types (v1)

#### Send form

Sends a SurveyJS form to the patient via SMS, using the existing Forms feature delivery mechanism. Creates a `form_assignment` record with a unique token, fires an SMS containing the form fill URL.

**Configuration:**
- Form picker (dropdown of forms in the org's library)
- Fire time
- Precondition

**State machine:**
- `scheduled` — action is scheduled, has not yet fired
- `sent` — SMS has been fired, patient has not opened the form
- `opened` — patient has opened the form fill page
- `completed` — patient has submitted the form
- `failed` — SMS delivery failed

#### Send reminder SMS

Sends a custom SMS message to the patient. Used for general reminders that don't involve a form or a specific action.

**Configuration:**
- Message text area with variable insertion (`{first_name}`, `{appointment_time}`, `{clinic_name}`, `{clinician_name}`)
- Fire time
- Precondition

**State machine:**
- `scheduled` — action is scheduled, has not yet fired
- `sent` — SMS has been fired
- `failed` — SMS delivery failed

#### Capture card on file

Sends the existing card capture flow to the patient via SMS. Patient receives an SMS, taps the link, completes the card capture flow.

**Configuration:**
- Fire time
- Precondition (typically "Only if card not on file")

**State machine:**
- `scheduled` — action is scheduled, has not yet fired
- `sent` — SMS has been fired
- `captured` — patient has stored a card
- `failed` — SMS delivery failed

#### Verify contact details

Sends the existing verify contact flow to the patient via SMS.

**Configuration:**
- Fire time
- Precondition (typically "Only if contact not verified")

**State machine:**
- `scheduled` — action is scheduled, has not yet fired
- `sent` — SMS has been fired
- `verified` — patient has verified their contact details
- `failed` — SMS delivery failed

### Post-appointment action types (v1 — editor only, execution deferred to v2)

#### Send SMS

Same as the pre-appointment "Send reminder SMS" action but framed for post-appointment use (summaries, follow-ups, check-ins).

#### Send form

Same as the pre-appointment "Send form" action. Used for PROMs questionnaires, satisfaction surveys, follow-up assessments.

#### Send file

Sends a PDF or other file to the patient via SMS. Used for exercise programs, discharge summaries, referral letters.

**Configuration:**
- File picker (dropdown of files uploaded to the org's library — file upload UI is out of scope for v1, files would be uploaded via a separate flow that doesn't yet exist)
- Optional accompanying message
- Fire time
- Precondition

#### Send rebooking nudge

Sends an SMS with a rebooking prompt and optional rebooking link.

**Configuration:**
- Message text area
- Optional rebooking link template
- Fire time
- Precondition (typically "Only if no future appointment booked")

### Preconditions (v1)

A small enumerated list of preconditions, picked from a dropdown on each action.

- **Always fires** (default) — no precondition
- **Form X not completed** — fires only if a specified form has not been completed by the patient. Practice manager picks which form when configuring.
- **Card not on file** — fires only if the patient has no card stored
- **Contact not verified** — fires only if the patient's contact details are not verified
- **No future appointment booked** (post only) — fires only if the patient has no future appointment scheduled

The set of available preconditions changes based on whether you're in pre or post mode. The mechanism is identical.

### Fire time picker

A small input combining a number and a unit.

**Pre-appointment:**
- Number input (1-365)
- Unit dropdown: "minutes before," "hours before," "days before"
- The phrasing is always "before appointment"

**Post-appointment:**
- Number input (0-365) where 0 means immediately
- Unit dropdown: "immediately," "minutes after," "hours after," "days after"
- When unit is "immediately," the number input is hidden or disabled

---

## Data model

### `appointment_types`

Existing or new table representing appointment types. Synced from PMS or created in Coviu.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to organisations |
| `name` | text | Display name |
| `duration_minutes` | int | Default duration |
| `default_fee` | decimal | Default fee, always editable |
| `default_room_id` | uuid nullable | Default room assignment |
| `pre_workflow_id` | uuid nullable | FK to workflows table |
| `source` | enum: `coviu`, `pms` | Where this type came from |
| `external_id` | text nullable | PMS-side ID for sync matching |
| `pms_provider` | text nullable | e.g. "cliniko," "halaxy" |
| `created_at`, `updated_at` | timestamps | |

When `source = 'pms'`, `name` and `duration_minutes` are read-only in the UI and overwritten on PMS sync. `default_fee`, `default_room_id`, and `pre_workflow_id` are always editable.

### `workflows`

A workflow is a sequence of actions. The same table stores both pre-workflows and post-workflows; the `kind` enum distinguishes them.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to organisations |
| `kind` | enum: `pre`, `post` | Determines which surfaces this workflow appears in |
| `name` | text | Display name (post only — pre-workflows inherit from their attached appointment type) |
| `description` | text nullable | Description shown to receptionists during the Process flow (post only) |
| `definition` | jsonb | Array of action definitions, see below |
| `status` | enum: `draft`, `published`, `archived` | |
| `created_at`, `updated_at` | timestamps | |

The `definition` jsonb column contains the action array:

```json
{
  "actions": [
    {
      "id": "action-uuid-1",
      "type": "send_form",
      "fire_offset": { "value": 14, "unit": "days" },
      "config": {
        "form_id": "form-uuid"
      },
      "precondition": null
    },
    {
      "id": "action-uuid-2",
      "type": "send_reminder_sms",
      "fire_offset": { "value": 3, "unit": "days" },
      "config": {
        "message": "Hi {first_name}, just a reminder you have an appointment in 3 days."
      },
      "precondition": {
        "type": "form_not_completed",
        "form_id": "form-uuid"
      }
    }
  ]
}
```

For pre-workflows, `fire_offset.value` is interpreted as "before the appointment" (so positive numbers mean earlier in time). For post-workflows, `fire_offset.value` is interpreted as "after the appointment" (positive numbers mean later in time, 0 means immediately).

The action `id` is a stable UUID generated when the action is created. It persists across edits and is used to track execution state.

### `appointment_workflow_runs`

Tracks workflow execution state per appointment. One row per appointment per workflow that runs against it. For pre-workflows, this row is created when the appointment is created. For post-workflows (v2), this row is created when the receptionist selects the post-workflow during the Process flow.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `appointment_id` | uuid | FK to appointments |
| `workflow_id` | uuid | FK to workflows |
| `kind` | enum: `pre`, `post` | Mirrors the workflow's kind |
| `status` | enum: `active`, `complete`, `cancelled` | Active = at least one action still scheduled or in progress |
| `started_at` | timestamp | When the workflow began running |
| `completed_at` | timestamp nullable | When the last action completed or the workflow was cancelled |
| `created_at`, `updated_at` | timestamps | |

### `appointment_workflow_actions`

Tracks individual action execution state. One row per action per workflow run. Created when the workflow run is created, populated from the workflow's `definition.actions` array.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `workflow_run_id` | uuid | FK to appointment_workflow_runs |
| `action_id` | text | The stable UUID from the workflow's definition |
| `action_type` | enum: `send_form`, `send_reminder_sms`, `capture_card`, `verify_contact`, `send_sms`, `send_file`, `send_rebooking_nudge` | |
| `scheduled_for` | timestamp | When this action should fire, calculated from the appointment scheduled_at and the action's fire_offset |
| `status` | enum: `scheduled`, `skipped`, `sent`, `opened`, `completed`, `captured`, `verified`, `failed` | The state machine state, varies by action type |
| `fired_at` | timestamp nullable | When the action actually fired |
| `result_data` | jsonb nullable | Action-specific result data (e.g. form_assignment_id for send_form actions, sms_message_id for send_reminder_sms) |
| `error_message` | text nullable | If status = failed |
| `created_at`, `updated_at` | timestamps | |

The workflow execution engine queries this table to find actions due to fire (`status = 'scheduled' AND scheduled_for <= NOW()`) and updates the status as actions execute.

### Workflow execution engine

The execution engine runs as part of the existing daily scan model:

- **Pre-appointment scan** runs once per day, queries `appointment_workflow_actions` where `kind = 'pre' AND status = 'scheduled' AND scheduled_for <= NOW()`. For each row, it evaluates the precondition (if any), and either fires the action or marks it as `skipped`.
- **Post-appointment scan** (v2) runs the same query for `kind = 'post'`.

When an action fires, the engine:
1. Checks the precondition. If false, mark `status = 'skipped'` and update `fired_at`.
2. Executes the action (sends SMS, creates form_assignment, etc.).
3. Updates `status` to the appropriate state (`sent` for SMS-based actions, `scheduled` → `sent` → `opened` → `completed` for form actions).
4. Stores any result data in `result_data` (e.g. the form_assignment_id for send_form actions).
5. Logs success or failure.

For form actions specifically, the engine integrates with the existing Forms feature: when a `send_form` action fires, it creates a `form_assignment` row using the existing flow. When the patient interacts with the form, the form_assignment status updates trigger updates to the corresponding `appointment_workflow_action` status.

### Cold start data

When a clinic signs up unintegrated (no PMS), the system seeds:

**5 default appointment types:**
1. Initial consultation (60 min, $220 default fee)
2. Follow-up consultation (45 min, $180 default fee)
3. Review appointment (30 min, $150 default fee)
4. Telehealth consultation (45 min, $180 default fee)
5. Brief check-in (15 min, $90 default fee)

**4 default pre-workflow templates** attached to the appropriate appointment types:

1. **Standard new patient intake** (attached to Initial consultation)
   - Send form: New patient intake form, 14 days before
   - Send form: Health history form, 7 days before
   - Send reminder SMS, 3 days before, only if intake form not completed
   - Capture card on file, 2 days before, only if card not on file

2. **Returning patient quick check** (attached to Follow-up consultation, Review appointment)
   - Send reminder SMS, 2 days before
   - Capture card on file, 1 day before, only if card not on file

3. **Telehealth-specific setup** (attached to Telehealth consultation)
   - Verify contact details, 7 days before, only if contact not verified
   - Send reminder SMS, 1 day before
   - (Note: device test reminder is implicit via the existing telehealth flow)

4. **Minimal reminder only** (attached to Brief check-in)
   - Send reminder SMS, 1 day before

**3 default post-workflow templates** in the post-workflow library (editor exists, execution deferred to v2):

1. **Discharge with home exercises**
   - Send SMS summary, immediately
   - Send file (exercise program PDF), 1 day after
   - Send PROMs check-in form, 14 days after
   - Send rebooking nudge, 30 days after, only if no future appointment booked

2. **Continue treatment**
   - Send SMS summary, immediately
   - Send rebooking nudge, 7 days after, only if no future appointment booked

3. **Discharge complete**
   - Send SMS summary, immediately
   - Send PROMs check-in form, 14 days after

These templates are seeded as data, not hardcoded. Practice managers can edit them, delete them, or add to them. They exist to give a new clinic something to start from and to make Diana's demo show a populated product on first load.

---

## Integration with the readiness dashboard

The readiness dashboard becomes the observability surface for workflow execution. Instead of being forms-only, the dashboard generalises to show all workflow actions across all appointments.

### What changes about the dashboard

The current readiness dashboard (in flight) queries `form_assignments` to find outstanding forms. Once the workflow engine ships, the dashboard should query `appointment_workflow_actions` instead, filtered to actions that are scheduled, sent, or otherwise not in a terminal state.

**Row content (collapsed) becomes:**
- Patient name (clickable, opens patient slide-out)
- Appointment time
- Clinician
- Workflow status summary: "X of Y actions complete · Z outstanding"
- Inline action buttons: Resend (any outstanding SMS), Call

**Row content (expanded) becomes:**
- The collapsed row stays visible
- Below it, the full action timeline from the workflow, mirroring the editor view
- Each action shows: icon, name, fire time relative to appointment, status badge, fired_at timestamp
- Per-action actions where relevant: Resend form, Resend SMS

The dashboard should support both pre and post workflows once post execution lands in v2. For v1, only pre-workflow actions appear in the dashboard. Post-workflow actions become visible once their execution path is built.

### A toggle or filter for pre vs post

Once both pre and post workflows execute, the dashboard will need a way to filter or toggle between them. The simplest approach is a header-level segmented control similar to the workflows page itself:

- **All** (default) — shows both pre and post workflow actions across all appointments
- **Pre-appointment** — shows only upcoming appointments with outstanding pre-workflow actions
- **Post-appointment** — shows only past appointments with active post-workflow actions

For v1 the toggle isn't needed because only pre-workflow actions exist. The toggle gets added as part of the v2 dashboard generalisation.

### Sequencing

The dashboard work that's currently in flight (forms-only) should continue and ship as v0 of the dashboard. Once the workflow engine ships, the dashboard gets generalised to query `appointment_workflow_actions` instead of `form_assignments`. The visual structure stays mostly the same; the data source broadens.

This means there's a brief period where the forms-only dashboard exists and then gets replaced. That's acceptable — the forms-only version is small enough to throw away (or rather, to refactor) and it gives you a working test surface during the workflow build.

---

## Integration with appointment creation

When an appointment is created (via PMS sync, manual run sheet entry, or any other path), the system checks whether the appointment's type has a `pre_workflow_id`. If yes:

1. Create an `appointment_workflow_runs` row with `kind = 'pre'`, `workflow_id = appointment_type.pre_workflow_id`, `status = 'active'`, `started_at = NOW()`.
2. For each action in the workflow's `definition.actions`, create an `appointment_workflow_actions` row:
   - Calculate `scheduled_for` as `appointment.scheduled_at - action.fire_offset` (for pre-workflows)
   - If `scheduled_for` is in the past, the action will fire on the next scan and is effectively immediate
   - Set `status = 'scheduled'`
3. Save everything in a single transaction. If any step fails, the appointment creation succeeds but the workflow run fails — log it and surface it for manual intervention.

The pre-appointment scan picks up the new actions and fires them according to their `scheduled_for`.

---

## Integration with the Process flow (v2)

When the receptionist completes the Process flow for a session, the existing payment + outcome step gets a new sub-step: **select post-appointment workflow**.

For v1, the outcome step is currently a free-text field or simple selection. For v2, it becomes a dropdown of available post-workflows from the library, filtered if applicable. When the receptionist selects a post-workflow:

1. Create an `appointment_workflow_runs` row with `kind = 'post'`, `workflow_id = selected_workflow_id`, `status = 'active'`, `started_at = NOW()`.
2. For each action in the workflow's `definition.actions`, create an `appointment_workflow_actions` row:
   - Calculate `scheduled_for` as `appointment.completed_at + action.fire_offset` (for post-workflows)
   - If `fire_offset.unit = 'immediately'`, set `scheduled_for = NOW()` so the action fires on the next scan (or immediately, depending on the architecture)
   - Set `status = 'scheduled'`
3. Save everything in a single transaction.

The post-appointment scan picks up the new actions and fires them.

This integration is **out of scope for v1**. The Process flow remains as it currently is. The post-workflow library exists but its workflows do not execute.

---

## Edge cases

### Appointment created with insufficient lead time for a pre-workflow action

A pre-workflow has a "Send form 14 days before" action. A receptionist creates an appointment for next Tuesday — only 5 days away. The action's `scheduled_for` is in the past at the time of creation.

**Behaviour:** The action is created with status `scheduled` and `scheduled_for` in the past. The next pre-appointment scan picks it up and fires it immediately. The intent is "make sure this happens" — firing late is better than not firing at all.

This applies to all action types in v1. There is no per-action setting to opt out of this behaviour. If practice managers complain, we can add an "Only fire if at least X time remains" option in v2.

### Appointment cancelled or deleted

When an appointment is cancelled or deleted, its `appointment_workflow_runs` row is updated to `status = 'cancelled'`. All `appointment_workflow_actions` rows for that run are updated to `status = 'cancelled'` if they haven't fired yet. Already-fired actions are not retroactively undone.

### Workflow deleted while in-flight

A practice manager deletes a workflow that has active workflow runs. The system prevents this with a confirmation modal: "X appointments are currently using this workflow. Deleting it will stop all scheduled actions for those appointments. Continue?"

If confirmed, all active `appointment_workflow_runs` for that workflow are set to `status = 'cancelled'` and their pending actions are also cancelled.

### Action type removed from a workflow that has in-flight runs

A practice manager edits a workflow and removes an action that is currently in `scheduled` status on in-flight runs. After the mid-flight edit warning modal is confirmed, the corresponding `appointment_workflow_actions` rows for in-flight runs are set to `status = 'cancelled'`.

### Action type added to a workflow with in-flight runs

A practice manager edits a workflow and adds a new action. After the mid-flight edit warning modal is confirmed, new `appointment_workflow_actions` rows are created for in-flight runs with `scheduled_for` calculated from each appointment's `scheduled_at` and the new action's `fire_offset`. If the calculated time is in the past, the action fires on the next scan.

### Action retimed in a workflow with in-flight runs

A practice manager edits a workflow and changes an action's fire time. After the mid-flight edit warning modal is confirmed:
- For in-flight runs, the corresponding `appointment_workflow_actions` rows have their `scheduled_for` updated to the new time
- If the action has already fired (`status` is not `scheduled`), it is not re-fired
- If the new `scheduled_for` is in the past, the action fires on the next scan

### Patient unsubscribes or revokes consent

Out of scope for v1. The system fires actions regardless of patient consent state. SMS unsubscribe handling is a future feature.

### Action fires but SMS delivery fails

The action's status is set to `failed` and the `error_message` is logged. The action is not retried automatically. The receptionist sees the failed action on the readiness dashboard and can manually resend.

### Daily scan fails or is delayed

The next scan picks up all overdue actions and fires them. The system is resilient to scan delays — actions just fire late. There's no concept of "missed window" in v1.

### A workflow is edited to add an action whose time is before any existing action

The new action sorts to the appropriate position in the timeline based on its time. The visual order updates automatically when the editor re-renders. No special handling required.

### Two workflows attached to one appointment type

Not allowed. The data model has a single `pre_workflow_id` foreign key on `appointment_types`. The UI does not provide a way to attach multiple workflows. If a practice manager wants different behaviour for different patient situations, they use preconditions on individual actions within the single workflow.

### Post-workflow attached to outcome of an appointment with no post-workflow trigger configured

V1: not applicable, post-workflows don't execute.
V2: the receptionist always sees the option to select a post-workflow during the Process flow, even if the appointment type doesn't typically have one. They can pick "no post-workflow" if appropriate.

---

## Accessibility

- Keyboard navigation: tab through the left pane list and the editor cards. Enter to select a list item. Enter on a collapsed action card to expand it.
- Focus management: when an action card is expanded, focus moves to the first input in the configuration form. When the card is collapsed, focus returns to the card itself.
- ARIA labels: the toggle in the page header uses `role="tablist"` with `role="tab"` on each option. The action cards use `aria-expanded` to indicate state. Status dots in the left pane have aria-labels describing the workflow status.
- Screen reader announcements: when an action is added, removed, or retimed, an aria-live region announces the change. The mid-flight edit warning modal has proper aria-modal and aria-labelledby attributes.
- Colour contrast: all text meets WCAG AA. Status badges use the darkest shade from their colour family for text.
- The fire time pill on each card communicates timing via text, not colour, so it's accessible to screen readers and colour-blind users.

---

## Decision summary

| Decision | Choice | Rationale |
|---|---|---|
| Workflow structure | Linear sequence of timed actions, no branching | Matches practice manager mental model. Branching handled via per-action preconditions. |
| Pre vs post architecture | Pre attached to appointment types, post standalone in a library | Reflects the temporal asymmetry of when each is decided (creation time vs processing time) |
| Page structure | One page with a toggle | Keeps navigation clean, signals the relationship between pre and post |
| Editor component | Same component for both pre and post | Reduces build cost, ensures visual consistency |
| Action types in v1 | 4 pre, 4 post (8 total) | Tight constraint to keep editor scannable |
| Preconditions in v1 | 4 enumerated options, single per action | No nested logic, no compound conditions |
| Fire time model | N units before/after appointment, plus "immediately" for post | Matches how practice managers describe timing |
| Execution model | Daily scans, not real-time | Matches Layer 2 scan architecture, simpler implementation |
| Mid-flight edits | Allowed with warning modal | Prioritises practice manager flexibility over execution consistency |
| Cold start | 5 default appointment types + 4 pre templates + 3 post templates seeded | Avoids empty state, demos well |
| V1 scope | Pre execution + pre/post editors. Post execution deferred. | Tighter scope, complete demo loop, post designed but not built |
| Readiness dashboard | Generalises to show workflow execution state, not just forms | Becomes the observability surface for the workflow engine |
| Mixed-source appointment types | Coviu types and PMS-synced types coexist in one list | Reflects v1 reality that integrated clinics still create some types in Coviu |
| Late-firing actions | Fire immediately if scheduled time is in the past | Better to fire late than not at all |

---

## Risks and notes

- **The mid-flight edit recalculation logic is the trickiest part.** Building it correctly requires careful handling of action state transitions, idempotency on the next scan, and clear semantics for what happens when an in-flight action is retimed or removed. Worth additional design review before implementation.

- **The workflow execution scan needs to be idempotent.** If a scan crashes mid-execution, the next scan should pick up where the previous left off without re-firing already-fired actions. Action status transitions must be atomic.

- **Form submission state needs to flow back into workflow action state.** When a form_assignment moves from `sent` to `completed`, the corresponding `appointment_workflow_action` row needs to update too. This is a cross-feature integration point and should be designed with the existing Forms feature in mind. A database trigger or a service-layer update on form_assignment status changes would handle this cleanly.

- **The cold start templates will need real content.** The templates outlined above are placeholders for the structure. Actual SMS message text, form names (assuming the form templates exist), and timing values should be reviewed against allied health and psychology best practices before shipping.

- **PMS sync overwriting workflows.** When an integrated clinic re-syncs from PMS, the sync should not overwrite the `pre_workflow_id` foreign key on existing appointment types. Only the `name` and `duration_minutes` fields get updated from PMS data. The workflow attachment is preserved.

- **The action ID stability across edits.** When a workflow is edited, existing actions retain their `id`. New actions get new IDs. Removed actions have their IDs removed from the workflow definition but their state in `appointment_workflow_actions` for in-flight runs remains (marked as cancelled). This stability matters for tracking execution state across edits.

- **The post-workflow library will be small but visible.** Practice managers will see post-workflows in the editor in v1 even though they don't execute. There needs to be a clear visual signal that post-workflows are "configured but not yet active" — perhaps a banner at the top of the post-appointment view stating "Post-appointment workflows are configured here but will begin executing in a future release." Otherwise practice managers will be confused when their post-workflows don't fire.

- **The action type icon set needs to be designed.** This spec assumes icons exist for each action type. A consistent visual language across icons (form, SMS, card, file, etc.) is important for the editor to scan well.

---

## Addendum: Data model reconciliation with existing schema

> This section was added after reviewing the spec against the implemented database schema. The spec's original data model section proposed tables that did not exist. Rather than replacing the existing schema, the implementation augments the existing tables. This addendum documents the reconciled data model.

### Existing tables retained as-is

The following tables existed before this spec and are kept without structural changes:

- **`workflow_templates`** — replaces the spec's proposed `workflows` table. Uses `direction` column (`workflow_direction` enum: `pre_appointment` / `post_appointment`) instead of the spec's `kind` enum.
- **`workflow_action_blocks`** — normalized action definitions, one row per action. Replaces the spec's JSONB `definition.actions[]` approach. Each action block has its own UUID primary key, used as the stable action ID for execution tracking.
- **`type_workflow_links`** — junction table linking appointment types to workflow templates with a `direction` column (`workflow_direction` enum: `pre_appointment` / `post_appointment`). Replaces the spec's `pre_workflow_id` FK on `appointment_types`. A partial unique index enforces one pre-workflow per appointment type at the DB level.
- **`outcome_pathways`** — retained as the user-facing concept during the Process flow. Each outcome pathway links to a `workflow_template` (direction = `post_appointment`) via `workflow_template_id`. The post-appointment view of the workflows page shows outcome pathways in the left pane, with the linked workflow visible in the editor.
- **`appointment_actions`** — runtime execution rows, one per action per appointment. Replaces the spec's proposed `appointment_workflow_actions` table. Each row references a `workflow_action_blocks` row via `action_block_id` FK.

### New table: `appointment_workflow_runs`

Tracks per-appointment workflow execution as a parent record. One row per appointment per workflow that runs against it. `appointment_actions` rows reference this table via `workflow_run_id` FK.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `appointment_id` | uuid | FK to appointments |
| `workflow_template_id` | uuid | FK to workflow_templates |
| `direction` | `workflow_direction` enum (`pre_appointment`, `post_appointment`) | Same enum used by `workflow_templates.direction` and `type_workflow_links.direction` |
| `status` | `workflow_run_status` enum (`active`, `complete`, `cancelled`) | |
| `started_at` | timestamptz | When the workflow began running |
| `completed_at` | timestamptz nullable | When the last action completed or the workflow was cancelled |
| `created_at`, `updated_at` | timestamptz | |

### Columns added to existing tables

**`workflow_templates`:**
- `status` (`workflow_template_status` enum: `draft`, `published`, `archived`) — controls visibility and editability

**`workflow_action_blocks`:**
- `precondition` (JSONB, nullable) — per-action firing condition. `null` means "always fires." Shape is application-validated, not DB-constrained. Examples: `{ "type": "form_not_completed", "form_id": "uuid" }`, `{ "type": "card_not_on_file" }`, `{ "type": "contact_not_verified" }`, `{ "type": "no_future_appointment" }`

**`appointment_types`:**
- `source` (`appointment_type_source` enum: `coviu`, `pms`) — where the type came from. When `source = 'pms'`, `name` and `duration_minutes` are read-only in the UI.
- `pms_provider` (text, nullable) — e.g. "cliniko", "halaxy"

**`appointment_actions`:**
- `workflow_run_id` (uuid, nullable FK to `appointment_workflow_runs`) — groups actions under a parent run. Nullable for backwards compatibility with any pre-existing rows.
- `fired_at` (timestamptz, nullable) — when the action actually fired
- `error_message` (text, nullable) — failure details when `status = 'failed'`

### Enum extensions

**`action_type`** — added: `verify_contact`, `send_file`

**`action_status`** — added: `scheduled`, `opened`, `captured`, `verified`, `cancelled`

Convention: new workflow-engine-spawned action rows use `scheduled` as the initial status. `pending` is reserved for backwards compatibility with pre-existing rows and non-workflow contexts.

### Direction naming convention

The `workflow_direction` enum (`pre_appointment` / `post_appointment`) is the canonical type for the pre/post concept across the entire schema. It is used by:
- `workflow_templates.direction`
- `type_workflow_links.direction` (migrated from TEXT `phase` column in `009_align_workflow_direction_naming.sql`)
- `appointment_workflow_runs.direction`

One enum, one set of values, everywhere. No separate `kind` or `phase` columns exist.

### Constraints

- **One pre-workflow per appointment type**: enforced by partial unique index on `type_workflow_links (appointment_type_id) WHERE direction = 'pre_appointment'`
- **Post-workflows via outcome pathways**: no cardinality constraint — multiple outcome pathways can link to different post-workflow templates, and the same template can be shared across pathways

### What the spec proposed but is NOT implemented

- `workflows` table with JSONB `definition` column — replaced by existing `workflow_templates` + `workflow_action_blocks`
- `appointment_workflow_actions` table — replaced by existing `appointment_actions` with added columns
- `pre_workflow_id` FK on `appointment_types` — replaced by `type_workflow_links` junction table
- `default_room_id` on `appointment_types` — deferred; rooms are location-scoped while appointment types are org-scoped, making a default room ambiguous for multi-location clinics
