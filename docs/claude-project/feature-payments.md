# Feature: Payments

Stripe Connect, Custom Connect with controller properties. Coviu is the EFTPOS terminal; the PMS is the ledger. The integration is real (production-grade code) but runs against Stripe's test mode in the prototype. The only thing that swaps at handoff is the API key.

This doc summarises the runtime payment flow and the routing model. Configuration (connecting Stripe accounts, choosing the routing model) is in `feature-admin-and-config.md`.

---

## What Coviu's role is

Coviu captures the payment, the experience, and the receipt. The PMS records the financial consequence (invoice, fee structure, billing items). The two systems exchange transaction data so the PMS reconciles, but Coviu doesn't replace accounting and the PMS doesn't drive the patient experience.

In practice:

- Patient sees: a card capture step in the arrival or intake flow, and (after the visit) a charge applied to their card during the receptionist's process flow.
- Receptionist sees: card on file in the patient detail panel, "Take payment" button in the process flow, payment status visible on the run sheet.
- Clinician sees: nothing payment-related (clinicians don't take payment).
- PMS sees: a payment record pushed back via the integration with the amount, date, and patient.

## The routing model

Coviu Connect uses Stripe Connect to route money to the right destination. There are two routing models, set at the org level:

**Location-level routing** (`stripe_routing = 'location'`). One Stripe Connect account per location. All payments at that location go to the location's account. Simple, used by clinics where every clinician is an employee of the location.

**Clinician-level routing** (`stripe_routing = 'clinician'`). One Stripe Connect account per clinician. Payments are routed based on which clinician saw the patient. Used by clinics with independent contractor clinicians who handle their own billing.

The choice is **org-locked**: set at org creation, not changeable afterwards. Switching mid-flight requires re-onboarding clinicians or locations to new Stripe accounts and migrating connected accounts, which is operationally expensive. See `feature-tiers-and-roles.md` for the cascading config framing.

For the runtime payment, the routing decision happens at the moment a payment is initiated:

1. Look up the appointment's clinician.
2. If `stripe_routing = 'clinician'`: use `staff_assignments.stripe_account_id` for that clinician at this location.
3. If `stripe_routing = 'location'`: use `locations.stripe_account_id`.
4. Create the Stripe payment intent against the resolved account.

If the routing target has no Stripe account configured, payment is blocked with a clear error (the receptionist sees "this location/clinician doesn't have payments configured" rather than a failed charge).

## Card capture flow

Two places a card can be captured:

- **Arrival flow** (`feature-patient-entry-flow.md`). The patient captures a card during entry, before the visit. Card is stored as a `payment_methods` row linked to the patient.
- **Intake package** (`feature-intake-package.md`). If the package includes card capture, the patient captures it as part of the journey. Same `payment_methods` row.

Implementation uses Stripe Elements client-side and creates a SetupIntent server-side. The card is saved against a Stripe Customer attached to the relevant Connect account (location or clinician, per routing).

The card is **captured, not charged**. No money moves at capture time. The patient sees: "We'll save this card for any payment after your appointment. You won't be charged now."

## Charge flow

The receptionist takes payment in the process flow at the end of the visit. The flow:

1. Receptionist clicks "Process" on a `complete` session row (or `checked_in` for in-person early processing).
2. Process flow renders the payment step. Shows the card on file, the appointment's default fee (`appointment_types.default_fee_cents`), and an editable amount.
3. Receptionist confirms the amount, clicks "Charge."
4. Server creates a Stripe payment intent against the resolved account (location or clinician), with the patient's saved payment method, and confirms it inline.
5. On success, a `payments` row is written with `status: 'completed'` and the Stripe payment intent ID.
6. On failure (declined card, expired card), the receptionist sees the error and can retry with a different card.

The payment is per-session, not per-line-item. The MVP doesn't break out individual billable items (consultation fee, materials, etc.); that's the PMS's job. The Coviu side captures the total charged.

## Fees and pricing

Coviu does not take a margin on Stripe fees. The transaction is pure pass-through: Stripe's fees come off the gross, the rest lands in the clinic's account. Coviu's revenue is from the subscription (paid seats), not from per-transaction fees.

This is a deliberate decision; see `reference-decisions.md`.

The `appointment_types.default_fee_cents` is the suggested charge amount, not a billed fee. The receptionist edits it at processing time to match what the PMS will record.

## PMS reconciliation

When a payment completes, the system pushes the transaction record to the PMS via the integration: amount, date, patient identifier, payment method type. The PMS uses this to reconcile its accounts receivable.

In the prototype, the push to PMS is stubbed (see `conventions-prototype-vs-production.md`). The integration code exists, but it logs the push instead of calling Cliniko's API. At handoff, the stub is replaced with real PMS calls.

This is a one-way push. Coviu doesn't read PMS payment records; it just informs the PMS that a transaction happened. If the PMS records additional payments outside Coviu (cash at reception, EFTPOS terminal, direct deposit), those don't show up in Coviu's `payments` table.

## Webhooks

`/api/webhooks/stripe/route.ts` exists but is a **TODO stub**. The handler currently accepts the request and returns `{ received: true }` without verifying the Stripe signature, parsing the event, updating any rows, or broadcasting anything. This is the single largest piece of unfinished Stripe work in the prototype.

**Implications for the current build:**

- `payments` rows reflect what the synchronous charge call returned at capture time. Any state that depends on a webhook landing — delayed declines, refunds initiated from the Stripe dashboard, Connect account status changes — does not propagate back to Coviu.
- Demos and walkthroughs that exercise only the synchronous capture path work fine.
- There is no `payments:{location_id}` channel and no `payment_changed` event — the event topology described in the original spec hasn't been implemented because the trigger (the webhook handler) doesn't exist yet.

**Intended events to handle (when the stub gets built):**

- `payment_intent.succeeded` (mostly informational; the inline confirm captures success synchronously).
- `payment_intent.payment_failed` (delayed declines).
- `charge.refunded` (refund processed via Stripe dashboard).
- `account.updated` (Connect account status changes).

For local development, the eventual implementation will use Stripe CLI's `stripe listen --forward-to`. Today there's nothing to forward to.

## What's stubbed

A short list, expanded in `conventions-prototype-vs-production.md`:

- **Test mode** for all Stripe API calls. Test keys, test accounts, test cards.
- **Webhook handler** is a TODO (see "Webhooks" above). All async Stripe events are dropped on the floor.
- **PMS reconciliation push** is a console log, not a real call.
- **Refund flow** through the UI is not built. Refunds initiated in the Stripe dashboard would, in principle, land via webhook; but with the webhook stubbed, Coviu's records won't reflect them.

Stripe Connect onboarding, payment intents, SetupIntents, and the Connect account routing logic are real. The webhook handler is the gap.

## What can go wrong

Common failure modes worth flagging:

1. **Missing Stripe account** at the resolved routing target. The error is visible to the receptionist; fix is to complete Stripe Connect onboarding for that location or clinician via Settings → Payments.
2. **Card declined.** The receptionist sees the decline reason and can ask the patient for a different card.
3. **Routing model misconfigured at org level.** A location-routed org with clinician-level Stripe accounts (or vice versa) blocks all payments. Symptom: every payment errors out at the routing step.
4. **Async events not propagating.** The webhook handler is currently stubbed (see Webhooks above), so any state change that originates in Stripe and not in Coviu's UI won't reach the database. This is expected today; not a bug, a known gap.
5. **Service-role bypass on patient-facing card capture routes.** Card capture endpoints use the service-role client (because the patient isn't a Supabase Auth user). Make sure the patient's identity is verified by entry token before the SetupIntent is created.

## Where to look

- **Stripe client setup:** `src/lib/stripe/client.ts`.
- **Connect setup and routing:** `src/lib/stripe/connect.ts`.
- **Card capture (patient):** `src/components/patient/card-capture.tsx` and `src/components/patient/intake-card-capture.tsx`.
- **Card capture API:** `src/app/api/patient/card-capture/*`.
- **Charge flow (receptionist):** the process flow components (see `feature-process-flow.md`).
- **Webhook handler:** `src/app/api/webhooks/stripe/route.ts`.
- **Plan files:**
  - `docs/plans/settings-payments.md`

## Related docs

- `feature-admin-and-config.md` for Stripe Connect onboarding and the routing-model decision.
- `feature-patient-entry-flow.md` for the patient-facing card capture step.
- `feature-intake-package.md` for the intake-package version of card capture.
- `feature-process-flow.md` for the receptionist's charge flow.
- `feature-pms-integration.md` for the reconciliation push.
- `conventions-prototype-vs-production.md` for the test-mode and stubbed-PMS framing.
- `reference-decisions.md` for the no-margin-on-Stripe-fees decision.
