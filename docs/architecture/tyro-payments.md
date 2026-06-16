# Architecture: Tyro Health Payments

How Coviu captures and charges cards via **Tyro Health Online** (formerly
Medipass), as a second payment provider alongside the (still-stubbed) Stripe one.
This is the **current-state reference** — what is on `main` today. For the design
history, the API archaeology, and the decisions behind it, see
`docs/plans/tyro-payments-integration.md`.

Scope is **payments** (card capture + charge). Medicare/PHI **claiming** is out of
scope as a built feature, though the clinic charge window does let an operator
choose to lodge a claim (Tyro's own UI) — we just don't pre-drive it.

---

## 1. The core constraint (read this first)

Tyro Health Online is a **hosted, patient/operator-present** model. There is **no
server-side "charge a stored card token" API.** Everything that moves money
happens on a Tyro-hosted surface:

- **Card capture** → Tyro's hosted "Update card details" page (the patient saves
  a card; no charge).
- **Charge** → Tyro's own SDK transaction window (the operator drives it).

What ties a patient to their stored card across all of this is a **`refId`** we
mint per patient. We never hold card data; Tyro vaults it against the `refId`.

Two consequences that shaped the whole design:
- The card-save page and the SDK transaction window **cannot be embedded in an
  iframe** (`x-frame-options: deny` on hosted pages). So capture is a popup, and
  the charge is the SDK's own modal.
- A fully silent "click → card charged" is impossible — there is always a hosted
  confirmation step.

---

## 2. The `refId` — the linchpin

`refId` is a **patient-level** handle. The stored card follows the patient across
every visit, so it must be stable.

- Stored in `patients.provider_customer_ref`.
- Minted deterministically as `coviu-<patients.id>` on first use and persisted —
  see `src/lib/payments/ref-id.ts` (`resolvePatientRefId`).
- Passed on **every** Tyro interaction (capture, charge, card-on-file lookup).
  Same `refId` → Tyro recognises the returning patient and offers their saved
  card.

Do **not** key it per-session — that would fragment the saved card across visits.

---

## 3. The shape

```
Coviu domain (run sheet, entry flow, process flow)
        │  selects provider per ORG (organisations.payment_provider)
        ▼
Payment provider abstraction   src/lib/payments/
  provider.ts   PaymentProvider interface + result types
  index.ts      getPaymentProvider(type) selector ('stripe' | 'tyro' | 'console')
  tyro.ts       TyroPaymentProvider — the real REST + SDK-token impl
  stripe.ts     stub (returns 'completed'); keeps existing behaviour
  console.ts    no-op default for local/dev
  ref-id.ts     resolvePatientRefId(patientId)
  tyro-charge-window.ts  client helper: opens Tyro's SDK transaction window
        │
        ▼
Tyro Health Online   REST API (server)  +  @medipass/partner-sdk (browser)
```

Provider selection is **per organisation**, not a global env var (unlike SMS).
`organisations.payment_provider` defaults to `'stripe'`, so existing orgs are
unaffected until switched to Tyro in Settings → Payments.

---

## 4. Configuration & connection (per-org)

**Each clinic connects their OWN Tyro business** — the Tyro API key is per-business
(generated in the clinic's Tyro Health portal → Business settings → API Keys), so
it is stored **per-org**, NOT as a global env var. This mirrors how Stripe Connect
stores `stripe_account_id` per location.

Connecting (Settings → Payments, when provider is Tyro): the clinic pastes **only
their API key**. The server validates it and **derives the business id from it**
via `GET /businesses/me` (the key is scoped to one business) — no manual business
id entry. Stored on `organisations`:
- `payment_provider` — `'stripe' | 'tyro' | 'console'`.
- `tyro_api_key_encrypted` — the clinic's API key, AES-256-GCM encrypted
  (`src/lib/payments/credentials.ts`, same scheme/key as PMS creds).
- `tyro_business_id` — derived from the key on connect.
- `tyro_provider_number` — optional location/settlement identifier (e.g.
  `T01LHM0B`). Used by the REST charge/invoice path. **Not** a valid SDK
  `providerNumber` (see §7).

`TyroPaymentProvider` is constructed with the org's creds via
`getTyroProviderForOrg(orgId)` (loads + decrypts). It falls back to env vars when
an org hasn't connected its own account yet (prototype/demo):
- `TYRO_API_KEY` (`<accountId>:<secret>`), `TYRO_BUSINESS_ID` — staging fallback.
- `TYRO_APP_ID` — `coviu-web`, the shared Coviu application id (non-secret, always
  from env, not per-org).
- `TYRO_ENV` — `stg` (default) | `prod`; `TYRO_APP_VER` — optional `x-appver`.

> Provider instances are **not cached** — Tyro instances are per-org (different
> creds), so caching by type would leak one org's key to another.

Base URLs: API `https://stg-api-au.medipass.io/v3`; hosted pages render on
`stg.tyro.health` / `stg-my.medipass.io`.

Auth headers on every REST call: `Authorization: Bearer ${TYRO_API_KEY}`,
`x-appid: ${TYRO_APP_ID}`, `x-appver`.

---

## 5. Card capture (patient entry flow)

Save a card, **no charge**, via Tyro's REST "request payment details" flow.

**Where:** `src/components/patient/card-capture.tsx`, which branches on the org's
provider (fetched from `GET /api/patient/card`).

**Flow (Tyro org):**
1. Patient reaches the card step → clicks **"Store card securely"**.
2. A popup is opened **synchronously** (popup-blocker-safe), then navigated to a
   Tyro-hosted card-save URL.
3. `POST /api/patient/card/tyro-token` →
   `TyroPaymentProvider.startCardCapture()`:
   - `POST /v3/businesses/{businessId}/patients` (idempotent on `refId`) → patient `_id`
   - `POST /v3/businesses/{businessId}/patients/{_id}/paymentmethods/updaterequests`
     → `{ paymentMethodUpdateLink }` — the hosted "Update card details" page.
4. We persist the `refId` (`POST /api/patient/card` with `provider: 'tyro'`,
   `provider_customer_ref`) before navigating.
5. The popup shows Tyro's card form (Card / Expiry / CVC → SAVE; no charge).
6. **No return mechanism exists** on Tyro's page, so the entry flow **polls**
   `GET /api/patient/card` every 2.5s; once the saved card appears (by `refId`),
   it closes the popup and advances. Gives up if the patient closes it or after
   5 minutes.

**Why a popup, not an iframe:** Tyro's hosted pages send `x-frame-options: deny`.
**Why not the SDK:** the installed SDK has no inline card-save render; the REST
`updaterequests` flow is the documented card-save path.

---

## 6. Card-on-file recall

For a returning Tyro patient we show their real last-4 / brand.

- `GET /api/patient/card` (when provider is Tyro) → `TyroPaymentProvider.getSavedCard(refId)`
- → `GET /v3/businesses/{businessId}/patients/refid/{refId}/paymentmethods`
- Returns `items[]` of `{ lastFour, cardType, expiryMonth, expiryYear, isDefault }`;
  we surface the default/first as `{ card_last_four, card_brand, card_expiry }`.
- Done **server-side** so `TYRO_API_KEY` stays off the client.

A local `payment_methods` row (provider `'tyro'`) is also written on capture as a
marker; `card_last_four`/`card_brand` default to `••••`/`Card` if Tyro didn't
return them at save time (the recall lookup is the source of truth for real
digits).

---

## 7. Charge (clinic-side, the Process action)

For a **Tyro org**, clicking **Process** on the run sheet **bypasses the Coviu
Process slide-over** and opens **Tyro's own SDK transaction window**.

**Where:** `src/components/clinic/runsheet/runsheet-shell.tsx` — `handleAction`
branches on `org.payment_provider === 'tyro'` (the org now carries
`payment_provider` + `tyro_provider_number`, threaded via
`src/lib/auth/staff-access.ts` → `useOrg()`).

**Flow:**
1. `handleAction("process")` → `openTyroChargeWindow(sessionId)`
   (`src/lib/payments/tyro-charge-window.ts`).
2. `POST /api/clinic/tyro-charge-config` (staff-auth gated by the session's
   location) returns: a minted SDK token, `app_id`, `env`, and the patient
   (incl. `refId`).
3. The browser loads `@medipass/partner-sdk` and calls **`renderCreateTransaction`**
   with **patient-only** pre-population (`refId` + name/dob/mobile).
4. Tyro's transaction window opens. The operator chooses the action (charge the
   stored card, or lodge a claim) and the provider; the patient's stored card is
   offered via `refId`.

**Auth:** the SDK render is authed with the minted **account-scoped token**
(`audience: aud:business-sdk`, `tokenType: 'account'`) + `appId`. The
`TYRO_API_KEY` is *not* exposed to the browser.

**Deliberate omissions (and why):**
- **No `funder`** — so the operator picks charge-vs-claim. This is the "general
  Tyro window" behaviour; `renderCreateTransaction` *is* Tyro's general
  transaction screen, and the funder picker is the action chooser.
- **No `providerNumber`** — `T01LHM0B` (the location id that works for the REST
  invoice path) is **rejected by the SDK** as "Provider number not found". The
  operator selects a registered provider in the window. To pre-fill it later,
  pass a real registered provider number (e.g. `2147661H`).

### Server-side charge (the other path)

`chargePayment(sessionId, amountCents)` in `src/lib/runsheet/actions.ts` routes
through the provider abstraction and, for Tyro, creates an **invoice**
(`POST /v3/transactions/invoices`, flat request shape, `providerNumber` =
`tyro_provider_number`) returning a hosted **`paymentRequestUrl`**. This is the
*patient-present* charge (surfaced as a link in the Process slide-over for
non-bypassed flows). The clinic Process action (§7 above) is the primary charge
path for Tyro orgs; this invoice path remains for the slide-over / other
providers and records the `payments` row.

> Tyro charge requests are FLAT-shaped: top-level `providerNumber` + flat
> `patient` object (NOT `patient.identity`). The nested form is the PHI/HICAPS
> claim variant and 400s with `errorCode 13001`.

---

## 8. Webhooks

`src/app/api/webhooks/tyro/route.ts` handles `invoiceCompleted` /
`invoiceCancelled`. It matches the `payments` row by `provider_txn_id`
(transactionId), flips status (`completed` / `failed`), and broadcasts
`session_updated` so the run sheet refetches.

Webhook URLs are registered per-invoice in the charge body (`src/lib/payments/tyro.ts`).
**Local caveat:** they point at `getBaseUrl()` — on `localhost` Tyro can't reach
them, so webhooks only fire against a deployed URL or a tunnel.

---

## 9. Data model (migration 026)

`supabase/migrations/026_tyro_payments.sql` (applied to the `cotwo` Neon DB),
mirrored in `src/lib/db/schema.ts`. All additive; existing Stripe columns kept.

- `organisations`: `payment_provider` (text, default `'stripe'`, CHECK),
  `tyro_provider_number` (text), `tyro_api_key_encrypted` (text, AES-GCM blob),
  `tyro_business_id` (text)
- `patients`: `provider_customer_ref` (text) — the `refId`
- `payment_methods`: `provider` (text, default `'stripe'`); `stripe_payment_method_id` made nullable
- `payments`: `provider`, `provider_txn_id`, `payment_request_url`

Payment status mapping (reuses the `payment_status` enum): Tyro pending /
awaiting → `processing`; `invoiceCompleted` → `completed`; `invoiceCancelled` →
`failed`.

---

## 10. Settings UI

`src/components/clinic/settings/payments-settings-shell.tsx` — admins pick the
org's provider (Stripe / Tyro Health / Console). For Tyro they **connect their
account by pasting their API key** (the business id is derived server-side). The
`tyro_provider_number` column still exists and is honoured by the server-side
invoice path, but is no longer collected in the UI (the operator picks the
provider in Tyro's charge window). When Tyro is
selected, the Stripe-specific sections (Payment routing, Stripe Connect) are
hidden. Persisted via the `set_provider` and `set_tyro_credentials` actions on
`PATCH /api/settings/payments`. The API key is never sent back to the client —
the config exposes only `tyro_connected` (boolean).

---

## 11. The golden rule

No `if (provider === 'tyro')` outside `src/lib/payments/` and the thin UI branch
points that need it (the entry card step, the Process action, the Settings UI).
Provider-specific transport lives behind the `PaymentProvider` interface.

---

## 12. Still to verify / known gaps

- **Live SDK charge end-to-end** — the transaction window opens and authenticates;
  a full charge of the stored card through to settlement needs a real operator run.
- **Provider pre-fill** — operator currently picks the provider in the window
  (the location id isn't a valid SDK provider number).
- **Webhooks on localhost** don't fire (see §8).
- **Stripe remains stubbed** — this work only keeps the stub behind the interface.
- **`@medipass/partner-sdk`** is a real dependency (browser SDK for the charge
  window). Earlier `renderAuthorizePayment` attempts failed ("Missing
  authentication" — it needs a pre-existing transaction intent); `renderCreateTransaction`
  is the documented, working method.

---

## 13. Verifying the API (without the app)

`scripts/tyro-smoke-test.mjs` POSTs a minimal invoice to staging and prints the
`paymentRequestUrl` — useful for confirming creds / base URL / request shape.
Tyro test card: `5123450000000008`, exp `01/39`, CVC `100` (APPROVED). Charge
amounts `$2000`–`$2999` simulate declines.
