# Readiness Dashboard — V1

## Context

V1 test surface for observing form submission state across appointments. No workflow engine, no urgency logic, no automation. The dashboard exists so we can manually assign forms via the existing Forms assignments panel, watch them appear here as outstanding, and watch them disappear as patients complete them. Forms-only. Complete tier only. Manual assignment only.

This pairs with the existing patient slide-out (already built, accessed from the run sheet) — we're adding a new Forms section to that slide-out so the receptionist can see a patient's form status from any context.

## Surfaces

Three things to build:

1. The readiness dashboard page at `/readiness`
2. A new Forms section inside the existing patient slide-out
3. Universal patient-name click behaviour — clicking a patient name anywhere in the product opens the patient slide-out

## 1. Readiness dashboard page

**Route:** `/readiness`

**Access:** Complete tier only. Receptionist, practice manager, clinic owner. Hidden from clinicians and from Core tier clinics.

**Data source:** `form_assignments` joined to `appointments`, `patients`, `forms`, and `staff_assignments` (for clinician name). Filter: `form_assignments.status != 'completed'`. Scoped to the user's currently selected location.

**Layout:** Day-grouped table. Each section header is a date ("Tomorrow," "Wed 9 April," "Thu 10 April"). Within each section, rows are appointments ordered by `appointments.scheduled_at` ascending. One row per appointment, even if the appointment has multiple outstanding forms.

**Section ordering:**

- Past appointments with outstanding forms appear at the top in their own section labelled "Past — clinical record incomplete"
- Then today (if any)
- Then upcoming days in chronological order

**Row content (collapsed):**

- Patient name (clickable, opens patient slide-out)
- Appointment date and time (date implied by section header, time only)
- Clinician name
- Outstanding count ("2 forms outstanding")
- Action buttons: Resend SMS, Call

**Row content (expanded — inline):**

- The collapsed row stays visible
- Below it, a list of the specific outstanding form assignments for this appointment
- Each form line shows: form name, last sent timestamp ("Sent 2 days ago"), status (Sent / Opened / Completed), and a per-form Resend button
- Click the row again to collapse

**Click behaviour:**

- Click the patient name → opens the patient slide-out (does not expand the row)
- Click anywhere else on the row → expands/collapses the row inline
- Click Resend SMS button → fires the SMS immediately, updates `form_assignments.sent_at` for all outstanding forms on this appointment, shows toast "SMS resent to {patient name}"
- Click Call button → `tel:` link to the patient's primary phone number
- Click per-form Resend (in expanded state) → same as Resend SMS but only for that one form

**Empty state:** "All upcoming appointments are ready." Centered, calm, no call to action.

**Real-time:** Not required for v1. Page loads fresh data on mount. Optional: poll every 30 seconds to catch newly-completed forms. No Supabase Realtime subscription needed.

**Tech:** TanStack Table (`@tanstack/react-table`) for the row model and grouping logic. shadcn/ui Data Table primitive for the rendering layer (`npx shadcn add table` and `npx shadcn add data-table`). Use `getGroupedRowModel` for day grouping and `getExpandedRowModel` for inline row expansion. The openstatus data table boilerplate at data-table.openstatus.dev is a useful reference for wiring TanStack + shadcn together cleanly — copy patterns from it but don't take it as a wholesale dependency.

## 2. Forms section in the patient slide-out

**Where:** Inside the existing patient slide-out (already built, accessed from the run sheet). Add a new section called "Forms" alongside the existing sections (details, card details, etc).

**Content:** All form assignments for this patient, ordered by `created_at` descending (most recent first). Both outstanding and completed assignments shown in the same list, distinguished by status badge.

**Per-assignment row:**

- Form name
- Status badge (Sent / Opened / Completed)
- Sent timestamp ("Sent 3 days ago")
- Completed timestamp if applicable ("Completed yesterday")
- For outstanding assignments: Resend button
- For completed assignments: View submission button

**Resend button behaviour:** Same as the dashboard. Updates `form_assignments.sent_at`, fires SMS, toast confirmation. Does not create a new assignment row.

**View submission button behaviour:** Opens another slide-out (sliding over the patient slide-out, same slide-out component reused) showing the submitted form as a read-only rendering. Use SurveyJS's display mode (`survey.mode = "display"`) which renders the form with the patient's answers populated and inputs disabled. Header of the submission slide-out shows the form name, patient name, completed timestamp, and a back arrow that closes this slide-out and returns to the patient slide-out.

**Empty state:** "No forms have been sent to this patient." Below it, a button or link to create a new assignment via the existing Forms assignments panel.

## 3. Universal patient-name click behaviour

Patient names should open the patient slide-out from anywhere in the product they appear. This is a cross-cutting consistency requirement, not unique to the dashboard.

**Surfaces affected:**

- Run sheet (verify this already works; if not, fix it as part of this work)
- Readiness dashboard (new)
- Anywhere else patient names appear in lists or rows

**Implementation:** a shared `<PatientNameLink>` component that wraps the name in a clickable element triggering the patient slide-out for that patient ID. Use it everywhere patient names are rendered.

## Data model

No schema changes required. All necessary tables exist:

- `form_assignments` — already exists from the Forms feature
- `appointments` — already exists
- `patients` — already exists
- `forms` — already exists
- `patient_phone_numbers` — already exists, used for `tel:` link

**Key query for the dashboard:**

```sql
SELECT
  fa.id, fa.status, fa.sent_at, fa.opened_at, fa.created_at,
  f.id as form_id, f.name as form_name,
  a.id as appointment_id, a.scheduled_at,
  p.id as patient_id, p.first_name, p.last_name,
  u.full_name as clinician_name
FROM form_assignments fa
JOIN forms f ON fa.form_id = f.id
JOIN appointments a ON fa.appointment_id = a.id
JOIN patients p ON fa.patient_id = p.id
JOIN users u ON a.clinician_id = u.id
WHERE fa.status != 'completed'
  AND a.location_id = :selected_location_id
ORDER BY a.scheduled_at ASC
```

Group results by `DATE(a.scheduled_at)` in the frontend for day sectioning.

## Resend SMS logic

The SMS sending logic already exists in the Forms feature (`getSmsProvider().sendNotification()`). The dashboard's Resend button calls the same `/api/forms/assignments/send` endpoint that the existing assignments panel uses. The endpoint should:

1. Look up the assignment by ID
2. Verify status is not `'completed'`
3. Look up the patient's primary phone number from `patient_phone_numbers`
4. Construct the SMS message and the form fill URL using the existing token
5. Fire the SMS via the SMS provider
6. Update `form_assignments.sent_at` to `NOW()` (do not change `created_at`, do not create a new row)
7. Return success

The "appointment-level Resend" button on the dashboard row fires this endpoint once per outstanding form on that appointment. Could be done as a single batched endpoint call or N parallel calls — doesn't matter for v1.

## Out of scope for v1

Explicitly deferred:

- Urgency buckets or smart sorting (no workflow logic exists)
- Real-time updates via Supabase subscriptions
- Search or filter UI
- Bulk actions across multiple patients
- Auto-fire form assignments on session creation (manual assignment only)
- Appointment-type-to-form attachment
- Workflow engine integration
- Notifications when forms are completed
- Form completion analytics or reporting

These will be addressed in future iterations as the workflow engine and related features come online.

## Risks and notes

- The dashboard depends on the existing Forms feature being functional. Verify form assignments are being created correctly via the existing assignments panel before testing the dashboard.
- The patient slide-out is an existing component. Locate it before starting and confirm the pattern for adding new sections to it.
- The clinician join uses `appointments.clinician_id` → `users.id` directly (not through `staff_assignments`). Verified against the schema.
- If the patient slide-out doesn't have an established pattern for nested slide-outs (the View submission case), this is a small additional design decision: either use a second slide-out that overlays the first, or replace the content of the current slide-out with the submission view and provide a back button. Either is fine, the latter is simpler.
