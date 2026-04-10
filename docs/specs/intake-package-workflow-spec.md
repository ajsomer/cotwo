# Spec: Intake Package Workflow Engine

**Status**: Draft v2 — revised
**Tier**: Complete only
**Date**: 2026-04-09
**Supersedes**: Workflow-Driven Appointment Types (v1)

---

## Overview

Pre-appointment workflows are built around a single unit of patient engagement: the **intake package**. Every Complete-tier appointment type is configured with an intake package that bundles everything the clinic needs from the patient (contact creation, card capture, forms, consent) into one journey behind one link with persistent progress.

The workflow engine's responsibility for pre-appointment is narrow: send the intake package, optionally nudge the patient with reminders if they haven't completed it, surface urgency signals on the readiness dashboard, and either hand off to the run sheet on appointment day (run-sheet workflows) or terminate when the package is complete (collection-only workflows).

This spec replaces the earlier granular action-block model (`deliver_form`, `capture_card`, `send_message`, etc. as separate pre-appointment actions) for pre-appointment workflows. Those action types are cut from the pre-appointment editor. Post-appointment workflows are out of scope for this spec and retain their existing action type model.

---

## Core Concepts

### The intake package

A single composed bundle per workflow template containing whatever the practice manager configures:

- **Create patient contact** (always included, always first). The patient verifies their phone and a contact record is created. This is what enables persistent progress across reminders.
- **Capture card on file** (optional).
- **Deliver form(s)** (optional, one or more).
- Additional patient-facing items as future action types warrant.

The patient sees the intake package as a single journey. They tap a link in an SMS, verify their phone, and work through the items. Progress is saved against the patient contact. Reminder SMS contain the same link. The patient can leave and resume from any reminder, picking up wherever they left off.

The intake package is **one action block** at the workflow engine level. Its internal composition (which items are included) is stored in the action block's config.

### Terminal type

Every pre-appointment workflow template has an explicit terminal type:

- **`run_sheet`**: the workflow ends by creating a session on the run sheet on the day of the appointment. The patient gets their join link at that point. Used for telehealth and in-person appointments.
- **`collection_only`**: the workflow terminates when the intake package is complete. No session, no run sheet row, no join link. Used for data-collection cases where the clinic needs information from a patient but isn't booking a session (e.g. specialist intake, referral collection, pre-booking triage).

This is a single field on the workflow template. It replaces the previous approach of inferring the workflow type by checking for the presence of an `add_to_runsheet` action block.

### Reminders

Up to **two reminder action blocks** per workflow template. Each reminder is configured with:

- An **offset in days** from the intake package send time.
- An **SMS message body**.
- An implicit precondition: fires only if the intake package is still incomplete at the scheduled time.

Reminders are standalone action blocks in `workflow_action_blocks` with a `parent_action_block_id` pointing to the intake package action block. They reuse the existing scanner, firing, and status infrastructure. The parent-child relationship exists so the editor can render them as indented under the intake package and so the firing logic can check the parent's completion status as the precondition.

**Hard cap of two reminders in v1.** The editor enforces this. Can be lifted later if a real customer need emerges.

### At-risk and overdue display states

At-risk and overdue are **display-only** states that appear on the readiness dashboard. They do not fire SMS. They control how an appointment is coloured and sorted on the dashboard so the receptionist can see which patients need chasing.

Two layers of logic determine the state:

**1. Configured layer.** The workflow template has two fields:
- `at_risk_after_days`: days after the intake package was sent, if the package is still incomplete.
- `overdue_after_days`: days after the intake package was sent, if the package is still incomplete.

Practice manager configures these. They apply to both `run_sheet` and `collection_only` workflows.

**2. Fallback layer (run-sheet workflows only).** Hardcoded system constants:
- If `appointment_time - now <= 2 days` and the package is incomplete: state is at least **at-risk**.
- If `appointment_time - now <= 1 day` and the package is incomplete: state is at least **overdue**.

These are not configurable. They guarantee that short-lead bookings with configured thresholds that don't fit the lead time still get flagged appropriately.

**The displayed state is the worst of the two layers.** A package can be flipped to at-risk by the configured threshold first; the fallback just guarantees it can't escape at-risk once within 2 days of the appointment.

Collection-only workflows have no appointment time, so only the configured layer applies.

---

## Schema Changes

### Migration: `013_intake_package_workflow.sql`

```sql
-- 1. Add new action types
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'intake_package';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'intake_reminder';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'add_to_runsheet';

-- 2. Terminal type on workflow_templates
CREATE TYPE workflow_terminal_type AS ENUM ('run_sheet', 'collection_only');
ALTER TABLE workflow_templates
  ADD COLUMN terminal_type workflow_terminal_type NOT NULL DEFAULT 'run_sheet';

-- 3. At-risk and overdue thresholds on workflow_templates
ALTER TABLE workflow_templates
  ADD COLUMN at_risk_after_days INTEGER,
  ADD COLUMN overdue_after_days INTEGER;
-- NULL means "no configured threshold; only fallback applies"

-- 4. Parent-child relationship on workflow_action_blocks
ALTER TABLE workflow_action_blocks
  ADD COLUMN parent_action_block_id UUID REFERENCES workflow_action_blocks(id) ON DELETE CASCADE;
CREATE INDEX idx_workflow_action_blocks_parent ON workflow_action_blocks(parent_action_block_id);

-- 5. Enforce at most one intake_package per template (at the DB level)
CREATE UNIQUE INDEX idx_one_intake_package_per_template
  ON workflow_action_blocks(template_id)
  WHERE action_type = 'intake_package' AND parent_action_block_id IS NULL;

-- 6. appointments.scheduled_at becomes nullable for collection_only workflows
ALTER TABLE appointments ALTER COLUMN scheduled_at DROP NOT NULL;
COMMENT ON COLUMN appointments.scheduled_at IS
  'NULL for appointments on collection_only workflows; required for run_sheet workflows (enforced in application code)';

-- 7. Intake package journey table
CREATE TABLE intake_package_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  journey_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress',
    -- 'in_progress' | 'completed'
  includes_card_capture BOOLEAN NOT NULL DEFAULT FALSE,
  includes_consent BOOLEAN NOT NULL DEFAULT FALSE,
  form_ids UUID[] NOT NULL DEFAULT '{}',
  card_captured_at TIMESTAMPTZ,
  consent_completed_at TIMESTAMPTZ,
  forms_completed JSONB NOT NULL DEFAULT '{}',
    -- { "form_uuid": "2026-04-09T12:00:00Z" }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

COMMENT ON COLUMN intake_package_journeys.patient_id IS
  'The verified patient identity — the person who tapped the link and was resolved '
  'via phone OTP. This is NOT a mirror of appointments.patient_id. It matters for '
  'multi-contact resolution: one phone number may map to multiple patients in the '
  'org, and this column captures who was actually selected at verification time.';

CREATE INDEX idx_intake_package_journeys_appointment ON intake_package_journeys(appointment_id);
CREATE INDEX idx_intake_package_journeys_token ON intake_package_journeys(journey_token);

-- 8. Add created_at index for collection-only appointment sorting
CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at);

-- 9. Intake package content configuration
-- Stored in workflow_action_blocks.config as JSON:
-- {
--   "includes_card_capture": true,
--   "form_ids": ["uuid1", "uuid2"],
--   "includes_consent": true
-- }
-- No separate table. The create_contact step is implicit and always included.
```

### What's explicitly NOT changed

- `send_session_link` stays in the `action_type` enum (can't cleanly remove enum values). Not exposed in the editor. Deprecated.
- Existing granular action types (`deliver_form`, `capture_card`, `send_message`, `send_reminder`, etc.) stay in the enum. Still usable for post-appointment workflows. Not exposed in the pre-appointment editor.

---

## Action Types

### `intake_package`

| Property | Value |
|---|---|
| Label | Intake Package |
| Direction | pre_appointment only |
| Fires | Immediately on workflow start (offset 0) |
| Parent action | None (top-level) |
| Config | `{ includes_card_capture, form_ids, includes_consent }` |
| Precondition | None (always fires) |

**Handler behaviour (`src/lib/workflows/handlers.ts`):**

1. Look up the workflow template's intake package config from the action block.
2. Generate a unique journey token (`crypto.randomUUID()`).
3. Create an `intake_package_journeys` row with the config fields (form_ids, includes_card_capture, includes_consent) and the journey token. `patient_id` is left NULL — populated after phone verification on first entry.
4. Send SMS to the patient's phone with the journey link: `${APP_URL}/intake/${token}`.
5. Return `{ status: 'sent', resultData: { journey_id, journey_token } }`.

The action is considered **complete** when all items in the package have been completed by the patient. Completion is tracked on the `intake_package_journeys` row. When a patient completes any item (form submission, card capture, consent), the API endpoint handling that submission checks whether all configured items are now done. If so, it flips the journey's `status` to `'completed'` and `completed_at` to `now()`, then updates the corresponding `appointment_actions` row for the intake package action to `status = 'completed'`. Application code, not a database trigger — easier to reason about and debug during development.

### `intake_reminder`

| Property | Value |
|---|---|
| Label | Intake Reminder |
| Direction | pre_appointment only |
| Fires | At configured offset (days) after parent `intake_package` was sent |
| Parent action | Required. Must point to an `intake_package` action block. |
| Config | `{ offset_days, message_body }` |
| Precondition | Parent `intake_package` action is NOT in `completed` status |

**Handler behaviour:**

This action type has its own handler (does not reuse `send_reminder`). The key difference is that `intake_reminder` needs to resolve the parent intake package's journey token and check completion status:

1. Fetch the parent `intake_package` action via `parent_action_block_id`. If the parent action's status is `completed`, mark this reminder as `skipped` and return.
2. Fetch the `intake_package_journeys` row for this appointment to get the journey token. **If no journey row exists** (e.g., the intake package action hasn't fired yet due to clock skew or manual `scheduled_for` manipulation), mark this reminder as `failed` with error message `"No intake package journey found for appointment — intake package may not have fired yet"` and return. Do not crash.
3. Send SMS to the patient's phone with the same journey link used by the parent: `${APP_URL}/intake/${journey_token}`. The SMS body comes from the reminder's `config.message_body`.
4. Return `{ status: 'sent' }`.

### `add_to_runsheet`

| Property | Value |
|---|---|
| Label | Add to Run Sheet |
| Direction | pre_appointment only |
| Fires | At `appointment_time` (offset 0 before `scheduled_at`) |
| Parent action | None |
| Config | `{}` |
| Precondition | None (always fires for `run_sheet` workflows) |

**This action is implicit, not user-configured.** When a workflow template with `terminal_type = 'run_sheet'` is saved, the engine ensures exactly one `add_to_runsheet` action block exists at the end. When the terminal is changed to `collection_only`, the `add_to_runsheet` block is removed. The practice manager never sees this action in the editor.

**Handler behaviour:**

1. Fetch the appointment with room, location, patient, phone number.
2. Validate `room_id` is present (required for run-sheet workflows).
3. Generate an `entry_token` (`crypto.randomUUID()`).
4. Create a `sessions` row: `appointment_id`, `room_id`, `location_id`, `status: 'queued'`, `entry_token`.
5. Create a `session_participants` row linking the session to the patient.
6. Send SMS to the patient with their session join link: `${APP_URL}/entry/${entry_token}`.
7. Return `{ status: 'sent', resultData: { session_id, entry_token } }`.

```typescript
case "add_to_runsheet": {
  const supabase = createServiceClient();

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, room_id, location_id, patient_id, phone_number")
    .eq("id", appointmentId)
    .single();

  if (!appointment) {
    return { status: "failed", error: "Appointment not found" };
  }

  if (!appointment.room_id) {
    return { status: "failed", error: "No room assigned to appointment" };
  }

  const entryToken = crypto.randomUUID();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      appointment_id: appointment.id,
      room_id: appointment.room_id,
      location_id: appointment.location_id,
      status: "queued",
      entry_token: entryToken,
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    return { status: "failed", error: `Failed to create session: ${sessionError?.message}` };
  }

  await supabase.from("session_participants").insert({
    session_id: session.id,
    patient_id: appointment.patient_id,
    role: "patient",
  });

  const sessionLink = `${process.env.NEXT_PUBLIC_APP_URL}/entry/${entryToken}`;
  console.log(
    `[WORKFLOW] add_to_runsheet: Session ${session.id} created. ` +
    `SMS to ${appointment.phone_number}: ${sessionLink}`
  );

  return {
    status: "sent",
    resultData: { session_id: session.id, entry_token: entryToken },
  };
}
```

---

## Patient Journey Storage

The intake package is a single patient-facing journey. The patient needs to be able to tap a link, verify, and land back on their in-progress package regardless of which SMS they tapped (initial or reminder).

### Table: `intake_package_journeys`

One journey per appointment. Created when the `intake_package` action fires. The `patient_id` column is the **verified** patient identity — the person who tapped the link and was resolved via phone OTP. This is distinct from `appointments.patient_id` (which is set by the receptionist at add-patient time). The distinction matters for multi-contact resolution: one phone number may map to multiple patients in the org, and the journey's `patient_id` captures who was actually selected at verification time.

The `status` flips to `'completed'` when every configured item is complete (card captured if required, consent signed if required, all forms submitted). This is checked and updated by application code in the API endpoints that handle each item's completion, not by a database trigger.

---

## Runtime Behaviour

### Workflow instantiation (`scheduleWorkflowForAppointment`)

Triggered by:
- PMS webhook for integrated Complete (new appointment)
- Incremental PMS poll (for PMS platforms without webhooks)
- Manual entry via the add-patient panel (non-integrated Complete)

Steps:
1. Look up the workflow template for the appointment's type.
2. Create a `workflow_run` row.
3. Fetch the action blocks for the template: one `intake_package`, up to two `intake_reminder` children, and (for `run_sheet` workflows) one `add_to_runsheet`.
4. Compute `scheduled_for` for each action:
   - **Intake package:** `now` (fires immediately).
   - **Reminders:** `(intake_package.scheduled_for) + (offset_days * 24h)`. Reminder `scheduled_for` is computed from the parent intake_package action's `scheduled_for`, not its `fired_at`. Reminder timing is deterministic at workflow instantiation. Engine lag on package send does not cascade to downstream reminders.
   - **Add to runsheet** (run_sheet workflows only): `appointment.scheduled_at` (offset 0).
5. **Drop any action whose `scheduled_for` falls after `appointment.scheduled_at`** (for run_sheet workflows). Mark them as `dropped` with a reason. Reminders are the common case here. `add_to_runsheet` is never dropped.
6. Insert scheduled action rows into `appointment_actions` with `status = 'scheduled'`.

The intake package is always scheduled. Reminders may be dropped for short-lead bookings. The engine does not compress reminder offsets — it simply drops ones that don't fit.

### Template edit immutability

**Template edits do not retroactively mutate in-flight workflow runs.** If the practice manager changes the `terminal_type` from `run_sheet` to `collection_only` after workflows have been instantiated, the existing runs keep their original `add_to_runsheet` action. Same for reminder edits — adding, removing, or changing reminder offsets on the template does not affect already-scheduled `appointment_actions` rows. Standard workflow engine semantics: the template is a blueprint; runs are snapshots of that blueprint at instantiation time.

### PMS detection cadence

- **Webhooks** (preferred): PMS pushes an event to Coviu when an appointment is created/updated. Coviu immediately runs `scheduleWorkflowForAppointment`. Near-zero latency.
- **Incremental polling** (fallback): for PMS platforms without webhook support, Coviu polls every 5–10 minutes using a cursor on `created_at` or `updated_at`. Good enough for day-granular workflows.
- **Immediate trigger** (manual entry): when the receptionist creates an appointment directly in Coviu, the workflow instantiates synchronously.
- **Daily reconciliation scan** (safety net): runs once per day, catches any appointments the real-time path missed.

**No 30-second polling anywhere.** Action firing runs on its own cadence (every few minutes) separate from appointment detection.

### Readiness dashboard priority derivation

For each appointment on the readiness dashboard, priority is derived from the state of its intake package journey plus the workflow template's configured and fallback thresholds.

```typescript
/**
 * Compute the worst-of priority across two layers:
 * 1. Configured layer: practice manager's at_risk_after_days / overdue_after_days thresholds.
 * 2. Fallback layer (run-sheet only): hardcoded appointment-proximity thresholds.
 *
 * The fallback can only elevate state (at-risk → overdue, in-progress → at-risk),
 * never suppress it. Configured state is computed first, then the fallback
 * elevates if the appointment is close enough.
 */
function getReadinessPriority(
  appointment: Appointment,
  journey: IntakePackageJourney,
  template: WorkflowTemplate,
  now: Date
): Priority {
  if (journey.status === 'completed') {
    return 'recently_completed';  // within retention window
  }

  // Step 1: compute configured state
  const configured = getConfiguredState(journey, template, now);

  // Step 2: compute fallback state (run-sheet workflows only)
  let fallback: Priority = 'in_progress';
  if (template.terminal_type === 'run_sheet' && appointment.scheduled_at) {
    const msToAppointment = new Date(appointment.scheduled_at).getTime() - now.getTime();
    const daysToAppointment = msToAppointment / (24 * 60 * 60 * 1000);

    if (daysToAppointment <= 1) {
      fallback = 'overdue';
    } else if (daysToAppointment <= 2) {
      fallback = 'at_risk';
    }
  }

  // Step 3: return the worst of the two (overdue > at_risk > in_progress)
  return worst(configured, fallback);
}

const PRIORITY_SEVERITY: Record<Priority, number> = {
  overdue: 3,
  at_risk: 2,
  in_progress: 1,
  recently_completed: 0,
};

function worst(a: Priority, b: Priority): Priority {
  return PRIORITY_SEVERITY[a] >= PRIORITY_SEVERITY[b] ? a : b;
}

function getConfiguredState(
  journey: IntakePackageJourney,
  template: WorkflowTemplate,
  now: Date
): Priority {
  const sentAt = new Date(journey.created_at);
  const ageMs = now.getTime() - sentAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (template.overdue_after_days != null && ageDays >= template.overdue_after_days) {
    return 'overdue';
  }
  if (template.at_risk_after_days != null && ageDays >= template.at_risk_after_days) {
    return 'at_risk';
  }
  return 'in_progress';
}
```

**Anchor for configured thresholds:** `getConfiguredState` uses `journey.created_at` as the anchor, not the intake package action's `scheduled_for`. These differ by the engine scan interval (typically a few minutes): the action is scheduled at T, but the journey row is created when the action fires at T+Δ. This drift is acceptable at day-granularity thresholds and is intentional — the journey row is the easier join target for the readiness API, avoiding an extra hop through `appointment_actions`. This is a different decision from reminder scheduling, where `scheduled_for` is used because reminders are computed at instantiation time and must be deterministic.

**Key properties:**
- Configured state is computed first; fallback can only elevate, never suppress.
- No per-action-block timer inspection. Priority derives from the journey's creation time (anchor), the template's thresholds, and the appointment time (for the fallback).
- No hardcoded 3-day/5-day constants outside the fallback layer. Those fallback constants (1 and 2 days) are intentional system defaults and live in one place.
- Display states are always "worst of configured and fallback" for run-sheet workflows.
- Collection-only workflows use only the configured layer. `appointment.scheduled_at` is NULL so the fallback produces `in_progress`.

### Readiness dashboard sorting

Within each priority bucket, sort by:

- **overdue:** oldest journey first (longest-outstanding package).
- **at_risk:** for run-sheet workflows, soonest appointment first. For collection-only, oldest journey first.
- **in_progress:** alphabetical by patient last name.
- **recently_completed:** most recently completed first.

---

## Editor Changes

### Workflow template editor — pre-appointment tab

The pre-appointment editor is substantially simplified. The practice manager no longer builds a timeline of granular action blocks. They configure four sections:

**1. Terminal type**

A single toggle at the top of the template:
- **Run sheet appointment** (default) — this workflow ends in a telehealth or in-person session.
- **Collection only** — this workflow collects information and terminates; no session created.

Changing this setting adds or removes the implicit `add_to_runsheet` action block.

**2. Intake package contents**

A checklist of items to include in the package:
- **Create patient contact** — locked, always included, always first. Labelled as "Required" with explanation text.
- **Capture card on file** — toggle.
- **Consent** — toggle.
- **Forms** — multi-select from the clinic's form library. Order of selection = order presented to the patient.

Stored in the `intake_package` action block's config JSON.

**3. Reminders**

Up to two reminder rows. Each row has:
- **Offset** — "Send X days after the intake package is sent." Numeric input.
- **SMS message** — textarea. Default copy provided, editable.
- **Remove** button.

An "Add reminder" button below the list. Disabled when two reminders exist.

Creates child `intake_reminder` action blocks with `parent_action_block_id` pointing to the intake package block.

**4. Dashboard urgency**

Two fields:
- **Mark as at-risk:** numeric days after intake package sent, if still incomplete.
- **Mark as overdue:** numeric days after intake package sent, if still incomplete.

Optional — both can be left blank. If blank, only the fallback layer applies (for run-sheet workflows).

Below these fields, a note box:

> For run-sheet appointments, Coviu will always mark the package as at-risk when the appointment is 2 days away and overdue when 1 day away, regardless of the thresholds above. This guarantees short-lead bookings are surfaced appropriately.

### Editor validation

- `overdue_after_days` must be greater than `at_risk_after_days` if both are set.
- Reminder offsets must be unique (can't have two reminders on day 3).
- For run-sheet templates, the editor shows a warning if a configured threshold or reminder offset is larger than common lead times — e.g., "This 7-day at-risk threshold won't fire for appointments booked less than 7 days in advance. The system fallback will still apply for run-sheet workflows." Warning, not error.

### Editor preview (optional, nice-to-have for v1)

A collapsible "Preview for different lead times" section below the editor. Shows a table:

| Lead time | Package sent | Reminder 1 | Reminder 2 | At-risk | Overdue | Run sheet |
|---|---|---|---|---|---|---|
| 14 days | Day 0 | Day 3 | Day 5 | Day 4 | Day 6 | Day 14 |
| 7 days | Day 0 | Day 3 | Day 5 | Day 4 | Day 6 | Day 7 |
| 3 days | Day 0 | Day 3 | *dropped* | Day 1 (fallback) | Day 2 (fallback) | Day 3 |
| 1 day | Day 0 | *dropped* | *dropped* | Day 0 (fallback) | Day 0 (fallback) | Day 1 |

Lets the practice manager see how their template behaves across lead times without needing to create test appointments.

---

## Add Patient Panel Changes

**File:** `src/components/clinic/add-patient-panel.tsx`

### Dynamic form based on terminal type

When the user selects an appointment type, the panel reads the workflow template's `terminal_type` field directly (no helper function — the field is explicit on the template).

**Always shown:**
- First name, last name, DOB, mobile, appointment type.

**Run-sheet types only (conditionally shown):**
- Room, appointment date, appointment time.

### API changes

**`POST /api/readiness/add-patient`**

Request body:

```typescript
{
  first_name: string;
  last_name: string;
  dob: string;
  mobile: string;
  appointment_type_id: string;
  org_id: string;
  location_id: string;
  confirm_existing?: boolean;
  // Required only when the workflow template's terminal_type is 'run_sheet':
  room_id?: string;
  scheduled_at?: string;
}
```

Validation:

```typescript
const template = await getWorkflowTemplateForAppointmentType(appointment_type_id, supabase);
if (template.terminal_type === 'run_sheet') {
  if (!room_id || !scheduled_at) {
    return NextResponse.json(
      { error: "Room and appointment time are required for this appointment type" },
      { status: 400 }
    );
  }
}
```

Appointment creation:

```typescript
const { data: appointment } = await supabase
  .from("appointments")
  .insert({
    org_id,
    location_id,
    patient_id: patientId,
    appointment_type_id,
    room_id: room_id ?? null,
    scheduled_at: scheduled_at ?? null,
    clinician_id: null,
    phone_number: normalised,
    status: "scheduled",
  })
  .select("id")
  .single();

await scheduleWorkflowForAppointment(appointment.id, supabase);
```

---

## Readiness Dashboard Changes

**File:** `src/components/clinic/readiness-shell.tsx`

### Appointment time column

- **Run-sheet workflows:** show appointment date/time as today.
- **Collection-only workflows:** show "—" (em dash).

### Package status column (new)

Each row shows a progress indicator for the intake package: "3 of 5 items complete" or "Not started" or "Complete."

### Sorting

Collection-only and run-sheet appointments share a single list, sorted by priority bucket as described in the priority derivation section above.

---

## Readiness API Query Path Changes

**File:** `src/app/api/readiness/route.ts`

### Remove legacy date-filtered fallback

The current readiness API has two query paths:
1. **Primary:** query `appointment_workflow_runs` by direction and status, then fetch appointments by ID.
2. **Legacy fallback:** when no workflow runs exist, query `form_assignments` directly and join to appointments filtered by date.

The legacy fallback must be **removed entirely**. Collection-only appointments have no `scheduled_at`, so any date-scoped query would exclude them. The workflow-run-based query is the correct primary path — all readiness dashboard appointments flow through it.

### Update type for nullable `scheduled_at`

The `GroupedAppointment` type in the readiness API currently types `scheduled_at` as `string`. Change to `string | null`.

The `ReadinessAppointment` interface in `src/stores/clinic-store.ts` (line 74) also types `scheduled_at` as `string`. Change to `string | null`.

### Enrich with intake package journey

The readiness API's enrichment phase (the parallel `Promise.all` for patients, clinicians, phones, forms, rooms, types) needs an additional fetch:

```typescript
// Fetch intake package journeys for these appointments
const { data: journeys } = await supabase
  .from("intake_package_journeys")
  .select("appointment_id, status, form_ids, forms_completed, includes_card_capture, card_captured_at, includes_consent, consent_completed_at, created_at, completed_at")
  .in("appointment_id", locationApptIds);
```

The journey data is used to:
- Compute package progress for the new status column
- Derive priority using the journey-based logic (replacing per-action-block inspection)

### Fetch workflow template thresholds

The priority derivation now reads `at_risk_after_days`, `overdue_after_days`, and `terminal_type` from the workflow template. The API needs to join through `appointment_workflow_runs` → `workflow_templates` to get these:

```typescript
const templateIds = [...new Set((runs ?? []).map((r) => r.workflow_template_id))];
const { data: templates } = await supabase
  .from("workflow_templates")
  .select("id, terminal_type, at_risk_after_days, overdue_after_days")
  .in("id", templateIds);
```

---

## `scheduled_at` Nullable: Consumer Audit

Making `appointments.scheduled_at` nullable affects the following consumers. Each must handle `null`:

| File | Line(s) | Current assumption | Required change |
|------|---------|-------------------|-----------------|
| `src/stores/clinic-store.ts` | 74 | `scheduled_at: string` | Change to `string \| null` |
| `src/lib/readiness/derived-state.ts` | 81, 108, 230 | `new Date(appointment.scheduled_at)` called unconditionally | Guard with null check; skip appointment-proximity logic when null (use configured layer only) |
| `src/components/clinic/readiness-shell.tsx` | 572 | `formatDateTime(appointment.scheduled_at)` | Show "—" when null |
| `src/app/api/readiness/route.ts` | 136, 186 | `scheduled_at: string` in GroupedAppointment type | Change to `string \| null` |
| `src/app/api/readiness/add-patient/route.ts` | 32 | Requires `scheduled_at` in validation | Make conditional on terminal_type |
| `src/lib/workflows/scanner.ts` | 73–81 | `new Date(scheduledAt).getTime()` | Handle null anchor (use `Date.now()`) |
| `src/lib/workflows/engine.ts` | 66 | Fetches `scheduled_at` — used by handlers | Pass through as nullable; handlers that need it (e.g. `add_to_runsheet` timing) already have it from `appointment_actions.scheduled_for` |
| `src/app/api/readiness/route.ts` | 271–344 | Legacy fallback queries appointments by date | **Remove entirely** |
| `src/lib/supabase/types.ts` | 197, 212 | Generated types — `scheduled_at: string` | Will update automatically when types are regenerated after migration |

**Not affected** (already handle nullable or operate on sessions, not appointments):
- `src/lib/runsheet/*` — operates on sessions which always have `scheduled_at`
- `src/components/clinic/session-row.tsx` — reads session `scheduled_at`
- `src/app/(patient)/*` — reads via left join, already handles null
- `src/components/clinic/patient-contact-card.tsx` — already guards with `appointment.scheduled_at &&`
- `src/app/api/forms/assignments/route.ts` — already uses `?? null`

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/013_intake_package_workflow.sql` | New migration: enum additions, `terminal_type` + threshold columns on templates, `parent_action_block_id` + unique index on action blocks, nullable `scheduled_at`, new `intake_package_journeys` table with patient_id column comment |
| `src/lib/workflows/types.ts` | Add `intake_package`, `intake_reminder`, `add_to_runsheet` to `ACTION_TYPE_META`. Mark `deliver_form`, `capture_card`, etc. as post-appointment only in the pre-appointment editor. |
| `src/lib/workflows/handlers.ts` | Add handlers for the three new action types. `intake_reminder` gets its own handler (resolves parent journey token, checks completion). |
| `src/lib/workflows/scanner.ts` | Reminder `scheduled_for` computed from parent intake_package's `scheduled_for` (not `fired_at`). Drop actions whose `scheduled_for` is after `appointment.scheduled_at` for run-sheet workflows. Handle null `scheduled_at` (anchor to `Date.now()`). |
| `src/lib/readiness/derived-state.ts` | Replace per-action-block priority derivation with journey-based + configured/fallback two-layer system. Guard all `scheduled_at` access with null checks. |
| `src/stores/clinic-store.ts` | Change `ReadinessAppointment.scheduled_at` type to `string \| null`. |
| `src/components/clinic/add-patient-panel.tsx` | Read `terminal_type` from workflow template. Dynamic form fields (hide room/date/time for collection-only). |
| `src/app/api/readiness/add-patient/route.ts` | Conditional validation based on `terminal_type`. Make `room_id`/`scheduled_at` optional. |
| `src/app/api/readiness/route.ts` | **Remove legacy date-filtered fallback entirely.** Enrich with `intake_package_journeys`. Fetch workflow template thresholds. Update `GroupedAppointment.scheduled_at` to `string \| null`. |
| `src/components/clinic/readiness-shell.tsx` | Package status column. Show "—" for null `scheduled_at`. |
| `src/lib/workflows/engine.ts` | Pass `scheduled_at` as nullable through to handlers. |
| Workflow editor components | Rebuild pre-appointment editor around the four-section model (terminal, package contents, reminders, dashboard urgency). Remove granular action block editing from pre-appointment tab. |
| `src/app/intake/[token]/page.tsx` | **NEW.** Patient-facing intake package journey page. Phone verification on entry, then progressive display of package items (create contact → card capture → consent → forms). Progress saved to `intake_package_journeys`. Completion detection in application code. |

---

## Out of Scope

- **Core tier**: unchanged. One-shot SMS at run sheet save. No workflow engine.
- **Post-appointment workflows**: unchanged. Keep the existing granular action type model. A separate spec will cover whether post-appointment should also migrate to a package model.
- **Staggered package contents**: everything in the package is visible to the patient on first entry. No "reveal section 2 three days after section 1." If a clinic needs genuinely staggered collection, they configure a second appointment type with its own workflow.
- **More than two reminders**: hard cap of two in v1. Can be lifted later.
- **Per-item thresholds**: the package has one set of thresholds (or none). Individual items inside the package don't carry their own at-risk/overdue state.
- **SMS-firing at-risk/overdue states**: display-only. Reminders are the only SMS firing mechanism.
- **PMS integration itself**: this spec assumes the integration exists and delivers appointments into Coviu via webhooks or polling. Actual adapter work is out of scope.
- **Removing deprecated enum values**: `send_session_link`, `deliver_form`, `capture_card`, etc. stay in the enum. They are not exposed in the pre-appointment editor.
- **Dropped reminder surfacing on the dashboard**: the receptionist cares about package completion and urgency state, not whether specific reminders were dropped. The editor preview table covers lead-time visibility.

---

## Decision Summary

| Decision | Choice | Rationale |
|---|---|---|
| Pre-appointment action model | Single `intake_package` action + up to 2 `intake_reminder` children + implicit `add_to_runsheet` | Matches how practice managers think (what do I need?) not how engineers think (when should things fire?). Eliminates scatter-shot SMS. |
| Terminal type | Explicit field on workflow template | Removes runtime inspection. Editor and scanner read one field. |
| Anchor for reminder timing | Intake package action's `scheduled_for` (at instantiation, not `fired_at`) | Deterministic at workflow instantiation. Engine lag on package send does not cascade to downstream reminders. |
| Anchor for priority thresholds | Journey's `created_at` (at action fire time, not `scheduled_for`) | Easier join target for readiness API. Drifts by engine scan interval (minutes) from `scheduled_for` — acceptable at day granularity. Intentionally different from reminder anchor. |
| Appointment time constraint | `add_to_runsheet` locked to appointment_time; reminders dropped if scheduled past appointment | No compression or scaling. Simple rule: doesn't fit, doesn't fire. |
| At-risk/overdue logic | Worst-of merge: configured (practice manager) + fallback (system, run-sheet only). Configured computed first, fallback can only elevate. | Practice manager configures happy path. System guarantees short-lead bookings still surface. Fallback never suppresses configured state. |
| Fallback thresholds | 2 days = at-risk, 1 day = overdue. Hardcoded, not configurable. | Opinionated defaults. Can be promoted to configurable later if needed. |
| `intake_reminder` missing journey | Fail with clear error, don't crash | Defensive: if the intake package hasn't fired yet (clock skew, manual manipulation), the reminder handler fails gracefully instead of throwing. |
| Reminder cap | 2 max in v1 | Forces opinionated defaults. Editor stays simple. Patients don't get spammed. |
| Storage for reminders | Child action blocks with `parent_action_block_id` FK | Reuses all existing firing, status, and SMS infrastructure. Clean parent-child model. |
| Storage for at-risk/overdue | Derived at read time, not stored as action blocks | These are display states, not actions. No SMS to fire. No rows needed. |
| Patient journey storage | New `intake_package_journeys` table, one per appointment | Persistent progress across reminders. Token-based access. Clean join from appointment to journey. |
| Journey `patient_id` | Verified identity (OTP-resolved), not a mirror of `appointments.patient_id` | Matters for multi-contact resolution. Populated on first entry, not at creation. |
| Intake package completion detection | Application code in API endpoints, not a database trigger | Easier to reason about and debug during development. Each item-completion endpoint checks "all done?" and flips status. |
| `intake_reminder` handler | Own handler, does not reuse `send_reminder` | Needs to resolve parent's journey token and check completion status. Different enough to warrant separation. Actual SMS-send call is shared. |
| `add_to_runsheet` in editor | Hidden. Terminal type toggle communicates it. | No locked ghost row adding visual noise. |
| Template edit immutability | Template edits do not retroactively mutate in-flight workflow runs | Existing runs keep their original actions (including `add_to_runsheet`, reminders). The template is a blueprint; runs are snapshots at instantiation time. Standard workflow engine semantics. |
| PMS detection | Webhooks where available, 5–10 min incremental polling otherwise, daily scan as safety net | No 30-second polling. Appropriate cadence for day-granular workflows. |
| Granular action types in pre-appointment editor | Removed | They were the source of the scatter-shot problem. Kept in enum for post-appointment. |
| `scheduled_at` nullable | Yes, for collection-only | Run-sheet workflows still require it (application-level). |
| Legacy readiness fallback | Removed entirely | Date-filtered query excludes collection-only appointments. Workflow-run-based query is the correct primary path. |
| Dropped reminder dashboard surfacing | Skipped | Receptionist cares about package completion and urgency, not internal scheduling details. Editor preview covers lead-time visibility. |
| Form library dependency | Flagged, not a blocker | Existing forms page can power a multi-select picker. Main gap is a lightweight component for the editor. |

---

## Open Questions (Resolved)

1. **Intake package completion detection:** Application code in API endpoints, not a database trigger. Each item-completion endpoint checks all items and flips status. ✅
2. **Reminder reuse of existing SMS infrastructure:** `intake_reminder` gets its own handler that resolves the parent's journey token. Actual SMS-send call is shared infrastructure. ✅
3. **Editor rendering of `add_to_runsheet`:** Hidden. Terminal type toggle communicates it. ✅
4. **Form library integration:** Flagged as dependency. Existing forms page can power a multi-select picker. Not a blocker for this spec. ✅
