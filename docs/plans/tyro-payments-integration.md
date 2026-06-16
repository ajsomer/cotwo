# Plan: Tyro Health Online (Checkout) payments — second provider alongside stubbed Stripe

Status: **FULL workflow BUILT (tsc + lint + build clean); needs live browser
verification.** Migration 026 applied to `cotwo` Neon. Done: provider abstraction
(`src/lib/payments/`), `chargePayment` routing, Process-flow "Send payment
request", Tyro webhook receiver, Settings provider selector (+ Stripe sections
hidden for Tyro), AND entry-flow card capture — `CardCapture` branches on org
provider: Tyro renders the `@medipass/partner-sdk` `renderAuthorizePayment` iframe
inline (containerId='tyro-card-frame'), token minted via
`/api/patient/card/tyro-token`, refId persisted on success. Card-on-file recall
verified server-side via `getSavedCard` (GET
/businesses/{businessId}/patients/refid/{refId}/paymentmethods, 200). Needs
`TYRO_BUSINESS_ID` in env for card-on-file lookup (= 6a056a31b15f41d1bb9a3a03 on
staging). Remaining: live browser render of the iframe at 420px + a real saved
card → charge round-trip (§8); Tyro webhooks need a deployed URL/tunnel (won't
fire on localhost).

Original status: **API contract verified against staging; not yet built.** The smoke test
(`scripts/tyro-smoke-test.mjs`) creates a real unpaid invoice in the Coviu
staging business and returns a live `paymentRequestUrl` — credentials, base URL,
geo-IP, app id, and request shape are all confirmed working (see §1). No
application code, schema, or UI has been written yet. Credentials are in
`.env.local` (`TYRO_API_KEY`, `TYRO_APP_ID=coviu-web`).

This adds **Tyro Health Online Checkout** as a second payment provider behind a
new provider abstraction, selectable **per organisation**, alongside the
currently-stubbed Stripe path. Scope is **payments only** — card capture +
charge. Medicare/PHI **claiming is explicitly out of scope** (fund-approval-gated;
noted as a future extension in §9).

**The workflow this enables** (verified viable):
1. **Entry:** patient stores a card → it is vaulted *on Tyro's side*, against a
   `refId` we mint. Card data never enters our DB.
2. **Post-consult:** we call Tyro again with the *same* `refId` → Tyro recognises
   the returning patient and their saved card, and the charge is completed on
   Tyro's hosted page (patient confirms, or staff completes in the Tyro portal).

**The golden rule:** Tyro is a **hosted, patient-present** payment model. There is
**no API to silently charge a stored card from our server.** Every transaction
returns a `paymentRequestUrl` (a page on `stg.tyro.health` / `tyro.health`) that
a human opens to complete payment. The saved card is reused because the `refId`
matches — *not* because we charge a token. Do not design any flow that assumes
unattended/off-session charging; that is a Stripe capability, not a Tyro one.

---

## 0. What already exists (the surface Tyro plugs into)

Read these first — they are the integration points:

- `src/lib/sms/provider.ts` — **the house pattern to copy.** A provider
  `interface` + env-selected implementation (`console` | `vonage`). The payments
  abstraction mirrors this shape.
- `src/lib/stripe/client.ts`, `src/lib/stripe/connect.ts` — Stripe is **fully
  stubbed** (`connect.ts` is literally `export {}`). Nothing real to preserve;
  just keep the stub working behind the new interface so existing behaviour
  doesn't regress.
- `src/lib/runsheet/actions.ts` → `chargePayment(sessionId, amountCents)`
  (~line 142) — the **post-consult charge call site.** Currently inserts a
  `payments` row with fake `pi_test_*` / `acct_test_bondi` ids and
  `status: 'completed'`. This is where the provider gets invoked.
- `src/components/clinic/process-flow/process-flow-payment.tsx` — the Process
  flow payment step. **Already has the right two-button shape:** "Charge
  {amount}" when `has_card_on_file`, else "Send payment request" (currently a
  no-op `onNext()`). The Tyro path lights up "Send payment request".
- `src/app/api/patient/card/route.ts` — entry-time card storage. Today writes a
  `payment_methods` row from Stripe tokenisation fields and sets
  `sessions.card_captured = true`. Tyro changes *what* gets stored (a `refId`,
  not a Stripe token).
- `src/lib/db/schema.ts` — `paymentMethods` (line ~233), `payments` (line ~367),
  `sessions` (line ~272). All currently **Stripe-shaped** (`stripePaymentMethodId`,
  `stripePaymentIntentId`, `stripeAccountId`). Needs provider-neutral columns (§4).

---

## 1. Verified API contract (from staging smoke test)

**This is the load-bearing section — these facts were confirmed live, and they
correct the docs.**

- **Endpoint:** `POST https://stg-api-au.medipass.io/v3/transactions/invoices`
  (production base URL differs — obtain from `healthpartnerships@tyro.com` at
  go-live).
- **Headers:**
  - `Authorization: Bearer ${TYRO_API_KEY}`
  - `x-appid: coviu-web` (`${TYRO_APP_ID}`)
  - `x-appver: <any string>` (non-secret, e.g. `coviu-proto/0.1`)
  - `Content-Type: application/json`
- **Request shape — use the FLAT form, NOT the nested `provider`/`patient.identity`
  form the docs lead with.** The nested form is for the PHI/HICAPS claim variant
  and returns `400 errorCode 13001 "Could not determine location"`. The simple
  charge wants:
  ```json
  {
    "invoiceReference": "<unique per invoice>",
    "patient": {
      "refId": "<OUR PATIENT HANDLE — the linchpin>",
      "firstName": "...", "lastName": "...",
      "mobile": "04xxxxxxxx", "dobString": "YYYY-MM-DD"
    },
    "providerNumber": "T01LHM0B",
    "processingRequest": { "paymentLink": true },
    "nonClaimableItems": [
      { "serviceDateString": "YYYY-MM-DD", "reference": "01",
        "displayName": "Telehealth consultation",
        "chargeAmount": "1.00", "isTaxable": false }
    ]
  }
  ```
- **`providerNumber` carries the location/settlement identifier.** `T01LHM0B`
  (the location-level "Unique Identification Number" from Tyro portal → Locations
  → Claiming) works and is the natural per-location config value. Individual
  provider numbers (`2147661H`, `2438531W`) also resolve. This maps the invoice
  to a location and directs settlement.
- **Amounts are dollar strings** (`"1.00"`), not cents. We store cents internally
  → convert at the boundary (`(amountCents/100).toFixed(2)`).
- **Response (HTTP 200):** returns `status: "pending"`, `transactionId`,
  `patient._id` (Tyro's internal patient id), echoes our `patient.refId`, and the
  deliverable: **`paymentRequestUrl`** (e.g. `https://stg.tyro.health/YuHDgs`) +
  `paymentRequestUrlExpiry` (~30 days).
- **`refId` round-trips and creates/links the patient on Tyro's side** — verified.
  Same `refId` on a later call resolves to the same stored patient (and their
  saved card on the hosted page). This is the entire saved-card mechanism; there
  is no separate token-charge endpoint (§ golden rule).

**Async outcome:** the 200 is `pending` — actual payment happens when the URL is
opened. We learn the result via **webhooks** (`invoiceCompleted` / `invoiceCancelled`)
and/or **callbacks** (browser redirect). See §6.

---

## 1a. Entry-time card capture (save card, no charge) — VERIFIED

**Capture is NOT a REST endpoint** — there is no `/v3/.../payment-details` or
card REST route (probed; all 404). The save-card-without-charge operation is the
**JS SDK** method `requestUpdatePaymentDetails({ patientRefId, ... })` from
`@medipass/partner-sdk`, which opens a secure popup for the patient to enter/save
a card. (The portal's "Request payment details" button is the staff-triggered
equivalent.) This matches the "Patients" help-centre flow: capture a card "at any
time without processing a transaction."

Do **not** try to capture via a $0 invoice — verified that a `$0.00`
`paymentRequestUrl` renders only an APPROVE/REJECT confirmation with **no card
form** (nothing to pay → nothing to save). Card-save needs the SDK path.

**SDK token mint — VERIFIED working on staging:**
- `POST https://stg-api-au.medipass.io/v3/auth/token`
- Headers: same as §1 (`Authorization: Bearer ${TYRO_API_KEY}`, `x-appid`, `x-appver`).
- Body: `{ "audience": "aud:business-sdk", "expiresIn": "24h" }`
  - `audience` MUST be one of `aud:business-terminal | aud:business-sdk |
    aud:funder-adjudication` → use **`aud:business-sdk`**.
  - `expiresIn` is a **string** (`"24h"`), not a number.
- 200 returns `{ token: <JWT ~301 chars>, transactionIntentId }`. The `token` is
  the short-lived credential passed to the browser SDK. **Mint server-side only**
  — never expose `TYRO_API_KEY` to the client. Aligns with the portal showing
  "SDK token: memory only".

**Capture flow (entry journey):**
1. Server resolves the patient's `refId` (§3), mints an `aud:business-sdk` token.
2. Browser loads `@medipass/partner-sdk`, calls
   `requestUpdatePaymentDetails({ patientRefId, token, env: 'stg', onSuccess, ... })`.
3. Patient saves card in the SDK popup (card vaulted on Tyro against `refId`).
4. On `onSuccess`, server persists `patients.provider_customer_ref = refId` and
   sets `sessions.card_captured = true`.

**UX note / DECISION (revised):** use the **installed `@medipass/partner-sdk`
(v3.0.1)**, not the older Checkout-SDK `requestUpdatePaymentDetails` (which is NOT
in this package). The card-save flow is **`renderAuthorizePayment(payload,
options)`** where `options` is `SdkRenderOptions & SdkCallbacks` — crucially it
takes **`containerId`**, so the SDK renders its iframe **inline into our DOM
element**, NOT a popup. So: **inline iframe in the 420px entry flow**, embedded in
our branded card step. (The earlier `x-frame-options: deny` blocker was about
framing the hosted `paymentRequestUrl` page — a different thing, still blocked;
the SDK render path is purpose-built to embed and is fine.) Config carries the
minted SDK `token` + `env`; callbacks `onSuccess`/`onError`/`onCancel`/
`onCloseModal`. ⚠️ verify: live render at 420px width on staging.

**Card-on-file recall — NEW capability found in the SDK:**
`payments.getBusinessPatientPaymentMethodsByRefId(businessId, refId)` returns
saved `PaymentMethod[]` with `lastFour`, `cardType`, `expiryMonth/Year`,
`isDefault`. So for a returning patient we CAN show real last-4 + brand "card on
file" (answers the open §8 question) by looking up the refId — no need to capture
digits at save time. Needs `businessId` (from the token mint / org config) — to
confirm where we read it.

---

## 2. Provider abstraction — `src/lib/payments/`

Mirror `src/lib/sms/provider.ts`. New directory:

- `provider.ts` — the interface + types:
  ```ts
  export type PaymentProviderType = 'stripe' | 'tyro' | 'console';

  export interface PaymentProvider {
    /**
     * Entry-time card capture (save card, NO charge). Server mints whatever the
     * client needs to run the capture UI.
     *  - Tyro   → mints an SDK token (aud:business-sdk) so the browser SDK can
     *             call requestUpdatePaymentDetails({patientRefId}); see §1a.
     *  - Stripe → returns a SetupIntent client secret (stub).
     */
    startCardCapture(input: {
      patientRefId: string;
      patient: { firstName: string; lastName: string; mobile: string; dob: string };
    }): Promise<
      | { mode: 'tyro-sdk'; sdkToken: string; env: 'stg' | 'prod'; patientRefId: string }
      | { mode: 'stripe-elements'; clientSecret: string }
    >;

    /**
     * Post-consult charge. Honest discriminated result:
     *  - Stripe (stub) → 'completed'
     *  - Tyro          → 'requires_action' + paymentRequestUrl (patient/staff completes)
     */
    createCharge(input: {
      sessionId: string;
      patientRefId: string;          // our minted refId (§3)
      amountCents: number;
      locationProviderNumber: string; // Tyro location id, e.g. T01LHM0B
      patient: { firstName: string; lastName: string; mobile: string; dob: string };
      description: string;
      sendSms?: boolean;             // Tyro processingRequest.sms
    }): Promise<
      | { status: 'completed'; providerTxnId: string }
      | { status: 'requires_action'; providerTxnId: string; paymentRequestUrl: string }
    >;
  }
  ```
- `tyro.ts` — real staging impl. `startCardCapture` mints an SDK token (§1a);
  `createCharge` builds the §1 flat body, POSTs, maps the 200 `paymentRequestUrl`
  → `requires_action`. Reads `TYRO_API_KEY` / `TYRO_APP_ID` from env; base URL +
  `x-appver` as module constants.
- `stripe.ts` — wraps the existing stub behaviour (returns `completed`), so the
  default org path is unchanged.
- `console.ts` — logs, returns a fake `requires_action` + dummy URL. Default for
  local/no-creds, like `SMS_PROVIDER=console`.
- `index.ts` — `getPaymentProvider(type): PaymentProvider` selector.

**Golden-rule guard:** no `if (provider === 'tyro')` anywhere outside
`src/lib/payments/`. Provider-specific logic lives behind the interface.

---

## 3. The `refId` strategy (the linchpin)

`refId` is a **patient-level** handle — the saved card follows the patient across
all their visits. Storing it per-session would fragment the card; don't.

- **Recommendation:** add `provider_customer_ref` to `patients` (or to a new
  per-(patient, provider) row — see §4). Mint once on first Tyro interaction,
  reuse forever. A deterministic value derived from `patients.id` (e.g.
  `coviu-{patients.id}`) is simplest and idempotent; a stored UUID also works.
- **Charging references it from the session:** `chargePayment` resolves the
  session's patient → reads that patient's `provider_customer_ref` → passes it as
  `patientRefId`. The session/appointment does **not** own the `refId`; it borrows
  the patient's.
- Same patient → same `refId` → Tyro's hosted page recognises them and offers the
  stored card (the "choose existing patient" behaviour seen in the Tyro UI).

---

## 4. Schema changes (Neon migration — DO NOT APPLY without explicit go-ahead)

Per the project Neon-migration convention, author the SQL but apply only on the
user's word. Keep all existing Stripe columns (nullable where Tyro won't set them).

- `organisations`: add `payment_provider` enum/text, default `'stripe'` →
  org-level selection (§5). Existing orgs keep current (stub) behaviour.
- `patients`: add `provider_customer_ref` (text, nullable) — the Tyro `refId`
  (§3). *(Alternative: a `patient_payment_profiles` table keyed (patient_id,
  provider) if multi-provider-per-patient is ever needed. Single column is enough
  for now.)*
- `payment_methods`: add `provider` (text, default `'stripe'`); make
  `stripe_payment_method_id` **nullable** (Tyro won't set it — the card lives on
  Tyro's side, so a Tyro "card on file" row records only that capture happened +
  brand/last4 if the webhook returns them).
- `payments`: add `provider`, `provider_txn_id` (Tyro `transactionId`),
  `payment_request_url`. Reuse the existing `paymentStatus` enum — map Tyro
  `pending`/`requires_action` → `processing`, `invoiceCompleted` → `completed`,
  `invoiceCancelled` → `failed`/`refunded`.

---

## 5. Org-level provider selection

- Resolve `organisations.payment_provider` where `chargePayment` runs; pass to
  `getPaymentProvider(...)`. Default `'stripe'` so nothing changes for existing
  orgs until they opt in.
- Surface the choice in **Settings → Payments**
  (`src/components/clinic/settings/payments-settings-shell.tsx`) — a provider
  selector + the Tyro location identifier (`providerNumber`, e.g. `T01LHM0B`)
  field. *(Settings UI can be a fast-follow; the env/DB plumbing is the core.)*

---

## 6. Wire-up

1. **Entry-time capture** (SDK popup, §1a): when the org provider is Tyro, the
   entry-flow card step shows OUR primer, then on user gesture calls the browser
   SDK `requestUpdatePaymentDetails({ patientRefId, token, env })` — the token
   minted server-side via a new route (e.g. `POST /api/patient/card/tyro-token`,
   `aud:business-sdk`). On the SDK `onSuccess`, POST to `/api/patient/card` to
   persist `patients.provider_customer_ref = refId` and set
   `sessions.card_captured`. No card data touches our server. (Stripe path keeps
   the existing inline Elements + `/api/patient/card` Stripe fields.)
2. **Post-consult charge** (`src/lib/runsheet/actions.ts` `chargePayment`):
   resolve org provider → resolve patient `refId` → `provider.createCharge(...)`.
   On `requires_action`, write the `payments` row with `payment_request_url` +
   status `processing`, and return the URL to the UI.
3. **Process flow** (`process-flow-payment.tsx`): the existing **"Send payment
   request"** button calls through and then **displays/copies the
   `paymentRequestUrl`** + offers SMS-to-patient (Tyro `processingRequest.sms`).
   The "Charge {amount}" button maps to the Stripe stub path. No card UI is
   embedded — we surface a link/redirect/SMS (iframe is unreliable: Tyro sends
   `x-frame-options: deny`).
4. **Webhook receiver** — new `src/app/api/webhooks/tyro/route.ts` for
   `invoiceCompleted` / `invoiceCancelled`. Update the `payments` row status,
   broadcast `session_updated` so the run sheet refetches (same pattern
   `chargePayment` already uses via `broadcastSessionChange`). Callback URLs (the
   browser redirect on the hosted page) point back to a thank-you/return route.

---

## 7. Build order

1. Smoke-test the **capture / zero-or-small-amount** path and the **webhook**
   payloads on staging (§8) — the last unverified pieces.
2. Provider interface + `console`/`stripe`/`tyro` impls (§2).
3. Migration SQL authored (§4) — **apply only on go-ahead.**
4. `refId` minting + persistence (§3).
5. Wire `chargePayment` + Process flow + card route + webhook (§6).
6. Settings → Payments UI for org provider + location id (§5).

---

## 8. Still to verify on staging (before/early in build)

RESOLVED (this session): capture mechanism (SDK `requestUpdatePaymentDetails`,
§1a), SDK token mint (§1a), charge path + flat shape (§1), `refId` round-trip.

Remaining:
- **`requestUpdatePaymentDetails` end-to-end in a browser:** the SDK popup itself
  needs a real browser + test card to confirm the card vaults against `refId` and
  is then offered on a subsequent charge. (Token mint + method identity are
  verified; the in-popup save is the one piece only a live browser run shows.)
- **Returning-patient behaviour:** after a card is saved, send an invoice with the
  same `refId` and confirm the hosted page offers the saved card. Confirms §3.
- **Webhook/callback payloads:** capture real `invoiceCompleted` /
  `invoiceCancelled` bodies (use a request-bin URL) to define the §6.4 receiver.
- **Production base URL + appid** are separate from staging (§ Going live) —
  needed only at go-live.

---

## 9. Explicitly OUT of scope (future extensions)

- **Medicare / PHI claiming.** Tyro's real differentiator vs Stripe, but
  fund-approval-gated ("PHI claims via Checkout require explicit fund approval and
  is not automatically enabled") and untested. Would add `claimItems` +
  `patient.healthFundAccount` to the request and a claim/benefit/gap data model.
  Not built here.
- **Real Stripe.** Remains stubbed; this plan only keeps the stub working behind
  the new interface.
- **Unattended/off-session charging.** Not possible via Tyro (§ golden rule). If
  no-show fees / silent post-consult charges are ever required, that is a Stripe
  off-session effort, not Tyro.

---

## 10. Credentials & environment

- `.env.local`: `TYRO_API_KEY` (business API key, bearer — keep server-side only,
  never client-exposed), `TYRO_APP_ID=coviu-web`.
- Staging base URL: `https://stg-api-au.medipass.io/v3`. Hosted pages render on
  `stg.tyro.health`.
- Geo-IP: Tyro may restrict to Australian IPs — local dev from an AU IP works
  (verified); confirm Vercel region at deploy.
- Reference: `scripts/tyro-smoke-test.mjs` (the verified request shape).
  Tyro test cards: `5123450000000008` exp `01/39` CVV `100` = APPROVED. Amounts
  $2000–$2999 simulate declines.
