# Patient Intake Checklist + Form-Fill Polish

## Problem

The patient entry flow has no way to surface outstanding forms. Today it goes:

Primer → Phone OTP → Identity → Card → Device test → Arrive

A `deliver_form` workflow action sends an SMS with a link to `/form/[token]` — but if the patient instead enters via their session SMS link (or QR / on-demand), there's no in-flow prompt for the forms they still owe the clinic. They'd have to dig through old SMS messages.

We also have no per-form "your progress is saved" messaging in the form-fill UI, and the `deliver_form` console log doesn't make the URL easy to grab during demos.

## Goals

1. After phone OTP, surface a checklist of outstanding items (forms, card on file, device test) so the patient knows what's left to complete before their appointment.
2. Skip the checklist screen entirely if there's nothing outstanding (don't add an empty step).
3. Make "your progress is saved" explicit on the form-fill screen.
4. Print the intake/form link to the dev console in a grep-able format.

## Non-goals

- Building the `/intake/[token]` route referenced by the unbuilt `intake_package` handler. That's a separate piece of work.
- Changing the `deliver_form` SMS body or workflow.
- Patient-facing form list outside the entry flow (no separate "my forms" page).

## Approach

A new step (`outstanding_items`) lands between Identity and Card in the entry flow. It queries `form_assignments` for the resolved patient + outstanding non-form items (card, device) and renders a checklist. The checklist is conditional — if zero items are outstanding we skip straight to the next existing step, so the stepper count and UX stay clean for patients with nothing to do.

Form items in the checklist link to the existing `/form/[token]` route. When the patient returns to the entry flow (via a "Back to checklist" return URL), the list re-queries and shows the form as completed.

## Changes

### 1. New API: `GET /api/patient/outstanding-items`

**File:** `src/app/api/patient/outstanding-items/route.ts` (new)

Inputs (query params):
- `patient_id` (required)
- `org_id` (required) — patients are org-scoped
- `appointment_id` (optional) — used to filter forms tied to a specific appointment

Returns:
```ts
{
  appointment: { scheduled_at: string; clinician_name: string | null } | null;
  forms: Array<{
    assignment_id: string;
    token: string;
    form_name: string;
    status: 'pending' | 'sent' | 'opened' | 'completed';
    appointment_id: string | null;
  }>;
}
```

Query: `form_assignments` joined to `forms` (for `name`) where:
- `patient_id = :patient_id`
- `forms.org_id = :org_id` (security — patient is scoped to one org)
- `status != 'completed'`
- If `appointment_id` provided: `appointment_id = :appointment_id OR appointment_id IS NULL` (collection-only forms always show)
- Else: any assignment for this patient

Uses the service-role client (patient-facing route, no staff auth).

Appointment block is only populated if the entry context has `session.appointment_id` — fetched via the `appointments` join for `scheduled_at` and clinician name.

### 2. New step in entry flow: `outstanding_items`

**Files:**
- `src/components/patient/entry-flow.tsx` (modify)
- `src/components/patient/outstanding-items.tsx` (new)
- `src/lib/supabase/custom-types.ts` (modify — add `'outstanding_items'` to `FlowStep`)

In `entry-flow.tsx`:

- Add `'outstanding_items'` to the `FlowStep` union.
- Inject it into `steps` between `'identity'` and `'card'`, *but only if* the outstanding-items query returns ≥1 form. (We don't yet know that count at the moment we calculate `steps`. Two options — see Open Questions.)
- After `handleIdentityConfirmed` resolves the `patient_id`, fetch outstanding items. If zero → keep current branch (card or device_test). If ≥1 → set `step = 'outstanding_items'`.

In the new `OutstandingItems` component:

- Fetches via `/api/patient/outstanding-items` on mount, given `patient_id`, `org.id`, and optional `appointment_id`.
- Header copy:
  - **Has appointment:** `Before your appointment on {formatted date}, here's what to complete.`
  - **No appointment (collection-only):** `Here's what your clinic needs from you.`
- Sub-copy: `Your progress is saved as you go.`
- List items:
  - **Form rows:** Form name, status pill (Not started / In progress / Completed), CTA button "Open" → navigates to `/form/[token]?return=/entry/[entryToken]`. Completed rows show a checkmark and no CTA.
  - **Card row** (if `payments_enabled` and no card on file): "Add card on file" — clicking advances `step = 'card'`.
  - **Device test row** (always for telehealth): "Test camera and microphone" — clicking advances `step = 'device_test'`.
- Footer: "Continue" button → advances to next step (card if needed, else device_test). Disabled while any form item is non-completed (forms are required) — but card and device test are advanced inline by their own row taps.

Returning from `/form/[token]?return=...` lands the patient back on `outstanding_items`, where the API re-queries and the row flips to completed. (See change #4 for the return-URL plumbing.)

### 3. "Progress is saved" copy in form-fill UI

**File:** `src/components/patient/form-fill-client.tsx`

Add a small strip below the page progress bar:

> Your progress is saved as you go.

This is copy-only for this iteration. Actual SurveyJS autosave (persisting partial responses to `form_assignments.responses` on each page change) is a follow-up — flagged in Open Questions.

### 4. Return URL on form-fill

**Files:**
- `src/app/(patient)/form/[token]/page.tsx` (modify)
- `src/components/patient/form-fill-client.tsx` (modify)

- Read `?return=` query param on the form page.
- After successful submission, instead of showing the static "Thank you" screen indefinitely, show it for 1.5s then navigate to the `return` URL if provided. If absent, keep current behaviour.
- This lets the checklist patient bounce back automatically.

### 5. Console-log the intake/form link

**File:** `src/lib/workflows/handlers.ts`

In `handleDeliverForm`, change the existing `[WORKFLOW]` log to also print the URL on its own line so it's grep-able and copy-pastable:

```ts
console.log(
  `[WORKFLOW] deliver_form: sent form '${form.name}' to ${ctx.phoneNumber} (assignment ${assignment.id})`
);
console.log(`[INTAKE LINK] ${url}`);
```

(The full URL is already in the SMS body that the console SMS provider logs, but a dedicated `[INTAKE LINK]` line is much faster to scan during demos.)

## Out of scope / follow-ups

- **SurveyJS autosave.** "Progress is saved" copy is added now but the actual autosave isn't wired. Need a `PATCH /api/forms/fill/[token]` that persists `responses` on each page-change event. Worth doing soon — promising the user something we're not delivering is bad.
- **Intake package route.** The `intake_package` handler (handlers.ts:243) references `/intake/[token]` which doesn't exist. Separate piece of work.
- **Outstanding items outside the entry flow.** No persistent "my forms" page for patients. Out of scope.
- **Card row in checklist when card already on file.** Today we show device_test only when modality is telehealth. The checklist should mirror that — not a new gate, just a derived view of the existing decisions.

## Open questions (resolved)

1. **Where does the outstanding-items fetch happen?** **Resolved: option (a).** Eagerly fetch after identity confirmation in `entry-flow.tsx`, inject the step only if ≥1 form is outstanding. Stepper count stays honest.

2. **Are forms hard-required to continue?** **Resolved: yes, all forms required.** `form_assignments` has no `required` field, so every assignment is treated as required. Continue button stays disabled until all forms are completed. If a "skip" or "required" concept is ever needed, it requires a schema change to `form_assignments`.

3. **Patient identity for the query.** **Resolved: no special-casing needed.** A matched returning patient's `patient_id` drives the query. A brand-new patient has no prior `form_assignments`, so the list is empty and the step is skipped.

## Status

**Built.** The checklist is live in the entry flow after identity. Reads from `form_assignments` via `/api/patient/outstanding-items`. Serves returning patients with outstanding forms.

**Not built:** the `/intake/[token]` route referenced in the "Out of scope" section remains unbuilt. Tracked in `TODO.md` as intake package Phase 7. That's a separate surface for Complete-tier intake package journeys fired by the workflow engine — not a replacement for this checklist.
