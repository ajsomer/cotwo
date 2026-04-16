# Post-Appointment Workflows

Outcome Pathways, Action Blocks, Process Integration & Readiness

April 2026

**CONFIDENTIAL**

## Overview

| **Surface** | Post-appointment workflows (pathway configuration through readiness resolution) |
| --- | --- |
| **Users** | Practice managers (configure pathways), receptionists (select pathways at Process, resolve tasks on readiness) |
| **Available to** | Complete tier |
| **Real-time** | Yes. Action runs surface on readiness in real time as they fire. |
| **Priority** | Follows pre-appointment. Unblocks the full post-session experience. |

Post-appointment workflows are what happens after a session is complete. When the receptionist processes a session at the end of the appointment, they select an outcome pathway. That pathway loads a workflow template with an ordered timeline of action blocks and default timings. The receptionist adjusts timings and toggles individual blocks if needed, then confirms. From that moment, the engine fires the scheduled actions. Patient-facing actions send SMS or forms at their scheduled times. Staff-facing task actions appear on the post-appointment readiness tab for the receptionist to action.

This spec covers four surfaces: the pathway list page (new tab on the existing Workflows page), the pathway editor (slide-over with timeline view), the Process flow integration (changes to the existing Process slide-over), and the post-appointment readiness tab.

*The goal is that the receptionist at Process sees a scannable set of pathways, picks the right one in under ten seconds, tweaks timings for the specific patient, and confirms. Everything downstream runs on its own.*

## Mental Model

Post-appointment workflows are structurally different from pre-appointment in three ways that matter.

**One, the primary object is the pathway, not the appointment type.** Outcome pathways are global at the organisation level. A practice manager defines a pathway once. Any appointment type can use any pathway at Process. This is deliberate: the same clinical follow-up ("chase up in 3 days, send PROMs in 2 weeks") applies to many different session types, and forcing the practice manager to redefine it per appointment type is wasted work.

**Two, the model is action blocks on a timeline, not a fixed capability set.** Pre-appointment's intake package is a small, fixed set of toggleable capabilities (verify, card, consent, forms) because every clinic's pre-appointment needs fall within a predictable range. Post-appointment is more flexible. Specialists in particular need to schedule follow-ups at variable timings based on clinical context. A pathway's workflow template is an ordered list of action blocks, each with a timing offset in days from the end of the session.

**Three, customisation happens at two moments, not one.** The practice manager sets the defaults when defining a pathway. The receptionist then customises those defaults at Process for the specific patient, based on what the clinician instructed at the end of the session. Both surfaces are first-class. Process-time edits apply only to that one run and never write back to the pathway definition.

The three action types for post-appointment v1:

- **`send_sms`.** Patient-facing. Sends an SMS to the patient at the scheduled time. Carries a template with merge fields in `config`. The practice manager picks from a small set of default templates or writes their own. Reuses the existing `send_sms` action type.
- **`deliver_form`.** Patient-facing. Sends the patient an SMS link to complete a form at the scheduled time. Carries a `form_id` reference from the forms library. Has the same readiness lifecycle as a pre-appointment form (scheduled, at risk, overdue, form completed needs transcription, recently completed). Reuses the existing `deliver_form` action type.
- **`task`.** Staff-facing. **New action type.** Appears on the post-appointment readiness dashboard at the scheduled time as a reminder for the receptionist to do something. Carries a title and optional description in `config`. The receptionist resolves with a Resolve button and an optional note.

No conditional chaining in v1. No "only fire block B if block A came back with score X". Every action block is unconditionally scheduled at its timing offset. Conditionality can be added later if the engine and the UI can absorb it without compromising the core model.

## Unified Engine Architecture

Post-appointment workflows reuse the existing workflow engine infrastructure. No parallel table structure. The same tables that power pre-appointment intake packages power post-appointment pathways, configured differently.

**How the pieces fit:**

| **Concept** | **Pre-appointment** | **Post-appointment** |
| --- | --- | --- |
| Configuration surface | Appointment type editor | Pathway editor |
| Template ownership | `type_workflow_links` (one template per appointment type) | `outcome_pathways.workflow_template_id` (one template per pathway) |
| Template direction | `workflow_templates.direction = 'pre_appointment'` | `workflow_templates.direction = 'post_appointment'` |
| Action blocks | `workflow_action_blocks` with `action_type` in (`intake_package`, `intake_reminder`, `add_to_runsheet`) | `workflow_action_blocks` with `action_type` in (`send_sms`, `deliver_form`, `task`) |
| Timing model | `offset_minutes` with `offset_direction = 'before'` (relative to appointment time) | `offset_minutes` with `offset_direction = 'after'` (relative to session end). Stored as days × 1440. |
| Runtime instances | `appointment_actions` (linked to `appointment_id`) | `appointment_actions` (linked to `appointment_id`, with `session_id` added) |
| Workflow runs | `appointment_workflow_runs` with `direction = 'pre_appointment'` | `appointment_workflow_runs` with `direction = 'post_appointment'` |
| Instantiation trigger | Appointment created (PMS sync or manual entry) | Receptionist confirms pathway at Process |
| Customisation at instantiation | None (fires from template defaults) | Per-action timing and content overrides at Process |

### Timing Convention for Post-Appointment

Action blocks use `offset_minutes` with `offset_direction = 'after'`. The anchor is the session's `session_ended_at` timestamp. Days are stored as `offset_minutes = days × 1440`. The editor shows days; the database stores minutes for consistency with pre-appointment.

**When `session_ended_at` is set.** `session_ended_at` is the moment the receptionist confirms the Process flow, not an earlier auto-complete moment. The reasoning: in-person sessions can auto-complete (via scheduled duration elapsing) hours before the receptionist actually gets to Process. If post-appointment timing anchored on auto-complete, a "day 0" action scheduled at Process confirmation would fire already-late by the elapsed gap. Anchoring on Process confirmation means "day 0" is always "about now", which matches clinical intent.

Concretely: the Process confirmation transaction sets `sessions.session_ended_at = now()` as part of the same atomic write that creates `appointment_workflow_runs` and `appointment_actions`. The `scheduled_for` for each action is computed as `session_ended_at + offset_minutes`.

**Zero-offset buffer.** When `offset_minutes = 0` (same day), the run's `scheduled_for` is set to `session_ended_at + 1 minute` rather than exactly `session_ended_at`. This gives the Process confirmation transaction time to commit before the engine scan picks up the action. Without the buffer, the scan could observe the action before the transaction is visible and skip it.

**`session_ended_at` already exists.** The `sessions` table already has `session_ended_at TIMESTAMPTZ` (added in 001_initial_schema.sql). No migration needed for this column. The Process flow currently does not set it — the post-appointment implementation must ensure the Process confirmation transaction writes `session_ended_at = now()` as part of the atomic commit.

### Config Snapshot Discipline

Post-appointment `appointment_actions` rows carry a full snapshot of their `config` JSONB at the moment they are created (at Process confirmation). The snapshot is not a delta — every action gets its complete, resolved configuration, even for fields the receptionist did not customise.

This has three consequences the implementation must honour:

One, when the readiness dashboard, Process flow, or any other surface renders an action's content (SMS copy, task title, form reference), it reads from `appointment_actions.config`, never from `workflow_action_blocks.config`. The action's own snapshot is the source of truth.

Two, mid-flight edits to a pathway's `workflow_action_blocks.config` do not propagate to existing `appointment_actions`. The mid-flight warning modal is not a social contract — it is enforced by the snapshot model. A practice manager editing an SMS template only affects actions instantiated after the edit.

Three, the `appointment_actions.action_block_id` FK to `workflow_action_blocks` exists for audit and traceability only. It is never followed at render time. If a `workflow_action_blocks` row is deleted (e.g. pathway restructured), existing `appointment_actions` continue to render from their own `config` snapshot without issue.

The one exception: `form_id` on `deliver_form` actions is stored on the `appointment_actions` row directly (not inside `config`) because the existing engine expects it there. Customised form selection at Process writes to `appointment_actions.form_id`, and readiness reads from the same column. The snapshot discipline still applies — the action carries its own `form_id` independent of the current `workflow_action_blocks.form_id`.

## Schema Changes

No new tables. Extensions to existing tables and one new enum value.

### Enum Changes

```sql
-- Add 'task' to the action_type enum
ALTER TYPE action_type ADD VALUE 'task';
```

### Table: `outcome_pathways` (existing, extended)

| **Column** | **Change** | **Notes** |
| --- | --- | --- |
| `archived_at` | **ADD** `TIMESTAMPTZ DEFAULT NULL` | NULL = active, set = soft-deleted. Pathway disappears from Process picker but in-flight runs continue. |

The existing `workflow_template_id` FK becomes the primary link between a pathway and its action block configuration. Currently nullable and unused — becomes required for pathways with configured actions.

### Table: `sessions` (existing, extended)

| **Column** | **Change** | **Notes** |
| --- | --- | --- |
| `outcome_pathway_id` | **ADD** `UUID REFERENCES outcome_pathways(id)` | Set when the receptionist confirms a pathway at Process. NULL if no pathway selected or Core tier. |

### Table: `appointment_actions` (existing, extended)

| **Column** | **Change** | **Notes** |
| --- | --- | --- |
| `session_id` | **ADD** `UUID REFERENCES sessions(id)` | Links post-appointment actions to their originating session. NULL for pre-appointment actions. |
| `resolved_at` | **ADD** `TIMESTAMPTZ` | When a task action was resolved by the receptionist. NULL for non-task actions and unresolved tasks. |
| `resolved_by` | **ADD** `UUID REFERENCES users(id)` | Which user resolved the task. NULL for non-task actions. |
| `resolution_note` | **ADD** `TEXT` | Optional free-text note from the receptionist at resolution time. |

### Table: `workflow_action_blocks` (existing, no structural changes)

Post-appointment action blocks use existing columns:

| **Column** | **Post-appointment usage** |
| --- | --- |
| `template_id` | FK to the pathway's `workflow_template_id` |
| `action_type` | `send_sms`, `deliver_form`, or `task` |
| `offset_minutes` | Days × 1440. 0 = same day. |
| `offset_direction` | Always `'after'` for post-appointment |
| `form_id` | Set for `deliver_form` actions. NULL otherwise. |
| `config` | JSONB carrying type-specific configuration (see below) |
| `sort_order` | Display ordering on the timeline |
| `precondition` | NULL for v1 (no conditional chaining) |

**`config` JSONB shapes by action type:**

```jsonc
// send_sms
{
  "message": "Hi {patient_name}, this is a check-in from {clinic_name}...",
  "default_enabled": true
}

// deliver_form
{
  "reminder_sms": "Dr {clinician_name} has sent you a form to complete.",  // optional
  "default_enabled": true
}

// task
{
  "task_title": "Send referral to specialist",
  "task_description": "Email referral letter to Dr Wong at Sydney Ortho.",  // optional
  "default_enabled": true
}
```

The `default_enabled` flag in `config` controls whether the action block is on or off by default when a receptionist picks the pathway at Process. An action block with `default_enabled: false` stays in the pathway definition but is toggled off by default — the receptionist can re-enable it for a specific patient.

### Table: `appointment_workflow_runs` (existing, no structural changes)

Post-appointment runs use existing columns:

| **Column** | **Post-appointment usage** |
| --- | --- |
| `appointment_id` | The appointment behind the session |
| `workflow_template_id` | The pathway's template |
| `direction` | `'post_appointment'` |
| `status` | `active` → `complete` or `cancelled` |

### New Indexes

```sql
-- Engine dispatch scan for post-appointment
CREATE INDEX idx_appointment_actions_session
  ON appointment_actions(session_id)
  WHERE session_id IS NOT NULL;

-- Readiness dashboard: post-appointment actions by status
CREATE INDEX idx_appointment_actions_post_status
  ON appointment_actions(status, scheduled_for)
  WHERE session_id IS NOT NULL;

-- Outcome pathway lookup (active only)
CREATE INDEX idx_outcome_pathways_active
  ON outcome_pathways(org_id)
  WHERE archived_at IS NULL;
```

## Pathway List Page

| **Route** | /workflows (Post-appointment tab) |
| --- | --- |
| **Purpose** | List all outcome pathways at the organisation. Create, edit, archive pathways. |
| **Users** | Practice manager, clinic owner |
| **Structure** | Mirrors the pre-appointment tab visually: section label, italic explainer, table of pathways. Single section (no equivalent of standalone collections). |

### Layout

The Post-appointment tab replaces the current placeholder with a pathway list that mirrors the pre-appointment tab's visual structure. Same cream background, same white table, same header row treatment, same column spacing rules. The goal is visual symmetry between the two tabs so a practice manager recognises the pattern immediately.

**Section header row:** "Outcome pathways" label at 14px weight 500 on the left. "+ New pathway" button (teal primary) on the right, vertically centred against the label block.

**Italic explainer below the label:** "Post-appointment workflows are triggered when the receptionist selects an outcome pathway at Process. Each pathway is a timeline of actions that fire on their configured schedule."

**Pathway table columns:** Pathway name, Actions, Status.

| **Column** | **Content** |
| --- | --- |
| Pathway name | Pathway title (weight 500) with a one-line muted description beneath |
| Actions | Count of configured action blocks in the pathway's template (e.g. "4 actions") |
| Status | "—" when no active runs. "X in flight ↗" in amber when `appointment_workflow_runs` with `direction = 'post_appointment'` and `status = 'active'` exist for this pathway's template, styled identically to the pre-appointment tab. |

No modality column (pathways are modality-agnostic). No duration column (pathways don't have a duration).

### Empty State

Before any pathways are configured, the table is replaced with an empty state card: "No outcome pathways yet. Create your first pathway to define what happens after a session." Primary button: "+ New pathway". Secondary link: "Learn about outcome pathways" (links to help doc, future).

### Seeded Pathways

For the demo, the following pathways are seeded (replacing the current three placeholder pathways):

- **Continue treatment.** Generic continue-care pathway. Task "Chase-up call" at day 2. `send_sms` check-in at day 7.
- **Discharge with resources.** Discharge pathway. `send_sms` summary at day 0 (same day). `deliver_form` (Patient Satisfaction Survey, `form_id = 00000000-0000-0000-0000-f00000000006`) at day 14.
- **Refer to specialist.** Referral pathway. Task "Send referral" at day 0. Task "Chase referral status" at day 5.
- **Rebooking nudge.** Rebooking pathway. `send_sms` rebooking nudge at day 14.

Each seeded pathway gets a `workflow_template` (direction `post_appointment`, status `published`) with the appropriate `workflow_action_blocks`. The existing three placeholder `outcome_pathways` rows are replaced. The "Patient Satisfaction Survey" form referenced by the Discharge pathway already exists in the form templates seed (migration 008, id `00000000-0000-0000-0000-f00000000006`).

## Pathway Editor

| **Route** | Slide-over panel on /workflows |
| --- | --- |
| **Purpose** | Create and edit outcome pathways. Compose action blocks on a timeline. |
| **Users** | Practice manager, clinic owner |
| **Pattern** | Slide-over from the right, matching the appointment type editor's visual and interaction pattern. Timeline view replaces the capability list inside. |

### Layout

The editor opens as a slide-over panel from the right edge, 520px wide, full height. The run sheet and workflows list remain visible behind it (dimmed). Same slide-over pattern as the appointment type editor.

**Panel header:** "Create new pathway" or "Edit pathway: [name]". Close button (X) on the right.

**Panel body (top section):** Basic fields in a stacked form.

| **Field** | **Type** | **Notes** |
| --- | --- | --- |
| Pathway name | Text input | Required. E.g. "Continue treatment" |
| Description | Text input | Optional. One-line description shown on the list page. |

**Panel body (timeline section):** Below the basic fields, a vertical timeline occupies the bulk of the panel.

### Timeline View

The timeline is a vertical left-edge rail with dots at each action block's timing offset. Action block cards attach to the dots on the right side of the rail. The visual pattern is inspired by activity timelines: a continuous line marks time, dots mark events, cards expand to show content.

The timeline starts at the top with a "Session complete" marker (T+0). Action blocks are ordered by `sort_order` (which tracks `offset_minutes`), earliest first. Each action block is a card containing:

- **Timing indicator (top of card).** "Day 2" or "Same day" or "Day 14". Editable inline by clicking. Writes to `offset_minutes` as days × 1440.
- **Action type icon + label.** Small icon and text label: SMS, Form, or Task.
- **Action content.** For SMS: template preview (first line of `config.message`). For Form: form name from the forms library (via `form_id`). For Task: `config.task_title`.
- **Toggle.** Enable/disable this block in the pathway definition. Writes to `config.default_enabled`. A disabled block stays in the pathway but is off by default when a receptionist picks the pathway at Process.
- **Edit button.** Opens the block detail editor (inline expansion).

Below the last action block card, an **"+ Add action"** button at the end of the timeline rail. Clicking it opens a small picker: "SMS", "Send form", "Task". Picking one creates a new `workflow_action_blocks` row and immediately opens its detail editor.

### Block Detail Editor (Per Action Block)

Each action block has a set of fields specific to its type. The detail editor is inline within the card (expanded state).

#### Timing (All Blocks)

| **Field** | **Behaviour** |
| --- | --- |
| Timing input | Free integer input for days. Accepts 0 (same day) through N. Stored as `offset_minutes = days × 1440`. |
| Quick-pick chips | 1d, 3d, 7d, 14d, 30d. Clicking a chip populates the input. |
| Label | "Day X after session" or "Same day" when 0. |

#### SMS Block (`action_type = 'send_sms'`)

| **Field** | **Behaviour** |
| --- | --- |
| Template picker | Dropdown of default templates: "Check-in", "Summary", "Rebooking nudge", "Custom". Picking a template populates the copy field. |
| SMS copy | Multiline text input. Supports merge fields: `{patient_name}`, `{clinician_name}`, `{session_date}`, `{clinic_name}`, `{rebooking_link}`. Shows character count. Stored in `config.message`. |
| Preview | Shows the composed SMS with merge fields replaced by example values. |

#### Send Form Block (`action_type = 'deliver_form'`)

| **Field** | **Behaviour** |
| --- | --- |
| Form picker | Dropdown of forms from the clinic's form library. Search by form name. Writes to `form_id` on the action block. |
| Form preview | Inline preview of selected form (title, field count). |
| Reminder SMS copy | Optional. A short SMS sent alongside the form link. Stored in `config.reminder_sms`. Merge fields available. |

#### Task Block (`action_type = 'task'`)

| **Field** | **Behaviour** |
| --- | --- |
| Task title | Short text input. Required. E.g. "Send scan request" or "Call patient to rebook". Stored in `config.task_title`. |
| Task description | Optional multiline text. Additional context the receptionist needs to complete the task. Stored in `config.task_description`. |

### Save Behaviour

The save button sits fixed at the bottom of the panel: "Save pathway" (teal primary) on the right, "Cancel" (secondary) next to it.

**Save logic (atomic via RPC, mirroring `configure_appointment_type()`):**

A new `configure_outcome_pathway()` RPC function handles the multi-table save atomically:

1. Upsert `outcome_pathways` row (name, description).
2. Upsert `workflow_templates` row (direction `post_appointment`, status `published`). Link via `outcome_pathways.workflow_template_id`.
3. Sync `workflow_action_blocks`: insert new blocks, update changed blocks, delete removed blocks. Each block carries `action_type`, `offset_minutes`, `offset_direction = 'after'`, `sort_order`, `form_id`, and `config` JSONB.

**Mid-flight edits.** If the pathway's template has active `appointment_workflow_runs` at the time of save, a confirmation modal appears: "This pathway has N in-flight runs. Changes to the pathway definition will not affect existing runs. New runs created from Process after save will use the updated pathway." Same pattern as the pre-appointment intake package mid-flight warning. On confirm, the save proceeds and existing runs continue with their frozen original configuration.

**Soft delete.** Deleting a pathway sets `archived_at` to now. The pathway disappears from the Process picker and pathway list (filtered by `WHERE archived_at IS NULL`). Existing in-flight `appointment_workflow_runs` continue until they complete naturally. The pathway record stays in the database for audit.

## Process Flow Integration

| **Route** | Slide-over Process panel on /runsheet (existing) |
| --- | --- |
| **Purpose** | Add outcome pathway selection as step 2 of the existing Process flow, followed by action block customisation as step 2b. |
| **Users** | Receptionist |
| **Existing flow** | Step 1 Payment → Step 2 Outcome (Complete only) → Step 3 Done. This spec expands Step 2 into pathway selection and action customisation. |

### Existing Behaviour (For Reference)

The existing Process flow is a slide-over panel with three steps: Payment, Outcome, Done. Step 2 currently shows a simple list of outcome pathway options. Picking one calls `selectOutcomePathway()` (currently a console.log stub) and advances to Step 3.

This spec replaces Step 2's content with a richer flow: pathway selection followed by action customisation. The stub `selectOutcomePathway()` is replaced with real workflow instantiation logic.

### New Step 2: Pathway Selection

When the receptionist completes payment and advances to Step 2, they see a list of all active outcome pathways (`WHERE archived_at IS NULL`) at the organisation. The list uses the existing button-style selection UI from the current Process flow — reuse the component.

**Layout of the selection screen:**

- **Scrollable list of pathway buttons at the top.** Each button shows pathway name, one-line description, and action block count (from `workflow_action_blocks` joined via the pathway's `workflow_template_id`). Vertically stacked. Scrollable if the list exceeds the panel height.
- **"No outcome pathway required" button at the bottom.** Visually distinct from the pathway buttons (outline style, not filled). Clicking it skips action customisation entirely, advances directly to Step 3, sets `sessions.outcome_pathway_id = NULL`, and marks the session as Done with no actions scheduled.

**Behaviour when a pathway is picked:** The selection advances to Step 2b (action customisation). The selected pathway's action blocks load from `workflow_action_blocks` with their default timings and `config`.

### New Step 2b: Action Customisation

This is the critical moment for post-appointment. The receptionist has the clinician's instructions in their head ("chase in 2 days, skip the resources, send PROMs next month") and needs to translate them onto the scheduled actions.

**Layout:**

- **Header.** "Customise [Pathway name] for [Patient name]". Back link to return to pathway selection.
- **Timeline view.** The same vertical timeline from the pathway editor, but simpler. Each action block is a row with timing, action type icon, content summary, toggle, and "Edit" link.
- **Edit an action inline.** Clicking Edit on an action expands the row to show its fields (timing, SMS copy, task title/description, form selection for deliver_form blocks). The receptionist can change any field for this specific run. Edits are held in local state — nothing writes to the database until Confirm.
- **Toggle an action off.** The toggle disables the action for this run only. The row stays visible but greyed out. The receptionist can re-enable at any time before confirming. Actions with `config.default_enabled = false` start toggled off.
- **Summary footer.** "N actions will fire. Confirm to schedule them." Confirm button (teal primary). Back button (secondary).

**Confirmation.** Clicking Confirm triggers the following atomic write:

1. Set `sessions.session_ended_at = now()` and `sessions.outcome_pathway_id` to the selected pathway's ID. The `session_ended_at` timestamp becomes the anchor for all action scheduling (see Timing Convention above).
2. Create an `appointment_workflow_runs` row: `appointment_id` from the session's appointment, `workflow_template_id` from the pathway, `direction = 'post_appointment'`, `status = 'active'`.
3. For each enabled action block, create an `appointment_actions` row:
   - `appointment_id` from the session's appointment.
   - `session_id` from the current session.
   - `action_block_id` pointing to the original `workflow_action_blocks` row (for audit only — see Config Snapshot Discipline).
   - `workflow_run_id` pointing to the run created in step 2.
   - `status = 'scheduled'`.
   - `scheduled_for` = `sessions.session_ended_at` + customised `offset_minutes`. For day 0 actions (`offset_minutes = 0`): `session_ended_at + 1 minute`.
   - `config` JSONB carrying the full, resolved configuration snapshot — the complete config even for fields the receptionist did not customise. This is the source of truth for rendering.
   - `form_id` set directly on the row for `deliver_form` actions (not inside `config`), per the existing engine convention.
4. Set session status to `done`.

The panel advances to Step 3.

### Step 3: Done

Unchanged from the existing behaviour. Confirmation screen with check mark. Panel auto-closes after 2 seconds (single session) or advances to the next session (bulk process).

### Edge Cases

| **Scenario** | **Behaviour** |
| --- | --- |
| No pathways configured at all | Step 2 shows an empty state: "No outcome pathways configured. Contact your practice manager to set up pathways." "No outcome pathway required" button remains available. |
| Receptionist picks a pathway but then hits Back | Pathway selection is cleared. No actions scheduled until a pathway is picked and confirmed. |
| Receptionist disables every action before confirming | Confirm button becomes disabled: "Enable at least one action or select No outcome pathway required." |
| Session already has scheduled actions from a previous Process attempt | Should not happen in normal flow. If detected, warn and offer to overwrite (cancel existing `appointment_actions` and `appointment_workflow_runs`, then create new ones). |
| Session has no `session_ended_at` set | Cannot happen in normal flow — Process confirmation sets `session_ended_at = now()` atomically. If detected (e.g. data repair), use `now()` as the anchor for `scheduled_for` calculations. |

## Post-Appointment Readiness Tab

| **Route** | /readiness (Post-appointment tab) |
| --- | --- |
| **Purpose** | Surface scheduled and in-flight post-appointment actions to the receptionist. Resolve tasks. Monitor SMS and Form delivery. |
| **Users** | Receptionist, practice manager, clinic owner |
| **Structure** | Same layout as the Pre-appointment tab. Same urgency bands, same row pattern, same resolution model. The Post-appointment tab already exists as a placeholder in the current readiness dashboard. |

### Layout

The Post-appointment tab mirrors the Pre-appointment tab's structure. Same header, same filter row, same urgency band grouping, same row layout. The only differences are the filters available (tuned to post-appointment needs) and the row content (individual actions instead of intake package steps).

**Header:** "Readiness" title. Tab switcher (Pre-appointment / Post-appointment). Count badge on each tab.

**Filter row below the header.** Three filter dropdowns:

- **Action type.** All / SMS / Form / Task. Lets the receptionist focus on what they need to action (tasks) versus what's running on its own (SMS/Form). Maps to `appointment_actions` joined to `workflow_action_blocks.action_type`.
- **Pathway.** All / [list of pathways with active runs]. Filters by `outcome_pathways` joined via `sessions.outcome_pathway_id`.
- **Status.** All / Overdue / Due soon / Scheduled. Default to showing all.

**Urgency bands (same as pre-appointment):**

| **Band** | **Content** |
| --- | --- |
| Overdue | Task actions past their `scheduled_for` with no resolution. Form actions whose form hasn't been returned by the deadline. SMS actions that failed to send (`status = 'failed'`). |
| Due soon | Task actions whose `scheduled_for` is within the next 24 hours. Form actions with an upcoming return deadline. |
| Scheduled | Actions with a `scheduled_for` more than 24 hours in the future. |
| Recently completed | Actions resolved or completed (`status = 'completed'`) in the last 24 hours. Collapsed by default, expandable. |

### Data Query

The post-appointment readiness query joins through the existing tables:

```sql
SELECT aa.*, ab.action_type,
       s.id as session_id, s.session_ended_at,
       op.name as pathway_name,
       p.first_name, p.last_name,
       at.name as appointment_type_name,
       a.scheduled_at as appointment_time,
       u.full_name as clinician_name
FROM appointment_actions aa
JOIN workflow_action_blocks ab ON aa.action_block_id = ab.id
JOIN sessions s ON aa.session_id = s.id
JOIN outcome_pathways op ON s.outcome_pathway_id = op.id
JOIN session_participants sp ON sp.session_id = s.id
JOIN patients p ON sp.patient_id = p.id
LEFT JOIN appointments a ON s.appointment_id = a.id
LEFT JOIN appointment_types at ON a.appointment_type_id = at.id
LEFT JOIN staff_assignments sa ON a.clinician_id = sa.id
LEFT JOIN users u ON sa.user_id = u.id
WHERE aa.session_id IS NOT NULL
  AND s.location_id = :location_id
  AND aa.status IN ('scheduled', 'fired', 'completed', 'failed')
ORDER BY aa.scheduled_for ASC;
```

The query reads `action_type` from `workflow_action_blocks` (immutable enum, safe to join) but all content (SMS copy, task title, form reference) is read from `appointment_actions.config` per the config snapshot discipline. The `WHERE aa.session_id IS NOT NULL` clause distinguishes post-appointment actions from pre-appointment actions (which have `session_id = NULL`).

### Row Layout

Each row in the readiness dashboard represents a single `appointment_actions` row tied to a specific patient and session. Rows are grouped by patient when multiple actions exist for the same patient, visually reusing the Pre-appointment tab's grouping pattern.

**Row columns:**

- **Scheduled date.** "Fri, 18 Apr" or "Today" or relative. Monospace font. From `appointment_actions.scheduled_for`.
- **Patient name.** Bold. Below it, a muted line showing the originating appointment: "Initial consultation · Dr Smith · 15 Apr".
- **Pathway + action.** "Continue treatment → Chase-up call". Pathway name (`outcome_pathways.name`) in muted text, action title/description in primary. For SMS: first 40 characters of `config.message` + ellipsis if truncated. For Form: form name (from forms library via `form_id`). For Task: `config.task_title`.
- **Status pill.** Overdue / Due soon / Scheduled. Colour-coded.
- **Action button.** Varies by action type:
  - **Task:** "Resolve" button. Clicking opens a small dialog with an optional note field and a Confirm button.
  - **SMS:** "View" link (shows SMS copy and delivery status from `result` JSONB). No user action unless the SMS failed, in which case "Retry" appears.
  - **Form:** Matches pre-appointment form row behaviour. "View form" or "Resolve" once the form is returned.

**Expand chevron on the right of each row.** Expanding shows the full action detail: scheduled time, originating pathway, full SMS/task content, resolution history (`resolved_at`, `resolved_by`, `resolution_note`).

### Resolution Behaviour

**Task actions.** The Resolve button opens a dialog: "Resolve: [config.task_title]". Optional free-text note field ("What did you do?"). Confirm button. On confirm:
- `appointment_actions.status` → `'completed'`
- `appointment_actions.completed_at` → `now()`
- `appointment_actions.resolved_at` → `now()`
- `appointment_actions.resolved_by` → current user ID
- `appointment_actions.resolution_note` → note text (or NULL)
The task moves to Recently completed state, disappears from the active view after the 24-hour window.

**SMS actions.** Auto-resolve when the SMS successfully fires. The engine sets `status = 'sent'` on fire, then `status = 'completed'` on successful delivery confirmation. No receptionist action needed in the success case. If the SMS fails (patient phone disconnected, carrier bounce), the action moves to `status = 'failed'` and surfaces as Overdue. The receptionist can retry, edit, or cancel.

**Form actions.** Same lifecycle as pre-appointment form readiness items. States: Scheduled (`status = 'scheduled'`, not yet sent), Sent (`status = 'sent'`, patient received link), At risk (approaching deadline without completion), Overdue (past deadline), Form completed needs transcription (`status = 'transcribed'`, returned, needs receptionist action), Recently completed (`status = 'completed'`, resolved). The Form Completed Needs Transcription state is the one that requires the receptionist to open the form and action the responses.

### Notifications

Post-appointment readiness surfaces in the same background notification system as pre-appointment: tab title flashing when overdue items appear, favicon badge when the tab is backgrounded, browser push notifications if the user has granted permission. Notifications fire for new overdue items (not for scheduled items entering the due-soon band, which is informational).

## Engine Behaviour

The existing workflow engine picks up post-appointment work using the same dispatch pattern as pre-appointment. Post-appointment adds one scan: every N minutes (configurable, default 15), the engine queries `appointment_actions` where `status = 'scheduled' AND scheduled_for <= now() AND session_id IS NOT NULL`, fires each one, and updates status.

**Handler dispatch by action type:**

| **Action type** | **Fire behaviour** | **Status after fire** |
| --- | --- | --- |
| `send_sms` | Send SMS to patient's phone. Merge fields resolved from session/patient/clinician context. | `sent` (then `completed` on delivery confirmation, or `failed` on bounce) |
| `deliver_form` | Send SMS with form link. Create `form_assignments` row. | `sent` (then follows form lifecycle) |
| `task` | No external side effect. The scanner transitions the action's status from `scheduled` to `fired` at the scheduled time, which causes the action to surface on the post-appointment readiness dashboard's urgency bands. The status transition IS the firing. | `fired` (then `completed` when the receptionist resolves via the readiness dashboard) |

**Task actions require an explicit scanner transition.** Unlike SMS and Form actions, which have an external side effect (SMS sent to patient, form link delivered) that the scanner performs and then updates status based on the result, task actions have no external work. But the scanner must still update their status from `scheduled` to `fired` at the scheduled time. Without this transition, task actions would remain in `scheduled` status indefinitely and the readiness dashboard's "Due soon" and "Overdue" urgency bands would never activate them. The status transition is the entire purpose of the scan for task actions — the scanner's responsibility is to move the action into a state where the receptionist will see and resolve it.

Implementation detail: the scanner handles task actions in the same loop as SMS and Form actions, but the task handler is a no-op that only updates status. No retry logic, no external API calls, no failure path at fire time (tasks can fail at resolution time only, not at fire time).

**Workflow run completion:** When all `appointment_actions` for a given `appointment_workflow_runs` row reach terminal status (`completed`, `failed`, `cancelled`, `skipped`), the run's `status` transitions to `complete` and `completed_at` is set.

**Session cancellation cascade:** When a session is cancelled or deleted, all `appointment_actions` with that `session_id` and `status = 'scheduled'` are set to `status = 'cancelled'`. Already-fired actions are not affected.

### Status Transitions (`appointment_actions` for post-appointment)

- **Scheduled → Sent/Fired.** Engine picks up the action at its `scheduled_for` time. SMS and Form become `sent`. Task becomes `fired`.
- **Sent → Completed.** SMS: auto-completes on successful delivery. Form: completes when the form is returned and transcribed.
- **Fired → Completed.** Task: completes when the receptionist hits Resolve.
- **Sent → Failed.** SMS fails to deliver. Form delivery fails. Surfaces as Overdue on readiness.
- **Scheduled → Cancelled.** Session cancelled, or receptionist cancels the run before it fires.

## Edge Cases

| **Scenario** | **Behaviour** |
| --- | --- |
| Pathway deleted with active runs | `archived_at` set. Cannot be picked for new sessions. Existing `appointment_actions` continue with their frozen config until they complete naturally. |
| Practice manager edits a pathway with active runs | Mid-flight confirmation modal. Existing `appointment_actions` continue with original config. New runs from Process use the updated template. |
| Receptionist picks a pathway then closes the Process panel without confirming | No `appointment_actions` created. Session status does not advance to Done. Re-opening Process returns to payment step. |
| SMS fails to deliver | Action moves to `status = 'failed'`. Appears as Overdue on readiness with a "Retry" action. Receptionist can retry, edit, or cancel. |
| Form sent but patient never returns it | Action stays in `status = 'sent'`. Moves to Overdue once the form deadline passes. Receptionist can resend, cancel, or manually resolve with a note. |
| Receptionist resolves a task then realises it was wrong | No unresolve action in v1. The receptionist resolves the task again with a corrective note explaining the update. The original resolution is visible in the expand view (first `resolved_at` timestamp and note are preserved in `result` JSONB before overwrite). If unresolve becomes a real need, it can be added as an explicit button on recently-completed rows in a future iteration. |
| Action block has timing 0 (same day) | Action's `scheduled_for` is set to `session_ended_at + 1 minute`. Gives the engine a brief buffer before firing. |
| Session is cancelled | All `appointment_actions` with `session_id` and `status = 'scheduled'` are cancelled. |
| Patient has no phone number on file | SMS and form actions cannot fire. Action moves directly to `status = 'failed'` at `scheduled_for` time. Receptionist sees Overdue on readiness with context. |
| Practice manager creates a pathway with zero action blocks | Save button disabled. "Add at least one action to save the pathway." |
| On-demand session (no appointment_id) | `appointment_actions.appointment_id` is set to the session's appointment. On-demand sessions always have an appointment created at session spawn time, so this is always populated. |

## Accessibility

- **Keyboard navigation.** Tab through pathway list rows, timeline action blocks, Process flow selection buttons, readiness rows. Enter activates the primary action.
- **Focus management.** When the pathway editor slide-over opens, focus moves to the Pathway name input. When the Process flow advances to a new step, focus moves to the first interactive element.
- **Screen reader.** Action block cards use `role="article"` with aria-label describing the action type, timing, and content. Readiness urgency bands use `aria-live` for count updates. Timeline dots are `aria-hidden` (decorative); the timing text carries the semantic info.
- **Colour contrast.** Status pills (Overdue red, Due soon amber, Scheduled grey) meet WCAG AA against row backgrounds. Amber "in flight" text uses the same #BA7517 with dotted underline as the pre-appointment tab.
- **Time-sensitive actions.** Process flow never auto-advances. Every step requires an explicit user action.

## Decision Summary

| **Decision** | **Choice** | **Rationale** |
| --- | --- | --- |
| Table architecture | Extend existing tables, no parallel structure | One engine, one set of tables. `workflow_action_blocks` and `appointment_actions` serve both pre and post. Reduces surface area for bugs and maintenance. |
| Distinguish pre vs post actions | `appointment_actions.session_id IS NOT NULL` for post, `IS NULL` for pre | Clean partition without a direction column on `appointment_actions`. Post-appointment actions always have a session; pre-appointment actions never do. |
| Pathway table name | Keep `outcome_pathways` (not rename to `pathways`) | Existing code, store, and components all reference `outcome_pathways`. Renaming adds migration churn with no functional benefit. |
| Pathway → template link | `outcome_pathways.workflow_template_id` FK | Reuses existing column. One template per pathway, same as one template per appointment type for pre. |
| Action types for post-appointment | `send_sms`, `deliver_form`, `task` | First two reuse existing enum values. `task` is added as a new value. Minimal enum surface. |
| Task action resolution | `resolved_at`, `resolved_by`, `resolution_note` columns on `appointment_actions` | Extends the existing table rather than creating a separate resolution table. Columns are NULL for non-task actions (no storage overhead for pre-appointment). |
| Timing storage | `offset_minutes` (days × 1440), `offset_direction = 'after'` | Reuses existing columns. Editor shows days; database stores minutes for consistency with pre-appointment's minute-level offsets. |
| Per-action config | `config` JSONB on `workflow_action_blocks` | Reuses existing JSONB column. Type-specific fields (`message`, `task_title`, etc.) live in `config` rather than as dedicated columns. Uses the same `config.message` key as pre-appointment SMS, so the handler has one code path. |
| `default_enabled` location | Inside `config` JSONB | Not a dedicated column. Keeps the action block schema unchanged. |
| Process-time customisation persistence | Full resolved snapshot in `appointment_actions.config` JSONB | Each action run carries a full snapshot of its resolved config at instantiation, regardless of whether fields were customised. The action's `config` is the source of truth for rendering; `workflow_action_blocks.config` is only the default used at instantiation. |
| Pathway scope | Global at org level | Pathways are reusable across appointment types. Scoping to appointment type forces duplication. |
| Conditional chaining | Not in v1 | Opens huge complexity surface. `precondition` JSONB column exists on `workflow_action_blocks` for future use. |
| Timing granularity | Integer days, 0 to N | Days match clinical cadence. The underlying `offset_minutes` supports finer granularity if needed later. |
| No outcome pathway option | Explicit button at bottom of selection list | Not a silent skip. Forces the receptionist to make a deliberate choice. `sessions.outcome_pathway_id` stays NULL. |
| Post-appointment readiness | Tab on existing readiness dashboard. Same bands, same patterns as pre-appointment. | One dashboard, two temporal directions. Receptionists learn one interaction model. |
| Save RPC | New `configure_outcome_pathway()` function | Mirrors `configure_appointment_type()`. Atomic multi-table save. Same pattern, different shape. |

## Affected Files

### Schema

| **File** | **Change** |
| --- | --- |
| `supabase/migrations/016_post_appointment_workflows.sql` | New migration: add `task` to `action_type`, add `archived_at` to `outcome_pathways`, add `outcome_pathway_id` to `sessions`, add `session_id`/`resolved_at`/`resolved_by`/`resolution_note` to `appointment_actions`, new indexes, `configure_outcome_pathway()` RPC, RLS policies. |
| `supabase/seed.sql` | Replace three placeholder pathways with four seeded pathways, each with workflow templates and action blocks. |

**Migration note: `ALTER TYPE ADD VALUE` transaction constraint.** Postgres does not allow `ALTER TYPE ... ADD VALUE` inside a transaction block that also uses the new enum value. The `task` enum addition must land in a migration that does not also insert `task`-valued rows. Seed data that references `action_type = 'task'` belongs in `seed.sql`, which runs in a separate transaction after all migrations commit. Do not seed task-typed action blocks inside the migration file itself.

**Migration note: `session_ended_at` already exists.** The `sessions` table already has `session_ended_at TIMESTAMPTZ` from the initial schema (001). No column addition needed. The implementation must ensure the Process confirmation flow sets this column to `now()` as part of the atomic commit.

### Workflow Engine

| **File** | **Change** |
| --- | --- |
| `src/lib/workflows/types.ts` | Add `task` to action type metadata. Add post-appointment config shapes. |
| `src/lib/workflows/handlers.ts` | Add `task` handler (no-op fire, status → `fired`). Extend `send_sms` and `deliver_form` handlers to resolve merge fields from session context when `session_id` is present. |
| `src/lib/workflows/scanner.ts` | Add post-appointment scan: query `appointment_actions WHERE session_id IS NOT NULL AND status = 'scheduled' AND scheduled_for <= now()`. |

### Process Flow

| **File** | **Change** |
| --- | --- |
| `src/components/clinic/process-flow-outcome.tsx` | Replace simple pathway selection with Step 2 (selection) + Step 2b (customisation timeline). Load action blocks on pathway pick. Customisation state held locally until Confirm. |
| `src/lib/runsheet/actions.ts` | Replace `selectOutcomePathway()` stub with real implementation: create `appointment_workflow_runs`, create `appointment_actions` per enabled block, set `sessions.outcome_pathway_id`, transition session to `done`. |

### Workflows Page

| **File** | **Change** |
| --- | --- |
| `src/components/clinic/workflows-shell.tsx` | Replace "coming soon" placeholder with pathway list table and pathway editor slide-over. |

### Readiness Dashboard

| **File** | **Change** |
| --- | --- |
| `src/app/api/readiness/route.ts` | Add post-appointment query path (join through `appointment_actions.session_id`). Return post-appointment actions with pathway context. |
| `src/lib/readiness/derived-state.ts` | Add post-appointment priority derivation. Task: overdue when `scheduled_for` past and unresolved. SMS/Form: reuse pre-appointment form lifecycle. |
| `src/components/clinic/readiness-shell.tsx` | Add post-appointment row rendering (pathway + action label, task resolve button, SMS view link). Add filter dropdowns (action type, pathway, status). |

### Store

| **File** | **Change** |
| --- | --- |
| `src/stores/clinic-store.ts` | Extend `outcomePathways` type with `workflow_template_id`, `archived_at`. Add post-appointment readiness data slice. |

## What Comes Next

This spec completes the post-appointment layer of the workflow engine. Together with the pre-appointment spec, the full workflow engine surface is covered end-to-end — one engine, two directions, shared infrastructure.

Subsequent specs that build on this foundation:

- **Workflow analytics.** Practice manager insights into which pathways are used, which actions are frequently customised, which tasks are frequently resolved late. Future work.
- **Conditional action chains.** The `precondition` JSONB column on `workflow_action_blocks` is already in the schema. If the clinical case for conditionality emerges, add conditional triggers on top of the existing timeline model. Additive, not a rebuild.
- **Partner integrations.** Task actions like "Send referral" could evolve into structured integrations with external systems (radiology providers, referral networks). The `config` JSONB is extensible. For now these are free-text tasks resolved by the receptionist.

The foundation is set. Post-appointment is the closing half of the workflow engine, built on the same rails as pre-appointment.
