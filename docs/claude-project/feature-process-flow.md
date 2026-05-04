# Feature: Process Flow

The receptionist's sequential post-appointment flow. After a session is `complete` (or `checked_in` for in-person early processing), the receptionist clicks the row's primary action ("Process") to enter this flow. It's a small modal that walks through payment, outcome pathway selection (Complete only), and done.

This doc summarises the flow. Full UI behaviour and edge cases live in the spec.

---

## When the flow is entered

The "Process" action becomes available on a session row when:

- **Session status is `complete`** (call ended for telehealth, in-person visit recorded as done).
- **OR session status is `checked_in`.** Conceptually this is the early-processing case for in-person patients (walked in, paying upfront), and telehealth shouldn't reach `checked_in` in normal use. The current `getActionConfig` in `derived-state.ts` does *not* check modality — any `checked_in` session shows the Process button. If a telehealth session ends up in `checked_in`, it will offer the Process action; the underlying flow then proceeds the same way it would for in-person.

The "Process" action is gated by role: Receptionist, Practice Manager, or Clinic Owner. Pure clinicians can't process unless they're also the clinic owner. See `feature-tiers-and-roles.md`.

The action lives on the session row in the run sheet. Clicking opens a slide-over panel with the sequential flow inside.

## The three steps

1. **Take payment.** Optional if the location has no payments enabled or the appointment has zero fee.
2. **Select outcome pathway.** Complete tier only. Skipped on Core.
3. **Done.** Marks the session `done`, schedules post-appointment workflow actions (Complete tier), broadcasts the run sheet event.

Steps that don't apply (no payment configured, no outcome pathway needed) are skipped. The flow always ends at "Done."

## Step 1: Take payment

The card-on-file flow described in `feature-payments.md`. The receptionist:

- Sees the card on file (last four, brand).
- Sees the suggested charge (`appointment_types.default_fee_cents`).
- Edits the amount if needed.
- Clicks "Charge."

The server creates a Stripe payment intent against the resolved Connect account (location or clinician routing), confirms it inline using the saved payment method, and writes a `payments` row.

If the charge fails (declined, expired card), the receptionist can retry with a new card or skip payment for now.

If the location has no payments configured (or `rooms.payments_enabled` is false), this step is skipped entirely. The session moves to step 2 directly.

## Step 2: Select outcome pathway (Complete only)

Outcome pathways are pre-configured per appointment type by the Practice Manager. Each pathway has a name ("Follow-up needed in 4 weeks," "Discharge with home program," "Refer to specialist," "No further action") and is linked to a post-appointment workflow template.

The receptionist sees a list of pathways for this appointment's type and picks one. The selection is recorded on the session.

The selected pathway determines which post-appointment workflow template fires. See `feature-workflow-engine.md` for how the post-appointment side schedules.

A session can only have one pathway selected. If the receptionist needs to change it, they have to do so before clicking "Done"; once the session is `done`, the post-appointment actions are scheduled and changing the pathway requires manual intervention.

On Core, this step is skipped entirely. There's no workflow engine, no outcome pathways, no post-appointment automation.

## Step 3: Done

The terminal confirmation step. By the time it renders, the session is already `done` — the status flip happens at the *previous* step:

- **Complete tier:** the `confirm_outcome_pathway` RPC (called from step 2) atomically sets `outcome_pathway_id`, `session_ended_at`, `status = 'done'`, and schedules the post-appointment workflow. By the time step 3 mounts, this has all happened.
- **Core tier:** there's no outcome step, so step 2 is a thin "mark done" action that flips `status = 'done'` directly.

What step 3 actually does:

- Confirms to the receptionist that the session is closed.
- Calls `markSessionDone` on mount (a no-op re-update if Complete tier already flipped it; the authoritative flip for Core tier).
- Shows "Next session" / "Close" controls. Auto-advances after 2 seconds in non-bulk mode.
- A `session_changed` Socket.io event is emitted into the location room (from the underlying mutations), so other open run sheets refresh.

There is no outbound PMS push in the prototype — the PMS adapter doesn't exist yet (see `feature-pms-integration.md`). At handoff, the outbound push would hook into either the outcome-pathway RPC or the `markSessionDone` step.

The receptionist is returned to the run sheet.

## Edge cases worth flagging

- **Solo practitioner.** A clinic owner with no receptionist processes their own sessions through the same flow. No different UI, no "solo mode" toggle. The role check just naturally allows them through.

- **Skipping payment.** If the patient can't pay right now (forgot their card, machine declined), the receptionist can skip payment and mark the session done. The session is recorded with no payment attached. The clinic chases the payment outside Coviu (which is one of the reasons the PMS is the ledger; it can hold AR records that Coviu doesn't).

- **Multiple charges per session.** Not supported in the MVP. One payment record per session. If the visit has multiple billable items, the total is charged in one payment; itemisation happens in the PMS.

- **Refunds.** Not built into the process flow. Refunds initiated in the Stripe dashboard would, in principle, propagate via the webhook — but the webhook handler is currently stubbed (see `feature-payments.md`), so today refunds don't update Coviu's records at all. Receptionists who refund a payment need to know they're doing it outside Coviu's view.

- **In-person early processing.** A patient checked in at 9am for a 10am appointment can be processed before the appointment if they're paying upfront. The flow runs against the `checked_in` status and the session moves through `complete` and `done` without ever passing through `in_session`. This is intentional; it accommodates the workflow where in-person patients pay before the consultation.

## What the flow does not do

- **Capture clinical notes.** The clinician writes notes in the PMS; Coviu doesn't.
- **Issue receipts.** Stripe sends an automated receipt to the patient. Coviu doesn't render or send a separate one.
- **Schedule the next appointment.** Rebooking is a post-appointment workflow action (Complete only) or happens via the PMS directly.

## Where to look

- **Process flow component:** `src/components/clinic/process-flow.tsx` (or similar; check `src/components/clinic/` for the modal).
- **Process flow API:** the route that flips session status and schedules post-appointment actions.
- **Outcome pathway data:** `outcome_pathways` table.
- **Payment integration:** `src/lib/stripe/*` (see `feature-payments.md`).

## Related docs

- `feature-runsheet.md` for the entry point and the run sheet refresh after processing.
- `feature-payments.md` for the full payment integration.
- `feature-workflow-engine.md` for the post-appointment scheduling triggered by the outcome pathway.
- `feature-tiers-and-roles.md` for who can process and the Core vs Complete differences.
- `feature-pms-integration.md` for the outbound payment and arrival push.
