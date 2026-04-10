# COVIU

Feature Spec

# Readiness Dashboard

Manual Patient Entry, Workflow Surfacing & Form Handoff

April 2026

**CONFIDENTIAL**

---

## Overview

| | |
|---|---|
| **Surface** | Readiness Dashboard |
| **Users** | Receptionists (primary), Practice Managers, Clinic Owners |
| **Available to** | Complete tier only. Not available on Core. |
| **Real-time** | Yes. Supabase Realtime subscriptions for workflow state changes. |
| **Priority** | Complete-tier foundation. Required for Diana demo of unintegrated Complete. |

The Readiness Dashboard is the operational surface for managing patient workflows across the appointment horizon. It is where receptionists create patient records manually (in the unintegrated path), see what workflow actions are outstanding, intervene when automation needs human help, and handle the form-completion-to-PMS handoff that only exists in unintegrated Complete.

It is not a calendar. It is not an appointment book. It is a prioritised list of patients with active workflows, where the surface earns its keep by surfacing what needs attention and getting out of the way when things are running smoothly.

> The Run Sheet is for today. The Readiness Dashboard is for everything leading up to today and everything that follows it. Same workflow engine, two lenses.

---

## Why This Exists

The Readiness Dashboard solves a problem that the Run Sheet cannot. The Run Sheet is built for day-of operations: phone number, time, fast entry, scan-speed scanning, immediate action. It assumes the patient is verifying their identity within hours and the workflow timeline is measured in minutes.

The workflow engine, by contrast, operates across days and weeks. It needs to know about appointments before they happen so it can fire pre-appointment actions on a timed schedule. It needs to track post-appointment outcomes so it can fire follow-up actions across the recovery horizon. None of that maps onto the Run Sheet's day-of operational frame.

Previously the assumption was that this longer horizon required PMS integration to function — appointments would flow into Coviu via PMS sync, and the workflow engine would act on them automatically. Diana has asked that Complete be experienceable without PMS integration. The Readiness Dashboard is the answer.

In unintegrated Complete, the receptionist enters patients manually into the Readiness Dashboard. The manual entry form creates a patient record and an appointment. The workflow engine starts firing actions against the appointment based on the configured template for that appointment type. Outstanding actions surface on the Readiness Dashboard. The receptionist intervenes when needed. On the day of the appointment, a workflow action automatically creates a session on the Run Sheet.

When PMS integration eventually exists, it replaces the manual entry step. Everything downstream is identical.

---

## Tier Boundary

The Readiness Dashboard is a Complete-only surface. Core users do not see it, do not have access to it, and do not have the workflow engine that powers it. The Core/Complete boundary is unchanged: Complete unlocks the workflow engine and the Readiness Dashboard as a pair, and the Readiness Dashboard is the surface through which the workflow engine is used.

PMS integration is no longer a prerequisite for Complete. It is an accelerant. Integrated Complete gets automatic appointment sync. Unintegrated Complete gets manual entry through the Readiness Dashboard. Both have access to all Complete features.

---

## The Surface

The Readiness Dashboard occupies the same sidebar position as it does in the existing IA. The page header is consistent with the Run Sheet: title and date on the left, primary action button on the right.

### Page Header

| Element | Content |
|---|---|
| **Title** | "Readiness" |
| **Subtitle** | Location name and current date |
| **Primary action** | "+ Add patient" button (teal, top-right) |
| **Mode toggle** | "Pre-appointment (N) / Post-appointment (N)" segmented control beneath the title. Counts in red if any items in that mode are in an overdue state. |

The mode toggle is the load-bearing UI element that lets the receptionist focus on one direction at a time without losing peripheral awareness of the other. The default mode on page load is Pre-appointment, because pre-appointment work has higher operational urgency in most clinics. Switching to Post-appointment changes the underlying list but keeps everything else (filters, layout, interaction model) identical.

### Filter Bar

A horizontal row of filter chips beneath the mode toggle. Receptionists can toggle multiple chips on at once.

| Filter | Type | Behaviour |
|---|---|---|
| **Room** | Multi-select chips | Filters the list to patients booked in the selected rooms at the current location. Populated from the rooms at the current location. |
| **Appointment type** | Multi-select chips | Filters the list to patients with the selected appointment types. Populated from the appointment types configured by the practice manager. |
| **Status** | Multi-select chips | Filters the list to patients in the selected priority states. Options: Overdue, Form Completed Needs Transcription, At Risk, In Progress, Recently Completed. Useful for receptionists who want to focus on a single priority slot — for example, working through all overdue items in one sitting. |

The Status filter works alongside the priority hierarchy and auto-collapse behaviour rather than replacing them. With no Status filter active, the list shows everything sorted by priority. With one or more Status chips active, the list shows only patients in the selected slots, still sorted by priority within those slots.

Filter chips are visually consistent with the existing Coviu component library. Active chips have a teal background. Inactive chips have a neutral background with a teal border. Clearing all filters returns the list to the full location-scoped view.

### Patient List

The body of the surface is a single scrollable list of patients with active workflows in the current mode. Each patient is one row. Same patient with two future appointments appears as two rows.

The list is sorted by priority hierarchy (described below) with auto-collapse and auto-expand behaviour modelled on the Run Sheet.

---

## Priority Hierarchy

The list is not sorted chronologically. It is sorted by urgency, with the highest-priority items at the top. The hierarchy is:

### 1. Overdue (red)

A required workflow action has not been completed and the deadline has passed. The most common cases:

- Form not filled out and the appointment is within 24 hours
- Card not stored and the appointment is within 24 hours
- Required consent not signed and the appointment is imminent
- Post-appointment: PROMs questionnaire not returned within the configured window

These are the cases where the patient is going to walk into a session unprepared (or the post-appointment data is going to be lost). They demand immediate human intervention. Background notification fires for these (consistent with the Run Sheet's late patient notification pattern).

Derivation: A workflow action is considered overdue when its `scheduled_for` timestamp is in the past AND either (a) the appointment is within 24 hours, or (b) the action was scheduled more than 48 hours ago. Whichever condition triggers first wins. The 48-hour fallback catches the case where an action was supposed to fire weeks before the appointment, didn't fire, and is now meaningfully overdue even though the appointment itself is still days or weeks away.

### 2. Form Completed, Needs Transcription (amber, distinct from at-risk)

A patient has completed a form via their pre-appointment workflow. The form data is in Coviu. In unintegrated Complete, the receptionist needs to copy that data into the clinic's PMS so it lands in the patient's clinical record. Until they do, the form data is sitting in Coviu with no clinical home.

This is a workflow state that only exists in the unintegrated path. In integrated Complete, form data flows back to the PMS automatically and this priority slot is empty.

The interaction is the form completion handoff (described in detail below).

### 3. At Risk (amber)

A required workflow action is incomplete and the deadline is approaching but not yet breached. Examples:

- Form sent 5 days ago, not yet completed, appointment is in 3 days
- Card capture link sent, not yet actioned, appointment is in 2 days
- Reminder due to fire today and the receptionist may want to verify the patient is still attending

These items don't require immediate action but the receptionist may want to intervene (send a nudge SMS, call the patient, escalate to a clinical contact).

Derivation: A workflow action is at risk when its `scheduled_for` timestamp is in the past AND the appointment is within 7 days, but the overdue conditions above are not yet met. These thresholds are configurable per workflow template in v2; for the prototype they are global defaults.

### 4. In Progress (no color, default state)

Everything is on track. Workflow actions are firing as configured. The patient is responding to prompts. No human intervention is needed.

In-progress patients appear in the list as compact one-line rows at lower visual weight. Click to expand and see the full workflow state for that patient.

### 5. Recently Completed (faded)

Patients whose pre-appointment workflow is fully done and whose appointment has not yet happened, or patients whose post-appointment workflow has fully completed. These appear at the bottom of the list at reduced opacity. Useful as a confidence signal that the workflow handled them correctly. Auto-collapsed by default; reveal with a "Show completed (N)" toggle at the bottom of the list.

---

## Auto-Expand and Auto-Collapse

The same operational principle as the Run Sheet: the surface only shows what needs attention. Quiet sections collapse to a header. Active sections expand only to the items causing the attention state.

### Patient Row Expansion States

Each patient row has three states:

**Collapsed:** Shows the row content (name, appointment type, room, date/time, status badge, action button if applicable). No workflow action detail visible. Default state for in-progress patients.

**Auto-expanded (filtered):** Shows only the workflow actions causing the priority state. If a patient has seven workflow actions and one is overdue, the auto-expanded row shows that one action with its action button. The other six actions are hidden behind a "Show all steps" toggle.

**Fully expanded:** All workflow actions for the patient are visible, ordered chronologically. Triggered by clicking "Show all steps" or by clicking the patient name.

### Auto-Expansion Triggers

| State | Auto-expand behaviour |
|---|---|
| Overdue | Row auto-expands showing the overdue action(s) only |
| Form completed needs transcription | Row auto-expands showing the form completion action |
| At risk | Row auto-expands showing the at-risk action(s) only |
| In progress | Row stays collapsed |
| Recently completed | Row stays collapsed, hidden behind "Show completed" toggle |

The receptionist can manually expand or collapse any row regardless of state. Manual state persists for that row until a new state change triggers re-evaluation.

---

## Patient Row Content

Each row in the list displays:

| Column | Content | Style |
|---|---|---|
| **Patient name** | Full name (clickable to open detail panel) | 12px 600 |
| **Appointment type** | Type name | 10px secondary colour |
| **Room** | Room name | 10px secondary colour |
| **Date/time** | Scheduled appointment date and time | Monospace, 11px |
| **Status** | Priority state badge with colour and label | Pill badge |
| **Action** | Contextual action button when applicable | Pill button |

The mobile number is not visible on the row to keep scan-speed clean. It is available in the detail panel that opens when the row is clicked.

### Action Buttons by State

| State | Button | Action |
|---|---|---|
| Overdue | "Resolve" | Opens patient detail panel scrolled to the overdue action |
| Form completed | "Review" | Opens the form completion handoff slide-out |
| At risk | "Nudge" | Sends a configured nudge SMS to the patient (resends the form link, reminder, etc.) |
| In progress | None | No action needed |
| Recently completed | None | No action needed |

---

## Patient Detail Panel

Clicking a patient name opens a slide-out detail panel from the right. Same width and styling as the Run Sheet's Process panel for consistency. The panel does not block the underlying list; the receptionist can dismiss and scroll without losing context.

### Panel Content

| Section | Content |
|---|---|
| **Header** | Patient name. Close button. |
| **Identity** | Mobile number (with copy button), date of birth, three points of ID for verification |
| **Appointment** | Appointment type, room, scheduled date and time, modality (derived from appointment type) |
| **Workflow timeline** | Vertical timeline of all workflow actions for this appointment, in chronological order. Each action shows its scheduled time, status (pending, fired, completed, overdue, skipped), and any associated content. |
| **Completed forms** | List of forms the patient has completed. Click to open the form completion handoff slide-out. |
| **Previous appointments** | List of previous appointments for this patient (if any), with date, type, and outcome. |
| **Notes** | Free text field for receptionist notes specific to this patient/appointment. |

The detail panel is read-mostly. The actionable elements are: copy buttons for identity fields, the form completion handoff entry points, and the notes field. Editing the appointment itself (changing the date, type, or room) is a separate flow accessed via a "Reschedule" or "Edit" action in the panel header. Reschedule logic is v2; for prototype, the panel shows the appointment fields read-only with a disabled edit button.

---

## "+ Add Patient" Flow

Clicking "+ Add patient" opens a slide-over panel from the right (matching the Run Sheet's "+ Add session" pattern). The panel collects the minimum information needed to create a patient record and trigger the workflow engine.

### Slide-Over: Add Patient

| Field | Type | Required | Notes |
|---|---|---|---|
| **First name** | Text input | Yes | |
| **Last name** | Text input | Yes | |
| **Date of birth** | Date picker | Yes | Three points of ID alongside name and mobile. Used for identity verification at session time. |
| **Mobile number** | Phone input with country code | Yes | +61 default. Used for SMS notifications and patient verification. |
| **Appointment type** | Dropdown | Yes | Populated from the workflow templates configured by the practice manager. Selecting an appointment type implicitly selects the workflow template and the modality (telehealth vs in-person). It does not select the room. |
| **Room** | Dropdown | Yes | Populated from the rooms at the current location. The room is the unit of clinician assignment — selecting a room implicitly determines which clinician(s) will see the patient. For single-clinician rooms this is unambiguous. For shared rooms, whichever clinician is rostered on the appointment day picks it up. |
| **Appointment date** | Date picker | Yes | Cannot be in the past. |
| **Appointment time** | Time picker | Yes | |

### What Happens on Save

1. Create a `patient` record (or match an existing one by mobile + DOB if a previous record exists for this org)
2. Create an `appointment` record with the captured fields, linked to the patient, the room, and the appointment type's workflow template. The appointment's `room_id` is set from the room dropdown selection. The appointment's `clinician_id` is left null in the manual entry path — clinician assignment is derived from the room when the day-of session is created and a clinician picks up the room. This requires `appointments.clinician_id` to be nullable; if it is currently non-null, the migration adding the readiness dashboard work should make it nullable.
3. The workflow engine begins firing actions against the appointment based on the template's timed action blocks
4. The patient appears in the Readiness Dashboard list immediately, in the In Progress state
5. The slide-over closes and a brief confirmation toast appears: "Patient added. Workflow started."

### Validation

- All fields are required
- Mobile number must be valid (E.164 format after country code normalisation)
- Date of birth must be a real date in the past
- Appointment date must be today or in the future
- Appointment time combined with date must result in a future timestamp
- If a patient with the same mobile + DOB already exists for this org, a notice appears: "This patient already exists. Use existing record?" with the option to link to the existing record or create a new one anyway

---

## The Form Completion Handoff

This is the interaction that exists only in unintegrated Complete and is the most distinctive part of the Readiness Dashboard's job.

### Trigger

A patient completes a form via their pre-appointment workflow (intake questionnaire, consent, demographic update, etc.). The form submission lands in Coviu. The workflow action transitions from "form sent, awaiting completion" to "form completed, needs transcription." The patient row in the Readiness Dashboard moves into the Form Completed Needs Transcription priority slot. The "Review" action button appears on the row.

### The Slide-Out Panel

Clicking "Review" opens a slide-out panel from the right. Same styling and width as the patient detail panel.

| Section | Content |
|---|---|
| **Header** | "Form completed: [Form name]" with the patient name and submission timestamp |
| **Field list** | Each form field as a row: field label, completed value, copy button |
| **Bulk action** | "Copy all fields" button at the top of the field list |
| **Mark as transcribed** | Primary action button at the bottom: "Mark as transcribed" |

### Field-Level Copy

Each field has its own copy button. Clicking copies just that field's value to the clipboard, with a brief visual confirmation (the button briefly changes to a checkmark). This supports the workflow of tabbing through PMS fields one at a time and copying the corresponding Coviu field for each.

### Bulk Copy

The "Copy all fields" button copies all fields as structured text (one field per line, in `Label: Value` format) to the clipboard. Useful for receptionists who paste into a single notes field rather than discrete fields.

### Mark as Transcribed

When the receptionist has finished transferring the data into the PMS, they click "Mark as transcribed." This:

1. Transitions the workflow action from "form completed needs transcription" to "form completed transcribed"
2. Removes the patient from the Form Completed Needs Transcription priority slot
3. The patient row updates immediately (returning to its underlying state, which is usually In Progress)
4. The slide-out closes with a brief confirmation toast: "Form marked as transcribed."

### Edge Case: Patient Updates Form After Transcription

By design, the form cannot be edited by the patient once submitted. The form is single-submission. If the patient needs to provide updated information, the receptionist resends the form via the workflow (creating a new form completion action), and the new submission goes through the same handoff flow. The original transcribed submission remains in the patient detail panel as historical record.

---

## Run Sheet Interaction

When a workflow action fires that creates a session on the Run Sheet (the "add to run sheet on the day of appointment" action), the patient does not disappear from the Readiness Dashboard. They remain visible.

The reasoning: the receptionist may still need to track the patient through the full workflow even after the day-of session is created. Post-appointment actions, follow-up forms, PROMs, rebooking nudges all continue after the session has happened. Removing the patient from the Readiness Dashboard the moment a session is created would create a discontinuity in the workflow tracking experience.

The patient row updates to reflect the session state (visible in the workflow timeline in the detail panel) but stays in the list. Once the post-appointment workflow is fully complete, the patient moves to the Recently Completed section and is collapsed by default.

The Readiness Dashboard also serves as a historical record. The receptionist can filter by date range to view patients whose workflows completed in past periods, supporting both audit and re-engagement use cases.

---

## Pre-Appointment vs Post-Appointment

The mode toggle at the top of the surface switches between two views of the same underlying patient list, filtered by which direction of the workflow engine is currently active for each patient.

### Pre-Appointment Mode (Default)

Shows patients with active pre-appointment workflows: appointment is upcoming, workflow actions are firing in the days/weeks leading up to it, the receptionist's job is to make sure the patient arrives prepared.

Priority hierarchy: Overdue → Form Completed Needs Transcription → At Risk → In Progress → Recently Completed.

### Post-Appointment Mode

Shows patients with active post-appointment workflows: the appointment has happened, the outcome pathway has been selected, follow-up actions are firing in the days/weeks afterwards. The receptionist's job is to make sure the patient receives their follow-up communications, completes their PROMs, and rebooks if appropriate.

Priority hierarchy: Overdue (PROMs not returned, rebooking nudge not actioned) → Form Completed Needs Transcription (post-appointment forms like PROMs that need PMS handoff) → At Risk → In Progress → Recently Completed.

### Toggle Behaviour

The toggle is a segmented control beneath the page subtitle. Each segment shows the mode label and a count of items currently in that mode. The count is in red if any items in that mode are in an Overdue state, signalling urgency without forcing a mode switch.

Example: "Pre-appointment (47) | Post-appointment (12)" with the 12 in red because three patients have overdue PROMs.

The receptionist can switch modes at any time without losing filter state. Switching modes does not reset the filter chips; the same room, appointment type, and status filters apply to both modes.

### Why a Toggle and Not Tabs

Tabs imply equality of importance. Pre and post are not equally weighted in volume or urgency for most clinics. The toggle communicates "you are in one mode and can switch to the other," which more accurately reflects the operational reality. The peripheral count badge ensures the receptionist always has awareness of the other mode without the visual clutter of mixing both into one list.

---

## Real-Time Updates

The Readiness Dashboard subscribes to Supabase Realtime channels for the underlying tables and updates the list automatically as workflow state changes.

| Channel | Trigger | Action |
|---|---|---|
| `readiness:{location_id}` | Workflow action state changes (fired, completed, overdue, transcribed) | Update the affected patient row in place |
| `readiness:{location_id}` | New patient/appointment created (manual entry or PMS sync) | Insert new row into the list |
| `readiness:{location_id}` | Appointment cancelled or rescheduled | Update or remove row |
| `readiness:{location_id}` | Form submission received | Move patient to Form Completed Needs Transcription priority slot |

The list re-sorts and re-collapses automatically as priority states change. Auto-expand and auto-collapse re-evaluate on every update.

### Store Pattern

The Readiness Dashboard uses the existing `useClinicStore` Zustand store rather than introducing a parallel store. The readiness data is added as new slices on the existing store:

- `readinessAppointments: ReadinessAppointment[]` (already exists in the store from the navigation perf work — verify and reuse)
- `readinessLoaded: boolean` (already exists, reuse)
- `refreshReadiness(locationId)` action (already exists, may need extension to accept a `direction` parameter)

The existing `ClinicDataProvider` should subscribe to the readiness Realtime channel and update the store on changes, following the same pattern as the run sheet subscription. No new provider, no new store.

---

## Background Notifications

Same pattern as the Run Sheet. Zero-permission notifications (tab title flashing, favicon badge) fire when items enter Overdue or Form Completed Needs Transcription states. Permission-based browser push notifications fire for the same triggers if the receptionist has granted permission.

Notifications include a deep link that opens the Readiness Dashboard and scrolls to the affected patient row.

---

## What This Spec Does Not Cover

The following are explicitly out of scope for this spec and will be covered separately:

- **The workflow engine itself.** The Readiness Dashboard is a surface that displays workflow state and accepts manual interventions. The workflow engine's internals (template configuration, action block types, timing logic, branching) are covered in Layer 2 and the workflow engine spec.
- **The form builder.** Form construction, field types, validation, and assignment to workflow templates are covered in the form builder spec.
- **PMS integration adapters.** When PMS integration exists, appointments will arrive in the Readiness Dashboard via sync rather than manual entry. The integration adapter logic is a separate concern.
- **Reschedule, skip, and delay actions on individual workflow steps.** These are v2. The prototype shows the surface with workflow state read-mostly. Editing the workflow per-patient comes later.
- **Outcome pathway selection.** Selecting a post-appointment outcome pathway happens in the Run Sheet's Process flow, not the Readiness Dashboard. The Readiness Dashboard then displays the resulting post-appointment workflow.
- **Date range filtering for historical workflows.** The default view shows active workflows only. Filtering by date range to view past-completed workflows is a v2 enhancement. The API endpoint does not need to support date range parameters in v1.
- **Audit trail for transcription handoff.** Tracking which user transcribed which form is a v2 enhancement. The prototype tracks only that transcription happened, not who did it.

---

## Decision Summary

| Decision | Choice | Rationale |
|---|---|---|
| Tier availability | Complete only | Workflow engine is Complete-only. Readiness Dashboard is the surface through which it's used. |
| Integration requirement | None | PMS integration is an accelerant, not a prerequisite. Manual entry via "+ Add patient" is the unintegrated path. |
| Entry point button | "+ Add patient" top-right | Mirrors Run Sheet's "+ Add session" pattern for consistency. |
| Entry fields | First name, last name, DOB, mobile, appointment type, room, date, time | Three points of ID from the start. Room is the unit of clinician assignment — no separate practitioner field. |
| Clinician assignment | Derived from room, set null at creation | Room maps to clinician(s) via `clinician_room_assignments`. For shared rooms, the rostered clinician picks up the day-of session. The appointment record carries `room_id` and leaves `clinician_id` null until session creation. |
| Patient creation slide-over | Slide-over panel from right | Consistent with Run Sheet's add session and Process panels. |
| Priority hierarchy | Overdue → Form Completed → At Risk → In Progress → Recently Completed | Form Completed is a distinct slot because it only exists in unintegrated Complete and demands manual handoff. |
| Auto-collapse and auto-expand | Same pattern as Run Sheet | Show only what needs attention. Quiet sections collapse. |
| Grouping | None. Filter chips instead. | More flexible than grouping. Receptionist slices the list by the dimension that matters for the current task. |
| Filter dimensions | Room, appointment type, status | Match how receptionists actually think about their work. Status filter supports focused work sessions (e.g., bashing through all overdue items in one sitting). |
| Patient row content | Name, appointment type, room, date/time, status, action | Mobile and detailed info live in the detail panel. |
| Store pattern | Reuse existing `useClinicStore` | Single source of truth for clinic data established during the navigation perf work. No parallel store. |
| Patient detail panel | Slide-out with identity, appointment, workflow timeline, completed forms, previous appointments, notes | One place to see everything about a patient at once. |
| Form completion handoff | Slide-out with field-level copy, bulk copy, mark as transcribed | Receptionist is the bridge between Coviu and PMS in the unintegrated path. |
| Multi-appointment patients | One row per appointment | Simpler model. Multi-appointment is rare in the manual entry context. |
| Pre vs post split | Toggle with count badges, pre as default | Two modes for two jobs. Peripheral awareness without visual mixing. |
| Run Sheet interaction | Patients stay visible after session creation | Workflow tracking continues post-appointment. Removing them creates discontinuity. |
| Reschedule, skip, delay | v2 | Out of scope for prototype. |
| Read-only detail panel for prototype | Yes | Editing appointments per-patient is v2. |

---

## Open Questions

These are resolved or scoped for implementation.

1. **Default sort within priority slots.** Within the Overdue slot, patients are ordered most-overdue-first (largest gap between `scheduled_for` and now). Within At Risk, patients are ordered by appointment date (soonest first). Within In Progress, alphabetical by patient last name.

2. **Recently Completed retention window.** 7 days for prototype. Configurable later.

3. **Patient detail panel "Previous appointments" data source.** Coviu-only for unintegrated Complete. The panel notes that this list shows appointments created in Coviu and is not a complete clinical history.

4. **Reschedule affordance for prototype.** The detail panel hides the edit button entirely rather than showing a disabled one. v2 work.

---

*End of spec.*
