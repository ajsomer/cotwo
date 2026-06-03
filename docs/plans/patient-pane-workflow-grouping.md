# Patient Pane — Workflow Grouping

## Goal

Add a **Workflows** section to the patient slide-over pane, sitting directly
beneath the **Appointments** section. A "workflow" is one **workflow run**
(`appointment_workflow_runs`) — i.e. the bundle of things sent to the patient
for one appointment's pre- or post-appointment sequence (verify-phone SMS,
device-test prompt, the "join your appointment" link SMS, follow-up PROMs, etc.).

Each run renders as a **collapsible block** (chevron) using the existing
`CollapsibleSection` primitive:

- **Header:** workflow template name + appointment date — e.g.
  `New Patient Intake · 12 Jun`. Collapsed summary shows a count
  (e.g. `3 sent`).
- **Body (expanded):** the run's actions, rendered as the existing timeline
  rows (icon, label, status badge, fired-at, error).
- **Default state:** all collapsed **except** the run tied to the currently
  active appointment (the one the pane was opened from), which starts expanded.

This mirrors across both pane call sites — runsheet (`runsheet-shell.tsx`) and
tasks/readiness (`readiness-shell.tsx`) — because both render the **same**
`PatientContactCard`. No per-call-site work is needed beyond the shared change.

**Tasks dashboard pre/post filter: out of scope for this pass** (decided —
"just patient pane for now").

## Data verdict: NO migration required

The schema already supports run-grouping:

```
appointment_actions.workflow_run_id
  → appointment_workflow_runs (workflow_template_id, direction, started_at)
    → workflow_templates (name, direction)
```

The only gap is in the **API/fetcher layer**:
1. The fetcher (`fetchAppointmentWorkflowActions`) does not surface
   `workflow_run_id`, template name, or direction on each action.
2. Actions are fetched for the **single active appointment only**. To show
   blocks across all of a patient's appointments, the pane needs actions for
   **all** the patient's appointments.

## Changes

### 1. Fetcher — surface run grouping + go patient-wide (bounded)
`src/lib/clinic/fetchers/workflow-actions.ts`

- Add to the SELECT + mapped output: `workflow_run_id`,
  `workflow_template_name`, `workflow_direction`, `run_started_at`,
  `run_appointment_id`, and `run_appointment_scheduled_at` (the appointment's
  `scheduled_at`, used for the block header date — NOT `run_started_at`).
- **LEFT JOIN** `appointment_actions → appointment_workflow_runs (on
  workflow_run_id) → workflow_templates`. Left join so orphan/no-run actions
  survive and fall into the "Other messages" fallback block.
- Add `fetchPatientWorkflowActions(patientId)` returning actions across the
  patient's **bounded recent appointment window** — not all history. Reuse the
  same candidate windowing the appointments timeline uses (recent past +
  upcoming + active, capped via FUTURE_LIMIT/PAST_LIMIT), so the summary fast
  path stays fast. Concretely: select the patient's candidate appointment ids
  first, then fetch actions `inArray(appointment_id, candidateIds)`. Reuse the
  existing block/label/form-name/pathway enrichment. Keep the existing
  per-appointment fetcher.
- Within each run, order actions by `scheduled_for` ASC with `action_id` as a
  stable tiebreak.

### 2. Type — extend `WorkflowAction`
`src/stores/clinic/types.ts`

- Add, all as **optional** (`?:`) so existing producers (e.g. the readiness
  fetcher) compile unchanged:
  `workflow_run_id?`, `workflow_template_name?`, `workflow_direction?`,
  `run_appointment_id?`, `run_started_at?`, `run_appointment_scheduled_at?`.

### 3. API — return patient-wide (bounded) actions
`src/app/api/patient/[id]/summary/route.ts`

- Replace the single-appointment `fetchAppointmentWorkflowActions(activeApptId)`
  call with `fetchPatientWorkflowActions(patientId)`. Fire it
  **unconditionally** (not gated on `appointment_id`) so it lands in every mode
  including readiness. Keep the response key `workflow_actions` (flat array) —
  grouping is client-side. Access check unchanged.

### 4. New component — `WorkflowsSection`
`src/components/clinic/patient/patient-contact-card/workflows-section.tsx`

- Takes the flat `WorkflowAction[]` + the active appointment id.
- Groups by `workflow_run_id` (fallback: actions with no run id grouped under a
  synthetic "Other messages" block per appointment, so legacy/orphan actions
  still show).
- Sorts runs: active-appointment run first, then by `run_started_at` desc.
- Renders one `CollapsibleSection` per run:
  - `title` = `workflow_template_name` (fallback "Messages"), header date from
    `run_appointment_scheduled_at` → `New Patient Intake · 12 Jun`.
  - collapsed `summary` = status rollup, e.g. `3 sent · 1 pending`.
  - `children` = the per-run action rows. **Extract the existing timeline-row
    JSX** from `WorkflowTimeline` (forms-section.tsx) into a shared
    `WorkflowActionRow` so both the new section and the old one share markup.
- **Expansion state lives in an effect, not a `useState` initializer** (the
  pane stays mounted while actions arrive late on the summary fetch). Seed/reset
  a `Set<runId>` in a `useEffect` keyed on patient id + the sorted run-id list +
  `activeAppointmentId`. **Every run whose `run_appointment_id ===
  activeAppointmentId` starts expanded** (so both the pre and post run of the
  active appointment open); all others collapsed. User toggles persist until the
  key changes.
- Renders nothing if there are no actions.

### 5. Wire into the pane
`src/components/clinic/patient/patient-contact-card/index.tsx`

- **Change the action source** at index.tsx:~313 from
  `appointment?.actions ?? fetchedWorkflowActions ?? []` to
  `fetchedWorkflowActions ?? appointment?.actions ?? []` — the patient-wide
  summary payload wins once loaded; readiness `appointment.actions` is only the
  instant fallback before the fetch lands. (Note: readiness fallback actions
  lack run metadata, so they render under "Other messages" until the fetch
  replaces them — acceptable for the sub-second gap.)
- Insert `<WorkflowsSection actions={workflowActions} activeAppointmentId={…} />`
  immediately after `<AppointmentsSection … />`, replacing the current
  `<WorkflowTimeline actions={workflowActions} />`.
- The current `WorkflowTimeline` (post-appointment "Follow-up" only) is
  **superseded** by the grouped section. Remove the standalone render here
  (keep the extracted `WorkflowActionRow`).

### 6. Mirroring — no extra work
Both runsheet and readiness/tasks render the same `PatientContactCard`, so the
new section appears in both automatically. Verify both visually.

## Pre-appointment actions — explicitly INCLUDED
The current `WorkflowTimeline` filters out pre-appointment actions
(`session_id === null`) because they were noise **in the readiness row
context**. The patient pane is the detail view, so the new `WorkflowsSection`
shows them in full: pre-appointment SMS (verify, "join your appointment" link,
reminders, device test, card capture, form delivery) AND post-appointment
follow-up. Scheduled/pending (not-yet-fired) actions are shown too, with their
status badge, for forward visibility.

The readiness **row's** top-line status summary is left untouched — the split
is: row = summary, pane = full detail.

## Naming + Actions/Messages split (added after review)
- **Block header name** uses the **appointment type name** (via
  `appointments.appointment_type_id → appointment_types.name`) — this is what
  the Workflows tab labels workflows by. Falls back to template name, then
  "Workflow". (`workflow_templates.name` like "Standard New Patient Intake" is
  seed data, NOT what users see in the Workflows tab.)
- Inside each run block, actions are split into two labelled sub-groups,
  **Actions first** (higher priority) then **Messages**. Classified by
  `getActionKind()` in `src/lib/workflows/types.ts`: actions =
  intake_package / deliver_form / capture_card / verify_contact / task;
  messages = the send_* family + intake_reminder.
- **intake_package expands into its constituent to-dos** (each form, card
  capture, consent) read from `intake_package_journeys` (form_ids +
  forms_completed, includes_card_capture + card_captured_at, includes_consent +
  consent_completed_at), each rendered as an `IntakeItemRow` with a done /
  Outstanding indicator nested under the package action.

## Message content dropdown + "dropped" hidden (added after review)
- **Message rows are expandable** (chevron) to reveal the SMS text. The exact
  interpolated body sent is NOT persisted by the engine, so we show the
  **configured template with placeholders unresolved** (`{first_name}` etc.) —
  the faithful "what was configured" view. Source: `config.message` /
  `config.message_body` for custom messages; mirrored handler templates for the
  auto-composed types (form link, card capture, intake reminder). Resolved by
  `getMessageTemplate()` in `src/lib/workflows/types.ts`; surfaced as
  `WorkflowAction.message_template`. A caption notes placeholders fill in on
  send. Rows with no template aren't expandable.
- **"dropped" actions are hidden** from the Workflows section. A dropped action
  never fired (scheduled after the appointment) and was never sent, so showing
  it only confuses staff. Filtered in `buildGroups`. The `dropped` status stays
  in the data model / engine untouched.

## Out of scope (this pass)
- Tasks-dashboard-level pre/post filter (deferred).
- Core-tier one-shot prep SMS (not an `appointment_action` tied to a run) —
  not represented unless special-cased later.
- Any schema migration.
- Changing the workflow engine, action firing, or how actions are created.

## Verification
- Open a patient pane from the **runsheet** on an appointment that has a
  pre-appointment workflow run → see a collapsed "… · <date>" block; expand to
  see the join-link SMS etc.
- Open a patient with both pre and post runs → two blocks; active appointment's
  run is expanded by default.
- Open the same patient from **tasks/readiness** → identical blocks.
- Patient with no workflow actions → no Workflows section (no empty shell).
- `npm run build` / typecheck passes.
