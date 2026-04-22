# Execution Plan: Intake Package Workflow Engine + Appointment Types UI

**Date**: 2026-04-09
**Specs**: Intake Package Workflow Engine (v2), Appointment Types UI Spec
**Estimated phases**: 7

---

## Dependency Graph

```
Phase 1: Database migration
    ↓
Phase 2: Type system + workflow engine updates (backend)
    ↓
Phase 3: Readiness API + dashboard updates (backend + frontend)
    ↓
Phase 4: Add-patient panel updates (frontend)
    ↓
Phase 5: Appointment types settings — list view + editor slide-out (frontend)
    ↓
Phase 6: Save API endpoint — transactional multi-table write (backend)
    ↓
Phase 7: Patient-facing intake package journey page (frontend + backend)
```

Phases 2–4 can partially overlap (they touch different files), but the migration must land first. Phase 5 and 6 are tightly coupled (the editor needs the save endpoint). Phase 7 is the most independent — it's a new page with new API routes.

---

## Phase 1: Database Migration

**Goal**: Get the schema in place so all subsequent work can be built on top of it.

### Files

| File | Action |
|------|--------|
| `supabase/migrations/013_intake_package_workflow.sql` | **Create** |

### Work

1. Add enum values: `intake_package`, `intake_reminder`, `add_to_runsheet` to `action_type`
2. Add `dropped` to `action_status` enum (for reminders that don't fit short-lead bookings)
3. Create `workflow_terminal_type` enum (`run_sheet`, `collection_only`)
4. Add columns to `workflow_templates`: `terminal_type`, `at_risk_after_days`, `overdue_after_days`
5. Add `parent_action_block_id` to `workflow_action_blocks` with FK and index
6. Add unique partial index: one `intake_package` per template
7. Make `appointments.scheduled_at` nullable with column comment
8. Create `intake_package_journeys` table with column comment on `patient_id`, unique index on `appointment_id`
9. Add `idx_appointments_created_at` index
10. RLS policies for `intake_package_journeys` (SELECT, INSERT, UPDATE, DELETE) + Realtime publication
11. Create `configure_appointment_type` RPC function (atomic multi-table save) — pulled forward from Phase 6 so the database-level transaction is locked in early
12. Run migration against dev database, regenerate Supabase types

### Verification
- `npx supabase db push` succeeds
- Generated types in `src/lib/supabase/types.ts` reflect nullable `scheduled_at`, new columns, new table

---

## Phase 2: Type System + Workflow Engine Updates

**Goal**: Update the TypeScript types, action type metadata, workflow handlers, and scanner to support the new action model.

### Files

| File | Action |
|------|--------|
| `src/lib/supabase/types.ts` | **Regenerate** (auto from migration) |
| `src/lib/workflows/types.ts` | **Modify** |
| `src/lib/workflows/handlers.ts` | **Modify** |
| `src/lib/workflows/scanner.ts` | **Modify** |
| `src/lib/workflows/engine.ts` | **Modify** |
| `src/stores/clinic-store.ts` | **Modify** |

### Work

**`types.ts`** — Action type metadata:
1. Add `intake_package` to `ACTION_TYPE_META`: pre only, no form/message/file, config is `{ includes_card_capture, form_ids, includes_consent }`
2. Add `intake_reminder` to `ACTION_TYPE_META`: pre only, has message, parent-aware
3. Add `add_to_runsheet` to `ACTION_TYPE_META`: pre only, no config
4. Change existing pre-appointment types (`deliver_form`, `capture_card`, `send_reminder`, `verify_contact`) to `availableInPre: false` — they're now post-appointment only in the editor. The enum values stay; just the metadata filter changes.

**`handlers.ts`** — New handlers:
1. `intake_package` handler: read config from action block, generate journey token, create `intake_package_journeys` row (patient_id null), send SMS with journey link, return `{ status: 'sent', resultData: { journey_id, journey_token } }`
2. `intake_reminder` handler: fetch parent action status (skip if completed), fetch journey row (fail if missing with clear error), send SMS with same journey link and custom message body, return `{ status: 'sent' }`
3. `add_to_runsheet` handler: fetch appointment, validate room_id, create session + session_participants, send SMS with entry link, return `{ status: 'sent', resultData: { session_id, entry_token } }`

**`scanner.ts`** — Scheduling changes:
1. Handle null `scheduledAt`: when null, anchor is `Date.now()`
2. For `intake_reminder` blocks: compute `scheduled_for` as `parent_intake_package.scheduled_for + (offset_days * 24h)`, not from appointment time
3. For `add_to_runsheet` blocks: `scheduled_for = appointment.scheduled_at` (offset 0)
4. Drop logic: for run-sheet workflows, mark any action whose `scheduled_for` falls after `appointment.scheduled_at` as `dropped`
5. Intake package itself: `scheduled_for = now` (fires immediately)

**`engine.ts`**:
1. Pass `scheduled_at` as nullable through to handlers
2. No other changes — the engine's fire-and-update loop is generic

**`clinic-store.ts`**:
1. Change `ReadinessAppointment.scheduled_at` type from `string` to `string | null`
2. Add `terminal_type` to whatever type carries workflow template data if needed for the add-patient panel

### Verification
- TypeScript compiles with no errors
- Existing workflow engine tests (if any) still pass
- New handler code is syntactically correct (manual review — full end-to-end testing happens in Phase 7)

---

## Phase 3: Readiness API + Dashboard Updates

**Goal**: The readiness dashboard correctly displays and sorts both run-sheet and collection-only appointments using the new journey-based priority system.

### Files

| File | Action |
|------|--------|
| `src/app/api/readiness/route.ts` | **Modify** |
| `src/lib/readiness/derived-state.ts` | **Modify** |
| `src/components/clinic/readiness-shell.tsx` | **Modify** |

### Work

**`route.ts`** — Readiness API:
1. **Remove the legacy `legacyFormAssignmentsQuery` function entirely** (lines ~271–end). Remove the fallback call on line 64 and line 76.
2. Update `GroupedAppointment` type: `scheduled_at: string` → `string | null`
3. Add `intake_package_journeys` fetch to the enrichment `Promise.all` block
4. Add workflow template fetch (for `terminal_type`, `at_risk_after_days`, `overdue_after_days`) via the template IDs from workflow runs
5. Pass journey + template data into the priority derivation
6. Add journey progress data to the response shape for the new package status column

**`derived-state.ts`** — Priority derivation:
1. Replace `getReadinessPriority` with the new two-layer system from the spec:
   - `getConfiguredState(journey, template, now)` using `journey.created_at` as anchor
   - Fallback layer for run-sheet: 2 days = at_risk, 1 day = overdue
   - `worst()` merge function with `PRIORITY_SEVERITY` map
2. Guard all `appointment.scheduled_at` access with null checks
3. Update `isOverdue` and `isAtRisk` functions to handle null scheduled_at (these may be simplified since the new model doesn't inspect individual actions for priority)
4. Update sorting: `at_risk` slot falls back to oldest journey for collection-only

**`readiness-shell.tsx`** — Dashboard UI:
1. Show "—" where `scheduled_at` is null (collection-only appointments)
2. Add package status column/indicator: "3 of 5 items complete" / "Not started" / "Complete"
3. Ensure the existing priority badge, border color, and action button configs still work

### Verification
- Readiness dashboard loads without errors
- Existing run-sheet appointments display correctly (regression)
- Collection-only appointments (when seeded) display with "—" time and correct priority
- Priority sorting works across both types in the same list

---

## Phase 4: Add-Patient Panel Updates

**Goal**: The add-patient panel dynamically shows/hides fields based on the selected appointment type's terminal type.

### Files

| File | Action |
|------|--------|
| `src/components/clinic/add-patient-panel.tsx` | **Modify** |
| `src/app/api/readiness/add-patient/route.ts` | **Modify** |

### Work

**`add-patient-panel.tsx`**:
1. Fetch or derive `terminal_type` for the selected appointment type. The store already has `appointmentTypes` with `pre_workflow_template_id`. Use that to look up the template's `terminal_type` — either from the store (if we add it to the hydrated data) or via a lightweight fetch.
2. When appointment type is selected and terminal_type is `collection_only`: hide room, date, time fields. Animate transition.
3. When terminal_type is `run_sheet` (or no type selected): show all fields as today.
4. Update validation to skip room/date/time when `collection_only`.
5. Update the `handleSave` payload to omit `room_id`/`scheduled_at` for collection-only.

**`add-patient/route.ts`**:
1. Remove `room_id` and `scheduled_at` from the required field check on line 32.
2. Add conditional validation: look up the workflow template for the appointment type, check `terminal_type`. If `run_sheet`, require `room_id` and `scheduled_at`.
3. Create appointment with nullable `room_id` and `scheduled_at`.
4. Pass nullable `scheduled_at` to `scheduleWorkflowForAppointment`.

### Verification
- Select a run-sheet type → room/date/time fields appear, all required
- Select a collection-only type → room/date/time fields disappear, save works without them
- Appointment created with null `scheduled_at` for collection-only
- Workflow scheduled correctly with `Date.now()` anchor for collection-only

---

## Phase 5: Appointment Types Settings — List View + Editor Slide-Out

**Goal**: Build the full appointment types configuration UI from the UI spec.

### Files

| File | Action |
|------|--------|
| `src/app/(clinic)/settings/appointment-types/page.tsx` | **Modify** (currently placeholder) |
| `src/components/clinic/appointment-types-settings-shell.tsx` | **Create** |
| `src/components/clinic/appointment-type-editor.tsx` | **Create** |
| `src/components/clinic/intake-package-section.tsx` | **Create** |
| `src/components/clinic/reminders-section.tsx` | **Create** |
| `src/components/clinic/urgency-section.tsx` | **Create** |
| `src/components/clinic/form-picker-inline.tsx` | **Create** |
| `src/components/ui/collapsible-section.tsx` | **Create** |
| `src/stores/clinic-store.ts` | **Modify** |

### Work

**`appointment-types-settings-shell.tsx`** — List view:
1. Header strip with title, subtitle, "Sync from PMS" button (conditional), "+ New appointment type" button
2. Unconfigured banner (amber, with count and "Show unconfigured" filter link)
3. Filters strip: search input, source dropdown, status dropdown, "Show archived" toggle
4. Table: Name (with source indicator), Duration, Modality pill, Intake package (two-line summary), On completion pill
5. Row click → open editor slide-out
6. Footer: count text
7. Client-side filtering and search

**`collapsible-section.tsx`** — Reusable section primitive:
1. Collapsed: chevron + title + summary line + optional amber/red dot
2. Expanded: thickened border, rotated chevron, content area
3. Props: title, summary, expanded, onToggle, hasUnsavedChanges, hasError, children

**`appointment-type-editor.tsx`** — Editor slide-out (620px):
1. Uses existing `SlideOver` component with `width="w-[620px]"`
2. Fixed header: name (editable for new, text for existing), source indicator, meta line
3. Scrollable body with 5 `CollapsibleSection` components
4. Fixed footer: delete/archive button (left), cancel + save buttons (right)
5. Progress strip (unconfigured state): 5 step indicators, validity-based completion
6. Unsaved changes tracking per section (amber dots)
7. Section 1 (Details): name, duration, modality, default fee. PMS lock on name/duration. Collection-only mutes duration + modality.
8. Section 2 (On completion): two selectable cards (run_sheet / collection_only). Data flow note is implementation-only, not shown to user.
9. Cancel/close with unsaved changes confirmation (inline banner)
10. Delete/archive confirmation (inline banner replacing footer)

**`intake-package-section.tsx`** — Section 3:
1. Locked "Verify identity and create contact" row
2. "Store a card on file" toggle
3. "Provide consent" toggle
4. "Fill out forms" with form picker
5. Summary line: "The patient will complete N items in one journey."

**`form-picker-inline.tsx`** — Inline form selector:
1. "Add form" button expands inline panel
2. Search input (client-side substring)
3. Checkbox list of published forms
4. "Done" button collapses panel
5. Selected forms shown as removable rows above

**`reminders-section.tsx`** — Section 4:
1. Stack of reminder cards (max 2): title, trash icon, offset input, message textarea with variable hints and char count
2. "Add reminder" button (disabled at cap)
3. Empty state message
4. Validation: unique offsets, positive integers

**`urgency-section.tsx`** — Section 5:
1. Two numeric inputs: at-risk days, overdue days
2. Fallback note box (blue info style)
3. Validation: overdue > at_risk when both set

**Store updates**:
1. Add `terminal_type` to `AppointmentTypeRow` (fetched from linked workflow template)
2. Add `intake_package_config` to the row shape (or fetch on editor open)
3. Add `refreshAppointmentTypes` method if not already present

### Verification
- List view renders all appointment types with correct columns
- Clicking a row opens the editor slide-out
- All 5 sections expand/collapse correctly
- Progress strip appears for unconfigured types, disappears after save
- Form picker inline expansion works
- Unsaved changes indicators (amber dots) work
- Validation errors show red dots and auto-expand sections

---

## Phase 6: Save API Endpoint

**Goal**: A thin API endpoint wrapping the `configure_appointment_type` RPC function created in Phase 1.

### Files

| File | Action |
|------|--------|
| `src/app/api/appointment-types/configure/route.ts` | **Create** |

### Work

**`POST /api/appointment-types/configure`**

The RPC function (`configure_appointment_type`) was created in Phase 1's migration. This endpoint is a thin wrapper: validate the request, call the RPC, return the result.

1. **Request payload**:
```typescript
{
  appointment_type_id?: string;  // null for create
  org_id: string;
  // Details
  name: string;
  duration_minutes?: number;     // null for collection-only
  modality?: string;             // null for collection-only
  default_fee_cents?: number;
  // On completion
  terminal_type: 'run_sheet' | 'collection_only';
  // Intake package
  includes_card_capture: boolean;
  includes_consent: boolean;
  form_ids: string[];
  // Reminders
  reminders: Array<{
    id?: string;                 // existing reminder block ID, null for new
    offset_days: number;
    message_body: string;
  }>;
  // Urgency
  at_risk_after_days?: number;   // null means no configured threshold
  overdue_after_days?: number;
}
```

2. **Server-side validation** (before calling RPC):
   - Name required
   - If `terminal_type === 'run_sheet'`: duration and modality required
   - If both urgency thresholds set: `overdue_after_days > at_risk_after_days`
   - Reminder offsets unique and positive
   - Max 2 reminders
   - All `form_ids` exist and belong to the org

3. **RPC call**:
```typescript
const { data, error } = await supabase.rpc('configure_appointment_type', {
  p_org_id: org_id,
  p_appointment_type_id: appointment_type_id ?? null,
  p_name: name,
  p_duration_minutes: duration_minutes ?? null,
  p_modality: modality ?? 'telehealth',
  p_default_fee_cents: default_fee_cents ?? 0,
  p_terminal_type: terminal_type,
  p_includes_card_capture: includes_card_capture,
  p_includes_consent: includes_consent,
  p_form_ids: form_ids,
  p_reminders: JSON.stringify(reminders),
  p_at_risk_after_days: at_risk_after_days ?? null,
  p_overdue_after_days: overdue_after_days ?? null,
});
```

4. **Idempotency**: the RPC uses upsert semantics. Double-clicks and retries produce the same result.

5. **Response**: `{ appointment_type_id, workflow_template_id }` on success, `{ error }` on failure.

### Verification
- Create a new appointment type from scratch → all rows created correctly
- Update an existing appointment type → rows updated, reminders synced
- Save a PMS-synced type for the first time → workflow template + links created
- Change terminal_type from run_sheet to collection_only → `add_to_runsheet` block removed
- Double-click save → same result (idempotent)
- Validation failure → error returned, no partial state

---

## Phase 7: Patient-Facing Intake Package Journey Page

**Goal**: The patient taps a link in an SMS, lands on the intake package page, verifies their phone, and works through configured items with persistent progress.

### Files

| File | Action |
|------|--------|
| `src/app/intake/[token]/page.tsx` | **Create** |
| `src/app/intake/[token]/layout.tsx` | **Create** |
| `src/app/api/intake/[token]/route.ts` | **Create** |
| `src/app/api/intake/[token]/verify/route.ts` | **Create** |
| `src/app/api/intake/[token]/complete-item/route.ts` | **Create** |
| `src/components/patient/intake-journey.tsx` | **Create** |
| `src/components/patient/intake-card-capture.tsx` | **Create** |
| `src/components/patient/intake-consent.tsx` | **Create** |
| `src/components/patient/intake-form.tsx` | **Create** |

### Work

**Layout** (`layout.tsx`):
1. 420px max-width centred container (same as existing patient entry flow)
2. Clinic branding header (logo, name)

**Page** (`page.tsx`):
1. Server component that fetches the journey by token
2. If journey not found → 404
3. If journey completed → "All done" confirmation screen
4. Otherwise → render `IntakeJourney` client component

**`GET /api/intake/[token]`**:
1. Fetch `intake_package_journeys` by `journey_token`
2. Fetch linked appointment → clinic branding, appointment type name
3. Return journey state: which items are configured, which are complete, clinic info
4. No auth required (token-based access, same as patient entry flow)

**`POST /api/intake/[token]/verify`**:
1. Patient submits phone OTP
2. On success: resolve patient via phone number + org (multi-contact resolution)
3. Update `intake_package_journeys.patient_id` with verified patient
4. Return patient info for identity confirmation screen

**`POST /api/intake/[token]/complete-item`**:
1. Body: `{ item_type: 'card' | 'consent' | 'form', form_id?: string, data: any }`
2. Update the relevant field on `intake_package_journeys`:
   - Card: set `card_captured_at` (actual Stripe integration is stubbed)
   - Consent: set `consent_completed_at`
   - Form: add entry to `forms_completed` JSONB + create `form_submissions` row
3. **Completion check**: after each item completion, check if all configured items are done. If so:
   - Set `intake_package_journeys.status = 'completed'`, `completed_at = now()`
   - Find the `appointment_actions` row for the `intake_package` action and update its status to `'completed'`
4. Return updated journey state

**`IntakeJourney` component**:
1. Linear flow: phone verification → identity confirmation → card capture (if configured) → consent (if configured) → forms (if configured) → done screen
2. Progress saved on each step completion
3. If the patient returns later (reminder link), they land on the first incomplete step
4. Each step is a child component: `IntakeCardCapture`, `IntakeConsent`, `IntakeForm`
5. Done screen: "You're all set. We'll be in touch before your appointment." (run-sheet) or "Thanks for completing your intake. We'll be in touch." (collection-only)

### Verification
- Visit `/intake/{token}` → see phone verification
- Complete OTP → see identity confirmation
- Complete all items → journey marked as completed
- Visit same link after completion → see "All done" screen
- Partial completion → leave → return via reminder link → resume from last incomplete step
- `appointment_actions` row for intake_package flips to `completed` when journey completes

---

## Phase 8: Identity Model Refactor — Confirm Over Capture

**Goal**: Align the intake journey with reality. The clinic provides the patient's identity (first name, last name, phone, optionally DOB) when adding them via the add-patient panel. Patient contact creation happens at that point, not during the intake journey. The intake journey's job is to prove **ownership of the phone number** the clinic asserted against — not to capture identity. Today the intake package spec and the patient entry flows spec conflate these two models.

This phase is a small refactor: a shift in framing, minor code changes, and spec corrections. It must land **before** onboarding is built, because onboarding relies on confirm-mode identity in the Phase 7 journey.

### Files

| File | Action |
|------|--------|
| `src/app/api/intake/[token]/verify/route.ts` | **Modify** — resolve contact by phone + org. On match, return contact details for confirm screen. On zero matches (edge case — clinic data entry error), return an explicit error surface rather than falling into capture. On multi-match (shared family phone), return contact list for picker. |
| `src/components/patient/intake-journey.tsx` | **Modify** — replace any "capture mode" identity branching with a confirm-only screen: "Hi [first name]. Is this you? Yes / Someone else / Not me (contact the clinic)". No DOB or name input. |
| `src/components/clinic/workflow-template-editor` (wherever intake package contents are configured) | **Modify** — remove the locked "Create patient contact" row from the intake package checklist editor. It's no longer a configurable item; it happens at add-patient time. |
| `src/lib/workflows/handlers.ts` — `handleIntakePackage` | **Modify** — the handler no longer creates a contact. It just spins up the `intake_package_journeys` row and sends the SMS. The `patient_id` on the journey is populated from the appointment's `patient_id`, which was set at add-patient time. |
| `src/lib/supabase/types.ts` | **Verify** — ensure `intake_package_journeys.patient_id` is NOT NULL after Phase 8 (previously NULL until verification). This is an important data-model tightening: the journey is tied to a known contact from moment zero. |
| Schema (migration) | **Optional, recommended** — add `NOT NULL` constraint to `intake_package_journeys.patient_id`, backfilling any existing NULL rows by joining to `appointments.patient_id`. If the constraint is contentious, leave nullable and enforce in application code. |
| `docs/specs/intake-package-workflow-spec.md` | **Rewrite** the "Create patient contact" section. It's no longer an intake package config item. The patient is created at add-patient time. The journey only verifies ownership and confirms. |
| `docs/specs/patient-entry-flows.md` | **Split identity** into two explicit variants:<br>- **Capture mode** — used by `/entry/[token]` for Core/run-sheet phone-only SMS entries, QR on-demand entries, and any path where the clinic did not provide identity data upfront.<br>- **Confirm mode** — used by `/intake/[token]` Complete intake package journeys. Contact always exists from add-patient time; patient just confirms. |
| `docs/specs/onboarding-spec.md` | **Minor** — remove the "cross-spec cleanup not in scope here" caveat in the Identity section; Phase 8 now covers it. |

### Work

1. **Rewrite `handleIntakePackage`** so it no longer attempts contact creation. Journey rows are seeded with `patient_id` from the appointment. If the appointment has no `patient_id`, log a warning and fail the action (should not happen in normal flow — the add-patient panel always sets it).

2. **Rewrite the `/api/intake/[token]/verify` endpoint** to return one of three shapes:
   - `{ status: 'matched', contact: { id, first_name, last_name } }` — single match, render confirm screen.
   - `{ status: 'multi_match', contacts: [...] }` — multiple contacts for this phone in this org, render picker.
   - `{ status: 'no_match' }` — zero contacts. Rare. Render an error screen with "Contact your clinic" and a button to call the clinic's number. This indicates the clinic provided a wrong phone for a scheduled patient — a data-entry problem, not something the patient can self-resolve.

3. **Rewrite the intake journey identity screen** to render only confirm / picker / no-match paths. Remove any first-name/last-name/DOB input. Remove any "new patient" branch.

4. **Remove "Create patient contact"** from the intake package content editor. Update the editor's checklist to show only: Card capture, Consent, Forms. Patient contact creation is implicit — the intake package can't exist without a scheduled appointment, and the appointment can't exist without a contact.

5. **Update supabase types** — regenerate types after any schema constraint change. Verify that `intake_package_journeys.patient_id` shows as `string` (not `string | null`) if the NOT NULL constraint lands.

6. **Spec updates** — the three spec files as described.

### Verification

- Add a patient via the add-patient panel → the `patients` + `patient_phone_numbers` rows exist, and the appointment row has `patient_id` set.
- Workflow fires the `intake_package` action → `intake_package_journeys` row is created with `patient_id` set (not NULL).
- Patient taps SMS → verifies phone → sees "Hi [first name]. Is this you?" — not a name/DOB form.
- Patient taps "Someone else" on a multi-contact phone → sees the picker with other contacts' names.
- Patient on a data-entry-error phone (no contact for this phone in the org) → sees the "Contact your clinic" error screen, not a capture form.
- Intake package editor no longer shows "Create patient contact" as a checklist item.
- The onboarding test session (once onboarding is built) uses the same confirm-mode identity screen with the user's own name.

### What Phase 8 is NOT

- Not a change to `/entry/[token]`. The Core / run-sheet / on-demand capture-mode identity flow stays as-is. It genuinely needs capture mode because the clinic provided no identity data.
- Not a change to the add-patient panel. It already captures identity correctly.
- Not a multi-contact resolution overhaul. If that needs work, it's a separate concern.
- Not about adding consent as a step. Consent remains a separate optional intake package item, outside Phase 8's scope.

---

## Execution Order Summary

| Phase | Description | Depends on | Approx complexity |
|-------|-------------|------------|-------------------|
| 1 | Database migration | Nothing | Small |
| 2 | Type system + workflow engine | Phase 1 | Medium |
| 3 | Readiness API + dashboard | Phase 1, 2 | Medium |
| 4 | Add-patient panel | Phase 1, 2 | Small |
| 5 | Appointment types settings UI | Phase 1, 2 | Large |
| 6 | Save API endpoint | Phase 1, 5 (for testing) | Medium |
| 7 | Patient intake journey page | Phase 1, 2, 6 | Large |
| 8 | Identity model refactor (confirm over capture) | Phase 7 | Small |

**Parallelism opportunities**:
- Phases 3 and 4 can run in parallel (different files, both depend on 1+2)
- Phase 5 (UI) and Phase 6 (save API) can be developed in parallel if the payload shape is agreed upfront — the UI can use optimistic local state while the API is built
- Phase 7 is the most independent and can start as soon as Phase 2 is done (needs the handlers and journey table, not the settings UI)
- Phase 8 is small but must land after Phase 7 so the journey page exists to modify

**Critical path**: Phase 1 → Phase 2 → Phase 6 → Phase 7 → Phase 8. The settings UI (Phase 5) is important but doesn't block the patient-facing flow.

**Status (as of 2026-04-18):** Phases 1–6 are built. Phase 7 and Phase 8 are outstanding.
