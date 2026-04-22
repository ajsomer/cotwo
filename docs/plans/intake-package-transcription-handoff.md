# Intake Package Transcription Handoff

**Date:** 2026-04-21
**Status:** Proposed, not yet implemented
**Owner role:** Receptionist (primary), Practice Manager (secondary). **Not clinicians.** Transcription is the manual PMS-handoff process — receptionists and practice managers copy form answers out of Coviu and into the clinic's PMS. Clinicians never touch this flow.

---

## Problem

When the patient completes their intake package, the readiness row currently stays in **In progress** because one or more workflow actions (typically `add_to_runsheet`) are still scheduled for the future. The receptionist has no signal that the forms are ready to review, and no surface to view the submitted answers so they can type them into the clinic's PMS.

We need:
1. A readiness-dashboard state that surfaces "the patient has completed their intake package — the receptionist should review the form(s) and copy them into the PMS" as soon as the journey is marked complete, independent of whether `add_to_runsheet` has fired.
2. A panel that shows every completed form's responses (one panel per appointment, potentially multiple forms inside) plus card-on-file and consent status, so the receptionist has the full context.
3. A **Mark as transcribed** action that flips the journey row so the appointment returns to **In progress** (waiting on `add_to_runsheet` / the session to happen naturally).
4. The appointment must **not** disappear from readiness when transcribed — only the intake-package-driven "Form Completed" signal goes away. The appointment continues through the workflow as normal until the run-sheet session completes.

## Non-goals

- **No changes to `add_to_runsheet`.** It fires at appointment time regardless of whether the intake package has been transcribed. The calendar event exists independent of the handoff state.
- **No re-open of a transcribed journey.** Once `transcribed_at` is set on `intake_package_journeys`, it stays set. The patient cannot submit new data against that journey (the existing `/api/intake/[token]/complete-item` endpoint already rejects when `status = 'completed'`, so this is implicit — no further code needed).
- **No migration of existing `deliver_form` actions.** Legacy orgs still built on `deliver_form` keep the existing `action.status = 'transcribed'` flow. This plan adds a parallel path for intake-package-based workflows.
- **Clinicians are not involved.** Do not surface transcription actions on the clinician view, and do not use "clinician" framing in any copy. The Review button appears on the receptionist + practice manager readiness dashboard.
- **Partial transcription is not supported.** The Mark as transcribed action is all-or-nothing for the package. The panel shows everything at once so the receptionist reviews in one sitting.

## Role notes

The readiness dashboard is already scoped by role in the navigation hierarchy (visible to Receptionist and Practice Manager in Complete tier, per `CLAUDE.md`). No additional role gating is required for the new action — anyone who can open readiness can open the handoff panel and mark transcribed. If the spec reviewer wants tighter gating (e.g. PM-only mark-transcribed), call it out explicitly; otherwise the default is: Receptionist and Practice Manager both have full access.

---

## Design

### Data model

Add one column, no new tables.

```sql
-- Migration: supabase/migrations/0NN_intake_package_transcribed.sql
ALTER TABLE intake_package_journeys
  ADD COLUMN transcribed_at TIMESTAMPTZ;

COMMENT ON COLUMN intake_package_journeys.transcribed_at IS
  'Set when a receptionist or practice manager marks the package as '
  'transcribed via the readiness dashboard handoff panel. NULL means '
  'the package still needs PMS handoff. Flipping this field removes '
  'the appointment from the Form Completed readiness slot.';
```

- Regenerate `src/lib/supabase/types.ts` (`npx supabase gen types typescript --project-id <id>`) or patch by hand to add `transcribed_at: string | null` to the Row/Insert/Update shapes.
- Pick the next free migration number at the time of implementation (likely `019` if onboarding hasn't landed yet, otherwise the next one up).

### Derived state

`src/lib/readiness/derived-state.ts`:

1. Add a new predicate:
   ```ts
   export function isIntakePackageNeedsTranscription(
     appointment: ReadinessAppointment
   ): boolean {
     return (
       appointment.package_status === 'completed' &&
       !appointment.package_transcribed_at
     );
   }
   ```
2. In `getReadinessPriority`, evaluate this predicate before the existing `isFormNeedsTranscription` (deliver_form) branch. Both land in the same slot (`form_completed_needs_transcription`). The row's priority is the highest-severity state across actions **and** package state.
3. Extend `getTriggeringActions` to return an empty array when the trigger is the package (there are no "triggering actions" — the package itself is the trigger). **Heads up:** `PatientRow` in `readiness-shell.tsx` currently hides the expanded timeline wrapper when `displayedActions.length === 0`, which means an empty array will make the auto-expanded row look blank. The implementation must add an explicit branch inside `PatientRow`: when `priority === 'form_completed_needs_transcription'` and the appointment is package-driven (`package_status === 'completed'`), render a single package-level summary timeline node instead of iterating actions. Use the journey's `completed_at` for the timestamp and the form count + card/consent flags for the body.
4. Extend sort logic: for intake-package-driven rows in the Form Completed slot, sort by `journey.completed_at` ascending (oldest first). Fall back to the existing form-action sort for deliver_form rows.

### `GroupedAppointment` / `ReadinessAppointment` shape

Add fields:
- `package_transcribed_at: string | null`
- `package_completed_at: string | null` (for sorting)

Populate in `src/lib/clinic/fetchers/readiness.ts` from the existing `journeyMap`:
```ts
package_status: journey?.status ?? null,
package_completed_at: journey?.completed_at ?? null,
package_transcribed_at: journey?.transcribed_at ?? null,
```

`src/stores/clinic-store.ts` — add the two fields to the `ReadinessAppointment` interface, matching the API shape.

### All-terminal check

`getReadinessPriority`'s `allTerminal` short-circuit currently returns `'recently_completed'` when every action is terminal. This needs to defer to the intake-package-needs-transcription branch first — otherwise a fully-terminal action list will hide a still-untranscribed package. Order:

1. `isIntakePackageNeedsTranscription(appt)` → `form_completed_needs_transcription`
2. `allTerminal` → `recently_completed`
3. overdue / form / at_risk / in_progress

### API routes

**`POST /api/readiness/mark-intake-transcribed`** — new endpoint. Thin RLS-bypass route (service client, same pattern as the sibling mark-transcribed).

Body: `{ appointment_id: string }`.

Behaviour:
1. Look up `intake_package_journeys` by `appointment_id`.
2. Reject (400) if not found, or `status !== 'completed'`, or `transcribed_at` already set.
3. Update `transcribed_at = now()`.
4. Return `{ success: true, transcribed_at }`.

No change to appointment_actions. Marking transcribed does not cancel or skip any scheduled action — `add_to_runsheet` still fires on time.

**`GET /api/readiness/intake-handoff?appointment_id=X`** — new endpoint. Returns everything the handoff panel needs in one shot.

Response shape:
```ts
{
  appointment: {
    id: string;
    scheduled_at: string | null;
    patient_first_name: string;
    patient_last_name: string;
  };
  journey: {
    id: string;
    status: string;
    completed_at: string | null;
    transcribed_at: string | null;
  };
  forms: Array<{
    form_id: string;
    form_name: string;
    submitted_at: string | null;   // from form_submissions
    fields: Array<{ label: string; value: string }>;
  }>;
  card: { brand: string; last_four: string; captured_at: string } | null;
  consent: { completed_at: string } | null;
}
```

The fields-flattening logic can mirror `/api/readiness/form-submission` (used by the existing `FormHandoffPanel`). The existing route defines an `extractFieldsFromSchema` helper inline — factor it out into a shared util (e.g. `src/lib/forms/extract-fields.ts`) and call it from both routes. Trivial refactor, avoids divergence as the form schema shape evolves.

### UI

**New component:** `src/components/clinic/intake-package-handoff-panel.tsx`.

Props:
```ts
{
  appointmentId: string;
  patientName: string;
  onClose: () => void;
  onTranscribed: () => void;
}
```

Layout (reuse patterns from `FormHandoffPanel`):
- Slide-over, 420px width.
- Header: "Intake package completed — [patient name]". Subtitle: submitted timestamp.
- Body sections (in order):
  1. **Forms.** One block per form. Label/value rows with per-field copy and "Copy all" at the top of each form. If multiple forms, each is its own collapsible-ish block (or just stacked with a separator).
  2. **Card on file.** One-liner: "Visa ending 4242 — captured 15:04". Hidden if no card.
  3. **Consent.** One-liner: "Consent recorded 15:03". Hidden if no consent.
- Footer: "Back" (secondary) + "Mark as transcribed" (primary teal).

Clicking "Mark as transcribed" calls `POST /api/readiness/mark-intake-transcribed`, closes the panel on success, and invokes `onTranscribed()` which triggers a readiness refresh in the parent.

**`src/components/clinic/readiness-shell.tsx`:**
- In `handleActionButton`, when `priority === 'form_completed_needs_transcription'`, decide which panel to open:
  - If `appointment.package_status === 'completed'` → open `IntakePackageHandoffPanel`.
  - Else fall back to the existing `FormHandoffPanel` branch (deliver_form legacy).
- Add the new panel type to `ActivePanel`:
  ```ts
  | { type: "intake-handoff"; appointment: ReadinessAppointment }
  ```
- Render it in the same place the existing panels are rendered.
- Dynamic-import the new component the same way `FormHandoffPanel` is imported.
- **`PatientRow` empty-timeline fix:** the row currently hides its expanded-timeline wrapper when `displayedActions.length === 0`, so `getTriggeringActions` returning `[]` (see the derived-state section) will blank the row. Add a branch: when the priority is `form_completed_needs_transcription` and the appointment is package-driven, render a single package-level summary timeline node. Suggested body: "Intake package completed · N form(s) · card on file / consent recorded / none" plus the journey's `completed_at` timestamp. The whole node is clickable and opens the handoff panel (same target as the Review button).

**Copy.** Do not use "clinician" anywhere. Use "you" or role-neutral phrasing. The existing panel already does this — match that tone.

### No realtime changes required

The readiness store already subscribes to `intake_package_journeys` updates (via the Realtime publication added in migration 014). When `transcribed_at` flips, the existing subscription refetches and the priority re-derives client-side. Nothing new to wire.

---

## Edge cases

| Scenario | Behaviour |
|---|---|
| Patient completes all items → `status = 'completed'`, `transcribed_at = null` | Row enters **Form Completed** slot. Review button opens handoff panel. |
| Receptionist marks transcribed | `transcribed_at` set. Row drops to **In progress** until `add_to_runsheet` fires. |
| `add_to_runsheet` fires before transcription | Session appears on run sheet as normal. Readiness row still shows Form Completed until transcribed. Session and package transcription are orthogonal. |
| `add_to_runsheet` fires after transcription | Session appears on run sheet as normal. Readiness row flips to **recently_completed** once all workflow actions are terminal. |
| Multiple forms in one intake package | Panel renders all of them in one scroll. Single Mark as transcribed action covers everything. |
| Card capture included but not used by journey config | Section hidden in panel. |
| Package completed but clinic has no Stripe | Card section hidden — no card was ever captured. |
| Partial completion (`status = 'in_progress'`) | Row stays in its current priority. Review button does not appear. Panel never opens. |
| Patient tries to resubmit after transcription | Already impossible — `/api/intake/[token]/complete-item` rejects when `status = 'completed'`. The transcribed_at flag adds no new surface area. |
| Receptionist opens the panel after already transcribing (race condition) | API rejects with 400. Panel surfaces error and closes. |
| Legacy deliver_form actions on the same appointment | The existing logic still runs. If both `isFormNeedsTranscription` and `isIntakePackageNeedsTranscription` are true, the intake package takes precedence (it's the newer model). Review button opens the intake package panel; the receptionist can also handle any `deliver_form` rows via the existing flow once intake package is done. In practice, a single workflow template won't mix both models. |

---

## Implementation checklist

1. [ ] Add migration: `ALTER TABLE intake_package_journeys ADD COLUMN transcribed_at TIMESTAMPTZ`.
2. [ ] Regenerate `src/lib/supabase/types.ts`.
3. [ ] Extend `GroupedAppointment` + `ReadinessAppointment` with `package_transcribed_at`, `package_completed_at`.
4. [ ] `src/lib/clinic/fetchers/readiness.ts` — select + populate new fields.
5. [ ] `src/lib/readiness/derived-state.ts` — add `isIntakePackageNeedsTranscription`, wire into `getReadinessPriority` before the `allTerminal` check, update sort.
6. [ ] `POST /api/readiness/mark-intake-transcribed` — new route.
7. [ ] `GET /api/readiness/intake-handoff?appointment_id=X` — new route.
8. [ ] `src/components/clinic/intake-package-handoff-panel.tsx` — new component.
9. [ ] `src/components/clinic/readiness-shell.tsx` — fork the Review button path AND add the package-level summary timeline node inside `PatientRow` (the row blanks out otherwise — see derived-state section and UI section notes).
10. [ ] Verify: create intake package → patient completes all items → row enters Form Completed → panel renders all forms → Mark as transcribed → row drops to In progress → `add_to_runsheet` fires later → row eventually drops to recently_completed.
11. [ ] Verify no regression on legacy `deliver_form`-based review flow.
12. [ ] `npm run build` and `npm run lint` clean.

## Files to touch

**New:**
- `supabase/migrations/0NN_intake_package_transcribed.sql`
- `src/app/api/readiness/mark-intake-transcribed/route.ts`
- `src/app/api/readiness/intake-handoff/route.ts`
- `src/components/clinic/intake-package-handoff-panel.tsx`

**Modified:**
- `src/lib/supabase/types.ts` (regenerated)
- `src/lib/clinic/fetchers/readiness.ts`
- `src/lib/readiness/derived-state.ts`
- `src/stores/clinic-store.ts`
- `src/components/clinic/readiness-shell.tsx`

**Unchanged (explicit):**
- `src/lib/workflows/*` (no handler changes; `add_to_runsheet` fires as normal)
- `src/components/patient/intake-journey.tsx` (patient side untouched)
- `src/app/api/intake/[token]/complete-item/route.ts` (existing `status = 'completed'` rejection already handles resubmission)
- `src/app/api/readiness/mark-transcribed/route.ts` (legacy deliver_form path)
- `src/components/clinic/form-handoff-panel.tsx` (legacy deliver_form panel)
