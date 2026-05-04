# Feature: Readiness Dashboard ("Tasks")

Complete-tier only. The receptionist's pre-appointment punch list. Surfaces every outstanding pre-appointment item across the practice so nothing slips through the cracks: forms not filled in, cards not on file, intake packages waiting on the patient, completed packages waiting on transcription.

This doc summarises behaviour and points at the spec for full detail.

> **Naming note:** the sidebar item was recently renamed from "Readiness" to "Tasks." The URL (`/readiness`) and all internal code (Zustand store slice, types, components, API routes, broadcast channels) still use `readiness`. Don't try to rename them; the user-facing label is the only thing that changed.

---

## What the dashboard is

A clinic-side page at `/readiness` (rendered as "Tasks" in the sidebar) that lists every appointment with at least one outstanding pre-appointment item, ordered by priority. The receptionist works through the list throughout the day: chasing late forms, capturing missing cards, transcribing completed intake packages into the PMS, deleting cancelled appointments.

The dashboard is **always scoped to the selected location**. Switching locations swaps the data and the real-time subscription. Same pattern as the run sheet.

It also has a **direction toggle**: pre-appointment vs post-appointment. Pre-appointment surfaces things that need to happen before the visit (the most common case). Post-appointment surfaces things that need to happen after (PROMs not returned, follow-up resources not sent, rebooking nudges not actioned). The two views share a layout but draw from different data slices.

## Priority calculation

The readiness priority hierarchy (descending urgency) is computed in `src/lib/readiness/derived-state.ts`:

1. **Failed actions.** Anything where a workflow action has gone to `failed` status. The receptionist needs to investigate and resolve.
2. **Intake package needs transcription.** A patient has finished their intake package (`intake_package_journeys.status = 'completed'`) but the receptionist hasn't transcribed it into the PMS yet. Transcription state is tracked on the corresponding `intake_package` row in `appointment_actions`: completed-not-transcribed shows as `status = 'completed'`, transcribed shows as `status = 'transcribed'`. (There is no `transcribed_at` column on the journey; the action status is the source of truth.) This is hardcoded second-highest because transcription is time-bound; a completed package waiting too long is operational debt.
3. **At risk.** The appointment is approaching (within some window, configurable per workflow) and the patient still has outstanding items.
4. **In progress.** The patient is engaging with the package or forms but hasn't finished. Lowest urgency; no action needed yet.
5. **Done (within view).** Items completed and either transcribed or not transcription-relevant. Visible only when the receptionist toggles "show all," because they're not actionable.

The priority is computed at render time, like run sheet derived state. Not stored.

## Add patient flow

Receptionists can add a patient to the readiness dashboard directly: `+ Add patient` button in the header opens a slide-over panel.

Captures:

- First name, last name, DOB.
- Mobile number.
- Appointment type.
- Room (if the appointment type's terminal type is `run_sheet`; collection-only types skip this).
- Scheduled time (same conditional).

On submit, the route handler:

1. Looks up the appointment type's workflow template.
2. Either finds an existing matching patient (phone + DOB + org) or creates a new one.
3. Creates the appointment row.
4. Schedules workflow actions for the appointment (this is when SMS gets sent, intake packages get created, etc.).
5. Returns the fired actions so the client can surface the URLs to the operator (since SMS is stubbed).

There's also a console log on the server side that prints the room URL for the added patient. This is a prototype helper for the demo operator: the patient added to readiness gets a room URL that, when visited, triggers the outstanding intake gate. See `feature-patient-entry-flow.md`.

## Intake package transcription handoff

The most substantive feature on the readiness dashboard. When a patient completes their intake package, the receptionist needs to:

1. See that the package is complete.
2. Open the package and review the forms, card capture, and consent.
3. Type or copy the data into the PMS.
4. Mark the package as transcribed.

The handoff has its own UI panel (the `IntakePackageHandoffPanel` component) that opens from the appointment row. It shows:

- Each form's submitted answers.
- Card on file status (last four, brand).
- Consent status.

The "Mark as transcribed" button flips the corresponding `appointment_actions` row from `status = 'completed'` to `status = 'transcribed'` (via `/api/readiness/mark-intake-transcribed`) and emits a `readiness_changed` Socket.io event into the appointment's location room so other open dashboards refresh.

A transcribed package no longer surfaces as a pre-appointment task; the appointment may still appear in the dashboard for other reasons (a remaining `add_to_runsheet` action that hasn't fired yet, etc.) but the intake-driven priority drops.

For the design and rationale see `docs/plans/intake-package-transcription-handoff.md`.

## Patient detail panel

Clicking any row opens a slide-over panel showing patient details, the appointment workflow timeline, completed forms, and (for readiness mode) the delete-appointment affordance.

The panel is a shared component (`PatientContactCard`) used in both readiness and run sheet contexts; the `appointment` prop being present is what flips it into "readiness mode" with the workflow timeline and completed forms sections.

Receptionists can:

- Resend a form SMS.
- View a submitted form's responses.
- Delete the appointment (cancels the workflow, removes the appointment).

Soft-deactivating an appointment is not a current pattern; deletion is hard-delete with a confirm.

## Real-time updates

The readiness dashboard listens for `readiness_changed` events on the shared `location:{selected_location_id}` Socket.io room (the same room the run sheet uses; see `conventions-realtime-and-state.md` for the room/event model). The clinic data provider fans this event into the Zustand readiness slice's `refreshReadiness(locationId)` action, which re-fetches the dashboard's data.

There is *one* event name, `readiness_changed`. The broadcast helper (`broadcastReadinessChange`) takes a free-form event tag (`package_completed`, `action_resolved`, `appointment_added`, `appointment_deleted`, etc.) as a payload field, but the dispatched Socket.io event name is always `readiness_changed`. The receiving client doesn't currently switch on the tag — it just refetches. If you need finer-grained reconciliation later, the tag is already on the wire.

If Socket.io drops, the dashboard falls back to polling.

For the design see `docs/plans/readiness-live-updates-socketio.md`.

## What's deliberately not here

- **No bulk actions.** Each task is per-appointment; bulk doesn't fit the receptionist's mental model.
- **No clinician view.** Clinicians don't see this dashboard.
- **No client-side filtering beyond the direction toggle.** Search and date filters might come later but are not part of the MVP.

## Where to look

- **Page:** `src/app/(clinic)/readiness/page.tsx`.
- **Shell component:** `src/components/clinic/readiness-shell.tsx`.
- **Derived state and priority:** `src/lib/readiness/derived-state.ts`.
- **Fetcher:** `src/lib/clinic/fetchers/readiness.ts`.
- **Add-patient route:** `src/app/api/readiness/add-patient/route.ts`.
- **Mark-intake-transcribed route:** `src/app/api/readiness/mark-intake-transcribed/route.ts`.
- **Intake handoff panel:** `src/components/clinic/intake-package-handoff-panel.tsx`.
- **Plan files:**
  - `docs/plans/intake-package-transcription-handoff.md`
  - `docs/plans/readiness-live-updates-socketio.md`

## Related docs

- `feature-tiers-and-roles.md` for the role and tier visibility (Complete only, admin and receptionist roles).
- `feature-workflow-engine.md` for the action-status terminal states this dashboard reads.
- `feature-intake-package.md` for the package lifecycle and the transcription handoff in detail.
- `feature-patient-entry-flow.md` for the outstanding intake gate that the readiness console log helps test.
- `conventions-realtime-and-state.md` for the broadcast pattern this dashboard follows.
