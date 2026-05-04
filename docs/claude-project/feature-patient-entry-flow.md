# Feature: Patient Entry Flow

The unified arrival sequence shared across all entry points. SMS link, room link, QR code: all four entry points (see `01-core-concepts.md`) converge on the same component (`entry-flow.tsx`) and the same six steps. The entry point only changes the URL token and the starting context.

This doc summarises behaviour and points at the spec for full detail.

---

## The unified flow

The patient lands on `/entry/[token]` (with optional `?room=` query param for room-link entries) or `/intake/[token]` (intake package journeys) or scans a QR code that resolves to a session-creation step before joining the entry flow.

Whichever entry point they came through, after the primer landing screen the patient moves through six steps:

1. **Phone OTP.** Verify ownership of the phone number. Pre-filled from the appointment's stored phone number when known.
2. **Identity confirmation.** New patient, returning single-contact, returning multi-contact, or "someone else" (capture a new contact on this phone).
3. **Outstanding intake gate.** If this patient has an unfinished intake package for an upcoming appointment in this org, route them through the intake journey before continuing.
4. **Card capture.** Stripe Elements; skipped if the location has no payments.
5. **Device test.** Camera, microphone, network. Currently always included by `entry-flow.tsx` regardless of modality, and the `arrive` endpoint always sends `modality: 'telehealth'` — meaning the in-person QR-code path doesn't actually exit through this flow today. Conditional skipping by modality is the intended design once in-person arrive lands.
6. **Arrive.** Telehealth → virtual waiting room. In-person → "you're checked in" confirmation (intended; not yet reachable via this flow).

Steps that don't apply (card capture when payments are off, outstanding intake when nothing is pending) are skipped. The displayed step count in the persistent header is dynamic.

The primer screen is a landing page before the numbered stepper begins, not a step. It explains what's coming and sets expectations around card capture if applicable.

## Entry types and how they branch

Three entry types, resolved on the server in `src/app/(patient)/entry/[token]/page.tsx`:

- **`session`**: token is a `sessions.entry_token`. Used for SMS-driven session entries (Core one-shot SMS or Complete workflow-driven SMS). The entry flow has full appointment context.
- **`on_demand`**: token is a `rooms.link_token`. Used for room-link entries. No appointment exists; the session is created at the end of the flow when the patient clicks "arrive."
- **`qr_code`**: token is a `locations.qr_token`. Used for in-person QR check-in (Complete only). The phone OTP step matches the patient against an existing appointment at this location for today.

Each type sets up a different starting context but feeds the same `<EntryFlow>` component.

## Persistent header

Every patient-side screen renders the persistent header:

- Clinic logo (from `organisations.logo_url`).
- Clinic name.
- Room name (telehealth always; in-person only on the final confirmation screen, because in-person patients haven't been routed to a specific room until check-in completes).
- Dynamic step indicator (`Step X of N`).

The header is part of the patient-side layout (`src/app/(patient)/layout.tsx`) and is the only chrome on a 420px-max-width column.

## The outstanding intake gate

A relatively new step (Phase 9 of the intake package work) that prevents a patient with an unfinished intake package from reaching the waiting room.

After identity confirmation, the flow checks whether the verified patient has any `intake_package_journeys` rows where:

- `patient_id` matches the verified patient.
- The journey's `status` is not `completed`.
- The associated appointment's `scheduled_at` is in the future (or the journey is for a `collection_only` package without a scheduled appointment).
- The journey's organisation matches the entry org.

If any are outstanding, the flow renders the existing intake journey UI inside the entry flow (via `<EmbeddedIntakeJourney>`, which fetches the full `IntakeJourneyContext` from `GET /api/intake/[token]` and passes the verified identity in via `skipIdentity` and `preConfirmedPatient`). The patient completes the package, the gate re-checks, and either moves to the next outstanding journey or advances to card capture.

The gate is a **hard block**: the only way past it is journey completion. There is a future seam for clinician override (`overrideAllowed: false` in the API response), but no UI for it yet.

The gate covers both link-based entries (SMS session entry and room link). QR check-in is currently out of scope for the gate.

For full detail see `docs/plans/outstanding-intake-arrival-gate.md`.

## On-demand vs scheduled

On-demand entries (room link) have no appointment, no scheduled time, no pre-filled phone. The flow is identical except:

- The phone OTP step has no prefill.
- The identity confirmation handles the case where the phone has *no* contacts in this org (new patient).
- The session is created at the end of the flow, not at the start. The arrive endpoint (`/api/patient/arrive`) takes `room_id` and `location_id` in the body and creates the session inline.

Scheduled entries (SMS session token, QR code) have an appointment and the session was spawned at run sheet build time. The arrive endpoint just flips the existing session's status.

## Identity confirmation in detail

The most complex step. Four branches based on the OTP result:

1. **No contacts on this phone in this org**: render a capture form (first name, last name, date of birth). The form creates a new `patients` row and a `patient_phone_numbers` row.
2. **One contact**: render a confirmation screen (`Hi [Name], is this you?`).
3. **Multiple contacts**: render a picker. Patient selects which contact this visit is for.
4. **Always available: "Someone else."** Captures a new contact on the same phone number, supporting the multi-patient-per-phone case (parent's phone with several children).

The selected/created patient is the one used by the rest of the flow (card capture is recorded for this patient, the outstanding intake gate looks up packages for this patient).

## Card capture

Stripe Elements component, configured for the location's Stripe Connect account (or the clinician's, if `stripe_routing` is `clinician`). The card is captured (not charged) and stored as a `payment_methods` row linked to the patient.

Skipped entirely if `rooms.payments_enabled` is false, or if the location has no Stripe configured.

The patient sees: "We'll save this card for any payment after your appointment. You won't be charged now."

## Device test

Browser-side checks for camera, microphone, and network. The test runs WebRTC checks via LiveKit's pre-flight utilities.

Skipped on in-person entries (no telehealth call coming up).

The result is reported back to the arrive endpoint as `device_tested: boolean`. A failed test still allows arrival; the receptionist sees a flag on the run sheet so they can troubleshoot.

## Arrive

The terminal step. Calls `POST /api/patient/arrive` with the verified identity, the device test result, and (for on-demand) room and location IDs.

The endpoint:

- For on-demand: creates a `sessions` row with `status: 'waiting'` (telehealth) or `'checked_in'` (in-person), generates a fresh `entry_token`, and returns it.
- For scheduled telehealth: updates the existing session to `status: 'waiting'`, sets `patient_arrived: true`.
- For scheduled in-person: updates the existing session to `status: 'checked_in'`.

After the response lands, the client redirects to `/waiting/[entry_token]` (telehealth) or stays on the confirmation screen (in-person).

The arrive endpoint is **unconditional** in the sense that it does not re-check intake completion or any other prerequisite. By the time the patient hits arrive, all the gating has already happened in the flow above.

## Virtual waiting room (telehealth)

Lives at `/waiting/[token]`. The patient sees:

- Persistent header.
- A status message ("You're in the waiting room. Your clinician will admit you shortly.")
- Real-time updates if their session changes ("You'll be admitted in a moment," "Running 5 minutes late").

Connects to the same Socket.io server the clinic side uses. The waiting-room component emits `presence:track` with the location id and session id so the receptionist's run sheet sees the "connected" dot, and listens for `status_changed` (emitted by the server when the clinician admits) to navigate to the call. There is no Supabase Realtime subscription here, despite the vestigial `useRealtimeWaiting` hook in `src/hooks/`.

The waiting room is its own surface. The entry flow's responsibility ends at "redirected to waiting."

## In-person check-in confirmation

Lives at the final step of the entry flow for in-person entries (no separate route). Shows:

- Persistent header (room name appears here for the first time, because the in-person patient is now matched to the appointment's room).
- "You're checked in" message.
- Wait instructions.

No real-time updates needed; the patient's status is `checked_in` and they're physically in the building. The clinician will see them on the run sheet.

## Service-role and token validation

All patient-side API routes (`src/app/api/patient/*`, `src/app/api/intake/*`) use the service-role Supabase client because patients aren't Supabase Auth users. The entry token (`sessions.entry_token`, `rooms.link_token`, `locations.qr_token`, or `intake_package_journeys.journey_token`) is the authorisation primitive.

This means each route is responsible for validating the token before doing anything. RLS doesn't help here. Any patient-side route that accepts a token and skips validation is a bug.

The phone OTP is validated against `phone_verifications` rows. The verification is consumed (deleted or marked consumed) when used.

## Where to look

- **Entry page:** `src/app/(patient)/entry/[token]/page.tsx`.
- **Entry flow component:** `src/components/patient/entry-flow.tsx`.
- **Arrival endpoint:** `src/app/api/patient/arrive/route.ts`.
- **Phone OTP routes:** `src/app/api/patient/otp/*`.
- **Identity routes:** `src/app/api/patient/resolve/route.ts` and the contact mutation routes.
- **Outstanding intake check:** `src/app/api/patient/outstanding-intake/route.ts` and `src/lib/intake/outstanding.ts`.
- **Embedded intake wrapper:** `src/components/patient/embedded-intake-journey.tsx`.
- **Patient layout:** `src/app/(patient)/layout.tsx`.
- **Plan files:**
  - `docs/plans/outstanding-intake-arrival-gate.md`
  - `docs/plans/qr-checkin-appointment-matching.md`
  - `docs/plans/patient-presence-heartbeat.md`

## Related docs

- `01-core-concepts.md` for entry points, identity model, and lifecycle.
- `feature-intake-package.md` for the intake journey UI that the gate embeds.
- `feature-runsheet.md` for the clinic-side view of session state changes.
- `feature-payments.md` for the Stripe Connect setup behind card capture.
- `conventions-prototype-vs-production.md` for what's stubbed (SMS, video) and what's real.
- `02-architecture.md` for the patient-side / clinic-side architectural split.
