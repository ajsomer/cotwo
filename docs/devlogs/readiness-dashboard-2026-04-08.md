# Readiness Dashboard: Full Implementation

**Date:** 2026-04-08 / 2026-04-09

## What changed

### Schema Migration
Added `'transcribed'` to the `action_status` enum for the form completion handoff workflow. Also added `appointment_actions` to the Supabase Realtime publication so the dashboard receives live updates when workflow actions fire or change state.

### Derived State Module
Created `src/lib/readiness/derived-state.ts` — a pure-function module for priority derivation, matching the pattern established by `src/lib/runsheet/derived-state.ts`. Calculates five priority states: overdue, form completed needs transcription, at risk, in progress, and recently completed. Each has concrete threshold logic:
- **Overdue:** action `scheduled_for` is past AND (appointment within 24h OR action scheduled 48h+ ago)
- **At risk:** action `scheduled_for` is past AND appointment within 7 days AND not yet overdue
- **Form completed needs transcription:** `deliver_form` action with status `completed` (not yet `transcribed`)
- **Recently completed:** all actions terminal AND most recent action's `updated_at` within 7 days

Sorting within priority slots: overdue = most-overdue-first, at risk = soonest-appointment-first, in progress = alphabetical, recently completed = most-recently-completed-first.

### API Layer
Extended `GET /api/readiness` with:
- `direction` query parameter (`pre_appointment` / `post_appointment`) — previously hardcoded to pre
- Priority derivation per appointment using the derived state module
- `room_name` and `appointment_type_name` enrichment from rooms/appointment_types tables
- `counts` object in response for the mode toggle badges
- Recently-completed appointments (previously filtered out) included with 7-day retention
- `updated_at` field on actions for accurate recently-completed retention checks

Created three new endpoints:
- `POST /api/readiness/add-patient` — creates patient (with phone number in `patient_phone_numbers`), appointment (with `clinician_id = null`), and triggers `scheduleWorkflowForAppointment()`. Supports patient matching by phone + DOB + org with confirmation flow.
- `POST /api/readiness/mark-transcribed` — transitions a `deliver_form` action from `completed` to `transcribed`
- `GET /api/readiness/form-submission` — fetches form submission data with field labels from the form schema for the handoff panel
- `POST /api/readiness/delete-appointment` — cascades through workflow runs, actions, sessions, and the appointment

### Store + Data Provider
Extended `ReadinessAppointment` type with `priority`, `room_name`, `appointment_type_name`, and optional `updated_at` on actions. Added `readinessDirection` and `readinessCounts` store slices. `refreshReadiness` now reads the store's direction and passes it as a query parameter.

Added `appointment_actions` Realtime subscription in `ClinicDataProvider` with a 250ms leading-edge debounce. Marked with a known-limitation comment for production (subscribes to all actions across locations — acceptable at prototype scale).

### UI: Readiness Shell
Complete rewrite of `readiness-shell.tsx`. The surface now uses the run sheet's container model: priority slots are cards (matching room cards), patient rows match session rows.

**Page header:** Card matching the run sheet header pattern (`bg-white rounded-xl border border-gray-200 px-6 py-2.5`). Contains title, mode toggle, divider, and "+ Add patient" button.

**Mode toggle:** Proper segmented control — shared container with `border-r` divider, active segment teal, inactive white. Pre/Post counts in parentheses, count text red if any overdue.

**Filter bar:** Three dropdown filters (Room, Type, Status) in a single horizontal row. Each dropdown supports multi-select with checkboxes, closes on outside click or Escape. Active filters show a teal count badge on the trigger. "Clear all filters" link on the far right.

**Priority slot cards:** Each slot (Overdue, Form Completed, At Risk, In Progress, Completed) is its own card with a collapsible header showing slot name + count badge. Chevron matches the room card expand/collapse pattern.

**Patient rows:** Match `session-row.tsx` exactly — `border-l-[3px]` accent bar, `w-[94px]` time column with `bg-[#FAF9F7]`, `h-12` content area with `px-5`, patient name at `text-[14px] font-semibold`, separator dots, type/room in `text-xs text-gray-500`. Subtle background tints per priority. Action buttons use `<Button>` component matching run sheet.

**Row expansion:** Manual expand shows all actions. Auto-expand (attention states) shows only triggering actions with "Show all steps" toggle. This matches the run sheet's room auto-expand logic.

**Workflow timeline:** Vertical line with dots, `ActionTypeIcon` per action, status badges, relative timestamps. Indented under the time column (`ml-[94px]`).

### UI: Add Patient Panel
Slide-over with 8 fields: first name, last name, DOB, mobile (+61 prefix), appointment type dropdown, room dropdown, date, time. Patient matching on submit with inline confirmation banner. Validation per spec. On save calls the add-patient endpoint and refreshes the list.

### UI: Form Handoff Panel
Slide-over for the transcription workflow. Fetches form submission data, renders field labels + values from the form schema. Per-field copy buttons and "Copy all fields" bulk action. "Mark as transcribed" button calls the mark-transcribed endpoint.

### UI: Unified Patient Slide-Over
Extended `PatientContactCard` (the run sheet's patient slide-over) with optional readiness props instead of maintaining a separate `PatientDetailPanel`. When `appointment` prop is provided, the card renders additional sections: appointment details, workflow timeline, completed forms with handoff triggers, and a delete button with inline confirmation. Run sheet usage is unchanged — no readiness props passed, no readiness sections rendered. Deleted the standalone `PatientDetailPanel`.

## Files added

| File | Purpose |
|------|---------|
| `supabase/migrations/012_action_status_transcribed.sql` | `transcribed` enum value + Realtime publication |
| `src/lib/readiness/derived-state.ts` | Priority derivation, sorting, display helpers |
| `src/app/api/readiness/add-patient/route.ts` | Create patient + appointment + workflow |
| `src/app/api/readiness/mark-transcribed/route.ts` | Mark form action as transcribed |
| `src/app/api/readiness/form-submission/route.ts` | Fetch form submission with field labels |
| `src/app/api/readiness/delete-appointment/route.ts` | Delete appointment with cascade |
| `src/components/clinic/readiness-mode-toggle.tsx` | Pre/Post segmented control |
| `src/components/clinic/readiness-filter-bar.tsx` | Dropdown filter bar (Room, Type, Status) |
| `src/components/clinic/add-patient-panel.tsx` | Add Patient slide-over |
| `src/components/clinic/form-handoff-panel.tsx` | Form transcription handoff slide-over |

## Files modified

| File | Change |
|------|--------|
| `src/app/api/readiness/route.ts` | Direction param, priority derivation, counts, room/type enrichment |
| `src/stores/clinic-store.ts` | Extended types, added direction/counts slices |
| `src/components/clinic/clinic-data-provider.tsx` | appointment_actions Realtime subscription |
| `src/components/clinic/readiness-shell.tsx` | Complete rewrite — priority slot cards, matched run sheet styling |
| `src/components/clinic/patient-contact-card.tsx` | Extended with optional readiness sections (workflow, forms, delete) |

## Files deleted

| File | Reason |
|------|--------|
| `src/components/clinic/patient-detail-panel.tsx` | Replaced by extended PatientContactCard |

## Spec + review documents updated

- `docs/specs/readiness-dashboard-spec.md` — corrected field list (room replaces practitioner), added overdue/at-risk thresholds, store pattern, status filter, updated decision summary and open questions
- `docs/specs/readiness-dashboard-spec-review.md` — added resolution lines under all 12 issues, updated schema changes list

## Design decisions

- **Priority slots as cards** rather than a flat list — matches the run sheet's room-card container model and creates visual grouping by urgency
- **Dropdown filters** rather than chip rows — saves three rows of vertical space, cleaner for locations with many rooms/types
- **Leading-edge debounce (250ms)** on Realtime subscription — fires immediately on first event, suppresses rapid follow-ups
- **clinician_id left null** on manual entry — clinician assignment derived from room at session creation time, matching the spec decision that room is the unit of assignment
- **Unified PatientContactCard** rather than two separate slide-over components — one component, two modes via optional props
- **Recently completed uses action updated_at** not appointment updated_at — more accurate for retention window calculation
