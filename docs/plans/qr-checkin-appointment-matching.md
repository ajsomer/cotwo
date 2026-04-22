# QR Code Check-In: Appointment Matching

## Problem

When a patient scans the location QR code at the clinic, the entry flow today resolves the QR token → location → runs them through phone OTP and identity, then `/api/patient/arrive` creates a brand-new on-demand session. This is wrong for in-person check-in: the patient already has a scheduled appointment, and the receptionist expects that appointment's row on the run sheet to flip to `checked_in`, not for a parallel on-demand session to appear.

The token resolution and OTP/identity flow already work for QR entries (`src/app/(patient)/entry/[token]/page.tsx` — case 3, returns `entry_type: 'qr_code'`). The arrival/matching step is the gap.

## Goals

1. After identity confirmation in a QR entry, look up the patient's scheduled appointment at this location for today and match.
2. If an appointment matches, transition that appointment's session to `checked_in` (and the appointment to `arrived`). Do not create a new on-demand session.
3. If no appointment matches, show a "We can't find your appointment, please see reception" screen. Do not silently fall through to on-demand.
4. Multi-contact resolution behaves the same as today — picker for the patient → match on the chosen patient.

## Non-goals

- Changing how SMS-link or on-demand entries work.
- PMS write-back for the `arrived` status — the receptionist's run sheet is the source of truth for the demo. (Cliniko-side flagged as a follow-up.)
- Building a "running late" patient-facing message on the in-person check-in screen.

## Match rules (from scoping)

- **Window:** patient has an appointment at this location with `scheduled_at` within ±30 min of `now`.
- **Multiple matches:** auto-pick the earliest by `scheduled_at` (oldest-first within the window).
- **No match:** show "Please see reception."
- **Status:** matched session → `checked_in`. Matched appointment → `arrived`.
- **Modality filter:** only match in-person appointments. If the patient's only appointment in the window is telehealth, treat it as no match (they shouldn't be physically at the clinic for a telehealth booking — that's a "see reception" case).

## Approach

The QR flow already lands the patient at the same `EntryFlow` component as SMS/on-demand, with `context.entry_type === 'qr_code'`. We branch in two places:

1. After identity is confirmed in QR mode, call a new endpoint that finds the matching appointment and its session. If matched, store the `session_id` in flow state. If not, transition to a new `'no_appointment'` step that renders the "see reception" screen.
2. The arrive call already accepts `session_id` and transitions it to `checked_in` (when modality is `'in_person'`). We pass the matched session_id through. The appointment's status update to `arrived` is added to the arrive endpoint when the matched session has an `appointment_id`.

QR mode also doesn't include the device_test step (in-person — no camera/mic check needed). Card capture stays gated by `payments_enabled`.

## Changes

### 1. New API: `POST /api/patient/qr-match`

**File:** `src/app/api/patient/qr-match/route.ts` (new)

Inputs:
```ts
{
  patient_id: string;
  location_id: string;
}
```

Outputs:
```ts
// Match found
{
  matched: true;
  session_id: string;       // session belonging to the matched appointment
  appointment_id: string;
  scheduled_at: string;
  clinician_name: string | null;
}

// No match
{
  matched: false;
  reason: 'no_appointment_in_window' | 'no_session_for_appointment';
}
```

Logic (service-role client):

1. Query `appointments` for this patient + this location:
   - `patient_id = :patient_id`
   - `location_id = :location_id`
   - `modality = 'in_person'`
   - `scheduled_at BETWEEN now - 30min AND now + 30min`
   - `status NOT IN ('completed', 'cancelled', 'no_show')`
   - Order by `scheduled_at ASC`, take first.
2. If none → `{matched: false, reason: 'no_appointment_in_window'}`.
3. Find the existing `sessions` row for that `appointment_id` (created by morning scan).
   - If missing (e.g. patient walked in before morning scan ran) → still create the session here from the appointment, status `queued`. We then pass it through to `/api/patient/arrive` for the normal `checked_in` transition. Better to recover than reject.
4. Return `session_id` and appointment metadata.

### 2. Update `POST /api/patient/arrive` to also flip the appointment

**File:** `src/app/api/patient/arrive/route.ts`

Add: when `modality === 'in_person'` and the session has an `appointment_id`, also update `appointments.status = 'arrived'` (and `appointments.arrived_at = now()`).

Existing behaviour for telehealth is unchanged.

### 3. Wire QR mode into `EntryFlow`

**File:** `src/components/patient/entry-flow.tsx`

- Add `'no_appointment'` to the `FlowStep` union.
- When `context.entry_type === 'qr_code'`:
  - The `steps` array becomes `['phone', 'identity']` plus `'card'` if `payments_enabled` (most QR-entry locations won't need card; the resolver still gates this on the location's stripe account being configured).
  - **Skip device_test** — irrelevant for in-person.
  - After `handleIdentityConfirmed`:
    - Call `/api/patient/qr-match` with `patient_id` and `location_id`.
    - If `matched: true` → set `sessionId` and continue to `'card'` (if needed) or directly to `'arriving'`.
    - If `matched: false` → set `step = 'no_appointment'`.
- The arriving handler already passes `modality: 'in_person'` for in-person flows; we'll need to differentiate. Today it hardcodes `'telehealth'`. Add `modality: context.entry_type === 'qr_code' ? 'in_person' : 'telehealth'`.
- The waiting-room redirect at line 145 (`status === 'waiting' || 'in_session'`) shouldn't fire for `checked_in` sessions — verify it doesn't, or add an explicit "you're checked in" terminal screen for QR entries instead of routing to `/waiting/...`.

### 4. New component: `NoAppointmentScreen`

**File:** `src/components/patient/no-appointment-screen.tsx` (new)

Standalone screen — no stepper:
- Header with clinic logo, clinic name (no room name — QR has no room).
- Title: "We can't find your appointment"
- Body: "Please see reception. They can help you check in or book a new appointment."
- No CTA button — patient should walk to reception.

### 5. New component: `CheckedInConfirmation`

**File:** `src/components/patient/checked-in-confirmation.tsx` (new)

Shown after a successful match + arrive — replaces the telehealth `/waiting/[token]` redirect for in-person:
- Header (clinic logo + name).
- Big checkmark.
- Title: "You're checked in"
- Body: `Dr {clinician_name} will see you shortly.` (Or `A clinician will see you shortly.` if name is null.)
- Optional: scheduled time pill ("Your appointment is at 2:30pm").
- No CTA — terminal screen.

`EntryFlow.handleDeviceTestComplete` (which today runs the arrive call for telehealth) needs an in-person sibling — a new handler that runs after identity (or after card capture, if applicable), calls arrive, and on success sets `step = 'checked_in_confirmation'`.

## Open questions

1. **What happens if the patient already has a *checked_in* session (they scanned the QR twice)?** Plan: `qr-match` returns the existing session; the arrive endpoint becomes idempotent for an already-checked-in session (no-op on status, just re-render the confirmation screen). Confirm.

2. **Card capture before check-in?** For in-person, capturing a card *after* check-in is more typical (e.g. at the consult or post-consult). But the existing flow puts card before arrive. I've kept that for consistency. Confirm — or move card to a post-consult step (out of scope here).

3. **No-match → reception fallback.** Does "Please see reception" need a session record at all? My plan: no — we don't create one. The receptionist will manually add it via the run sheet's "+ Add session" flow if the patient really should be seen. Alternative: silently create a `queued` on-demand session and let reception process. I'd avoid that — too magic, and pollutes the run sheet.

4. **Telehealth appointment within the window** (patient at the clinic for a telehealth booking — wrong venue). I've drafted this as a `no_appointment` outcome (treated as no match). Is that correct, or should we surface a more specific "Your appointment with Dr X is telehealth — you don't need to be at the clinic" message? Simpler to treat as no match for now.

## Testing plan

- Seed an in-person appointment for today within the next 30 min.
- Open QR URL → OTP → identity → assert appointment is matched, session flips to `checked_in`, appointment to `arrived`, run sheet shows it correctly, "You're checked in" screen renders.
- Same flow but no appointment exists → "Please see reception" screen.
- Same flow but only telehealth appointment exists → "Please see reception".
- Same flow but appointment is 45 min away → "Please see reception" (outside window).
- Multi-contact phone (two patients) → picker → choose one → match runs against the chosen patient.
- Re-scan after already checked in → still resolves to the same session, lands on "You're checked in".
