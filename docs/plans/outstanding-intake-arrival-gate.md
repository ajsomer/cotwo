# Outstanding Intake Arrival Gate

**Date:** 2026-04-24
**Status:** Proposed, not yet implemented
**Owner role:** Patient (experience), Receptionist (console visibility for demo)

---

## Problem

When a patient clicks their entry link — either the SMS session-entry link or a direct room link — they move straight through phone OTP → identity confirmation → card → device test → waiting room. Nothing checks whether that patient still has an **intake package** outstanding for an upcoming appointment.

The intake package and the arrival flow are two independent paths today. A patient who ignored the intake SMS for a week can still arrive for their appointment with zero forms filled in, the receptionist has no lever to pull, and the clinician only discovers the gap once the call starts.

We need the arrival flow itself to detect outstanding intake items for the verified patient and block progression to the waiting room until the package is finished. The existing intake journey UI (`/intake/[token]`) already supports partial progress and resume-where-you-left-off, so a patient who did half the package earlier picks up exactly where they stopped.

## Non-goals

- **No new intake UI.** We reuse `<IntakeJourney>` unchanged for the gate; the patient sees the same screens and same progress they'd see at `/intake/[token]`.
- **No clinic-side signals yet.** No run-sheet badge, no "patient arrived but intake incomplete" warning on call start. Patient-side gate only.
- **No override yet.** Hard block. The plan leaves a named seam (`overrideAllowed: false`) so a future clinician action can bypass the gate, but no UI or endpoint for override is built here.
- **No extra identity verification.** We trust the phone OTP + contact selection the patient has already done in the entry flow. No DOB match or second factor.
- **No QR check-in coverage.** The gate applies only to the two link-based entries (SMS session entry and room link). QR-code check-in is out of scope for this change.
- **No on-demand gating.** A room-link arrival with no matching patient (or a patient with no outstanding package) passes through as today.
- **No schema changes.** All required data already exists.

## Role notes

This is a patient-facing change. No staff role gating applies to the gate itself — any patient who reaches the identity-confirmed state in the entry flow is subject to the check. The readiness-dashboard console log (see below) is visible only to the server operator running the dev/demo environment.

---

## Design

### Data

No schema changes. The query uses:

- `intake_package_journeys` — one row per (patient, appointment) journey, with `journey_token`, progress fields, and FK to `appointment_actions`.
- `appointment_actions` with `action_type = 'intake_package'` and `status = 'scheduled'` (i.e. the patient has not yet finished the package). A `completed` or `transcribed` status means the patient is done and the gate does not block.
- `appointments.scheduled_at >= now()` — only upcoming appointments count. Past appointments with unfinished packages are not relevant to an arrival happening today.
- `appointments.location_id → locations.org_id` — org scope for cross-org safety.

### Gate query

A patient is "blocked" if they have **any** journey where:

```
intake_package_journeys.patient_id = :patient_id
AND appointment_actions.action_type = 'intake_package'
AND appointment_actions.status = 'scheduled'
AND appointments.scheduled_at >= now()
AND location.org_id = :org_id
```

Ordered by `appointments.scheduled_at ASC`. One patient can have multiple rows returned (multiple upcoming appointments each with an outstanding package); the gate walks them in order, most imminent first.

### Lib

New file: `src/lib/intake/outstanding.ts`

```ts
export type OutstandingJourney = {
  token: string;           // intake_package_journeys.journey_token
  appointmentId: string;
  scheduledAt: string;
  packageTotalItems: number;
  packageCompletedItems: number;
};

export type OutstandingCheck = {
  journeys: OutstandingJourney[];
  overrideAllowed: boolean; // always false in MVP, present for future wiring
};

export async function getOutstandingJourneysForPatient(
  patientId: string,
  orgId: string,
): Promise<OutstandingCheck>;
```

Uses the service-role Supabase client (patient-facing, no staff auth).

### API

New route: `src/app/api/patient/outstanding-intake/route.ts`

- POST `{ patientId, orgId }` → `OutstandingCheck`.
- Called from `entry-flow.tsx` immediately after identity confirmation.
- Service-role backed, same pattern as existing patient-facing API routes.

### IntakeJourney — pre-verified mode

Current behaviour: `<IntakeJourney>` always starts at the `'phone'` phase, does its own OTP + contact selection, then drops into `'checklist'`. That's correct for `/intake/[token]`, but inside the arrival gate the patient has already been identified — we must not make them verify twice.

Add three optional props to `src/components/patient/intake-journey.tsx`:

- `skipIdentity?: boolean` — when true, `deriveInitialPhase` returns `'checklist'` instead of `'phone'`.
- `preConfirmedPatient?: PatientContact` — when provided together with `skipIdentity`, the component's internal `patient` state is initialised from this value and the phone/identity phases are skipped entirely.
- `onAllItemsComplete?: () => void` — called when the component transitions into its `'done'` phase. The standalone `/intake/[token]` page omits this prop and keeps showing the "You're all set" screen exactly as today. The embedded host (entry-flow) passes a callback to advance past the gate.

No other changes to `<IntakeJourney>`. The checklist, card, consent, and form phases are unchanged. The standalone route's UX is unchanged.

### EmbeddedIntakeJourney wrapper

`<IntakeJourney>` requires a heavy `IntakeJourneyContext` prop (org, location, appointment, journey object with forms / card / consent state) which the standalone `/intake/[token]/page.tsx` fetches server-side and hands in. The arrival-flow gate doesn't have that context — `/api/patient/outstanding-intake` returns only a lightweight summary (token + appointment id + progress counts) so the gate decision can be cheap.

To bridge this without forking `<IntakeJourney>` or duplicating its server-side context fetch, add a small client wrapper:

`src/components/patient/embedded-intake-journey.tsx`

```tsx
type Props = {
  token: string;
  preConfirmedPatient: PatientContact;
  onAllItemsComplete: () => void;
};

export function EmbeddedIntakeJourney({ token, preConfirmedPatient, onAllItemsComplete }: Props) {
  // 1. On mount, GET /api/intake/[token] → IntakeJourneyContext.
  // 2. While loading, render the same skeleton the entry flow uses elsewhere.
  // 3. On success, render <IntakeJourney context={...} token={token}
  //                                     skipIdentity preConfirmedPatient={...}
  //                                     onAllItemsComplete={...} />.
  // 4. On fetch error, surface a small error state with a retry button — do NOT
  //    silently advance, since silent failure would defeat the gate.
}
```

The existing `GET /api/intake/[token]` route already returns the exact `IntakeJourneyContext` shape. Reuse it as-is — no new API surface for context fetching.

The entry-flow renders `<EmbeddedIntakeJourney>`, not `<IntakeJourney>` directly. The standalone `/intake/[token]/page.tsx` continues to render `<IntakeJourney>` directly with its server-fetched context — unchanged.

### Entry-flow integration

`src/components/patient/entry-flow.tsx` — add the gate as a new step between identity and the rest of the flow.

Step union becomes:

```ts
type FlowStep =
  | 'primer'
  | 'phone'
  | 'identity'
  | 'outstanding_intake'   // new
  | 'card'
  | 'device_test'
  | 'arriving';
```

Dynamic ordering:

```ts
const steps: FlowStep[] = ['phone', 'identity'];
// 'outstanding_intake' is inserted conditionally at runtime (see below)
if (context.payments_enabled) steps.push('card');
steps.push('device_test');
```

Behaviour on `handleIdentityConfirmed(patient)`:

1. Store `patientId` + `preConfirmedPatient` in component state as today.
2. Show a "Checking your details…" spinner.
3. POST to `/api/patient/outstanding-intake` with `{ patientId, orgId }`.
4. If `journeys.length === 0` → proceed to the next step as today (`'card'` or `'device_test'`).
5. If `journeys.length > 0` → store the ordered list + current index = 0 in state, set step to `'outstanding_intake'`.

Rendering the `'outstanding_intake'` step:

```tsx
<EmbeddedIntakeJourney
  token={journeys[currentIndex].token}
  preConfirmedPatient={preConfirmedPatient}
  onAllItemsComplete={handleJourneyComplete}
/>
```

The wrapper handles the `IntakeJourneyContext` fetch internally (via `GET /api/intake/[token]`) and passes `skipIdentity` to the underlying `<IntakeJourney>`. The entry-flow does not deal with `IntakeJourneyContext` directly.

On `handleJourneyComplete`:

1. Increment `currentIndex`.
2. Re-query `/api/patient/outstanding-intake` as a cheap safety check (another package could have been created while this one was in flight).
3. If `currentIndex < journeys.length` **or** the re-query returns more → re-render with the next journey.
4. Otherwise → advance to `'card'` / `'device_test'`.

Hard block: no skip button in the `'outstanding_intake'` step. The only exit is completion. The stepper UI shows `'outstanding_intake'` as the current step while it's active, so the patient understands they are mid-flow rather than stuck.

### Override seam (not wired)

`OutstandingCheck.overrideAllowed: boolean` is returned from the API but always `false` in MVP. Entry-flow ignores the field. Future work can:

1. Add a clinician action on the run sheet ("bring patient in anyway") that sets e.g. `sessions.intake_override_at`.
2. Have `getOutstandingJourneysForPatient` consult that flag via the session context and return `overrideAllowed: true`.
3. Have entry-flow show a "Your clinician is ready for you now — continue" button when `overrideAllowed` is true.

None of that is built in this plan. The shape exists so a future PR has an obvious slot to plug into.

### Readiness-dashboard console log

In the readiness-dashboard handler that creates an `intake_package_journey` for a newly added patient, add one `console.log` line with the room URL the dev operator can use to test the gate end-to-end:

```
[intake] journey created for <patient name>: http://localhost:3000/entry/<room.link_token>?room=<room.slug>
```

One log line only. The format must match the existing room-link URL shape used in-app. The exact handler location and the source of `room.slug` will be confirmed during implementation (grep for the journey-creation call in the readiness flow).

---

## What the patient sees

1. Click room link or SMS entry link → primer → phone OTP → identity confirm.
2. Brief "Checking your details…" spinner.
3. **If outstanding package exists:** the standard intake journey UI renders, already past its own identity step, showing the checklist with the items they've completed greyed out and the outstanding items actionable. They complete the remaining items.
4. When the final item is marked complete, the gate advances automatically — either to the next outstanding journey (if they had more than one upcoming appointment with a package) or to the usual card / device test / arriving flow.
5. **If no outstanding package:** the flow is identical to today; the patient doesn't see the gate.

There is no "skip for now" affordance. A patient who closes the tab mid-gate re-enters the gate the next time they click the link.

## What the clinic sees

Nothing changes in this plan. The run sheet, readiness dashboard, and clinician view are untouched. The existing readiness-dashboard "Form Completed" / transcription handoff continues to drive the post-completion clinic workflow as today.

The only clinic-facing addition is the dev-console log described above, which is invisible in a real deployment and exists only so the demo operator can click through the gate.

## Implementation order

1. Add `skipIdentity` / `preConfirmedPatient` / `onAllItemsComplete` props to `<IntakeJourney>`. Verify the standalone `/intake/[token]` route still works unchanged.
2. Add `src/lib/intake/outstanding.ts` + `src/app/api/patient/outstanding-intake/route.ts`. Unit-verify the query returns correct rows for a seeded patient with and without an outstanding package.
3. Add `src/components/patient/embedded-intake-journey.tsx` (fetches `IntakeJourneyContext` via existing `GET /api/intake/[token]` and renders `<IntakeJourney>` with the pre-verified identity).
4. Add the `'outstanding_intake'` step to `entry-flow.tsx` with the fetch + render + advance behaviour, rendering `<EmbeddedIntakeJourney>`. Manually verify both link types (SMS entry, room link) gate correctly.
5. Add the `console.log` in the readiness-dashboard journey-creation handler.
6. End-to-end demo walk-through: create an appointment with an intake package, click the room link from the logged URL, confirm the gate fires, complete the package, confirm the flow advances into card / device test / waiting room.

## Open questions

- Exact source of `room.slug` in the console log URL — confirm at implementation time whether it's a dedicated column, derived from the room name, or already present on the room record.
- Whether the "Checking your details…" spinner is a dedicated state in the step machine or a transient overlay on the `'identity'` step. Minor UX call; default is a transient overlay.
