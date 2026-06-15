# Incoming-Call → Patient Panel Pop (Twilio test trigger)

## Goal

You dial a Twilio number **from a test patient's phone number**; Twilio calls our
webhook; we match the calling number to a patient and **pop that patient's contact
card** on the demo operator's run sheet. If the number doesn't match, a generic
"unknown caller" panel opens.

This is an **internal testing trigger**, not a phone-system integration. It exists to
demonstrate the call-pop UX end-to-end with a real phone call, without standing up a
real PBX. The card shows whatever the existing patient panel already shows
(appointments, forms, workflows, contact details, payment status).

> **Scope history (why this is small).** Earlier versions of this plan targeted a
> real phone system (3CX, then Aircall/RingCentral) so the *answering staffer's* own
> screen would pop — which requires the phone system to report who answered.
> Decision: **don't build the real integration now.** Use **Twilio purely as a test
> trigger** — dial a number, fire the webhook, pop the matched patient on the current
> demo user's screen. No provider abstraction, no onboarding step, no extension
> mapping, no click-to-dial. Those belong to the real-phone-system version, which is
> deferred (the Aircall/RingCentral analysis lives in this file's git history). The
> real providers (Aircall `call.answered`, RingCentral telephony-session
> `status:Answered`) both verified to carry the answering agent + caller number +
> hangup over a push webhook — that's the upgrade path when it's wanted.

## Why Twilio for this

- We just need "a real call rings a number → our app gets told the caller's number."
  Twilio's inbound voice webhook delivers exactly that (`From`, `To`, `CallSid`,
  `CallStatus`) with the least setup.
- Twilio is **not** a phone system with agents/extensions — so it can't report "who
  answered." That's fine here: this is a single-operator demo trigger, so we pop on
  the **current logged-in user**. (That limitation is precisely why Twilio is a test
  tool, not the production mechanism.)
- **Trial caveat:** inbound calls to a Twilio *trial* number only work from
  pre-verified caller IDs (SMS-verified). Since we match on the calling number anyway,
  verify the handful of test phones you'll dial from — or upgrade off trial (cheap) so
  any phone works.

## Scope (locked)

In: dial a Twilio number from a known test number → webhook → `normalisePhone(From)`
→ patient match → pop on the current demo user's run sheet → close affordance.

Out: real phone-system integration, "who answered" targeting, provider abstraction,
onboarding step, per-user extension field, click-to-dial, transfers, PMS fallback.
All deferred to the real-phone-system version.

## TL;DR mechanism

```
Dial the Twilio number FROM +6140000TEST1 (a seeded test patient's number)
        │
        ▼
Twilio voice webhook  ──►  GET/POST /api/telephony/twilio/events/<path_token>
   (params: From, To, CallSid,           │  (path_token selects the config row)
    CallStatus, Direction, AccountSid)   │ 1. verify X-Twilio-Signature (RequestValidator,
                                         │    against the STORED exact webhook_url + all params)
                                         │ 2. normalisePhone(From) → patient_phone_numbers match (org-scoped)
                                         │ 3. broadcastIncomingCall(locationId,
                                         │       { userId: config.demo_user_id, callId: CallSid, match })
                                         ▼
                          Socket.io: incoming_call  ──►  demo target user's run sheet
                                                              │
                                                              ▼
                                                    PatientContactCard opens
        │
   respond with TwiML that KEEPS THE CALL ALIVE:
   <Say>Coviu test received.</Say><Pause length="60"/>   (card stays up while call is live)
        │
   caller hangs up ──► status callback /…/<path_token>/status (fast 2xx, no TwiML)
                       ──► broadcastCallEnded ──► card closes
                       (tester fallback: auto-close after N s / manual close)
```

The build is small: **one inbound webhook route, a phone-match, two socket events
(`incoming_call` / `call_ended`) with run-sheet listeners, and a minimal settings
panel to hold the Twilio config + nominate the demo target user.**

## Decisions made

| Question | Decision |
|----------|----------|
| Provider | **Twilio only**, as an internal test trigger. No abstraction layer. |
| Which patient pops? | Match the **calling number** (`From`) → `patient_phone_numbers` (seed test patients with known numbers). |
| Whose screen pops? | A **configured demo target user** (`demo_user_id`, defaults to the current user at save). A server-to-server webhook can't know which browser is "current". |
| No match? | Generic "unknown caller" panel; multi-match reuses the multi-contact chooser. |
| Close on hangup? | Yes — Twilio StatusCallback `completed` → close (matched by `CallSid`). |
| Where config lives | **Settings page only** (new "Phone (testing)" card). **No onboarding step.** |
| Onboarding / extension field / click-to-dial | **Out** — belong to the real-phone-system version. |

## Existing pieces we reuse

| Piece | Path | Role here |
|-------|------|-----------|
| `PatientContactCard` | `src/components/clinic/patient/patient-contact-card/index.tsx` | The panel that pops. Presentational; parent owns open state + `patientId`. |
| `PatientSlideOverContext` | `src/components/clinic/patient/patient-slide-over-context.tsx` | Today exposes **only** `openPatient(patientId)`. Extend with `openUnknownCaller(number)` + `closePatient()`. (Net-new surface.) |
| Phone → patient resolution | `src/app/api/patient/otp/verify/route.ts` | The `patient_phone_numbers` ⋈ `patients` query, scoped by `patients.orgId`. Reuse the shape. |
| `normalisePhone()` | `src/lib/phone/normalise.ts` | Canonical E.164 normalisation for matching. |
| Broadcast helpers | `src/lib/realtime/broadcast.ts` | Add `broadcastIncomingCall()` / `broadcastCallEnded()` (room `location:{id}`). Same shape as existing `broadcastSessionChange()`. No persistent socket needed. |
| Clinic socket subscription | `src/hooks/useSocketRoom.ts`, `src/components/clinic/shared/clinic-data-provider.tsx` | Add `incoming_call` + `call_ended` to the location `eventMap`. |
| Inbound route + bearer-secret convention | `src/app/api/cron/pms-sync/route.ts` | The webhook route copies the secret-verification shape (cron uses `CRON_SECRET`). Twilio adds signature verification on top. |
| Settings hub | `src/app/(clinic)/settings/page.tsx` (`settingsCards`) | Card grid (not tabs). Add a "Phone (testing)" card → new page. |
| Connect-flow pattern (lightweight) | `src/lib/pms/credentials.ts` (`encryptCredentials`), `src/components/clinic/settings/integrations/*` | Reuse the AES-256-GCM cred encryption + the settings-shell shape for the (small) Twilio config panel. |

> **Verified gaps to build (not reuse):** there is no telephony config table; the
> only server-to-server auth pattern is the cron `CRON_SECRET` bearer check;
> `PatientSlideOverContext` has no number-based / close methods.

## Build

### 1. `telephony_test_config` (minimal) + settings panel

We need somewhere to hold the Twilio config and which user/location is the demo
target. Keep it small — this is a test tool.

```
telephony_test_config
  id                     uuid pk
  location_id            uuid fk(locations)   -- unique (1 test config per location)
  org_id                 uuid fk(organisations)
  twilio_account_sid     text                 -- identifies the Twilio account
  twilio_phone_number    text                 -- E.164; the dialled number. Resolve config by (account_sid, To)
  path_token             text                 -- hard-to-guess segment in the webhook URL; PRIMARY config locator
  webhook_url            text                 -- the EXACT public URL pasted into Twilio (used verbatim for signature validation)
  auth_token_encrypted   text                 -- Twilio auth token (for X-Twilio-Signature verify), encrypted
  demo_user_id           uuid fk(users)       -- whose screen the pop targets (configured; defaults to current user at save)
  status                 text                 -- configured | off
  last_event_at          timestamptz          -- last webhook received (liveness)
  created_at / updated_at timestamptz
```

**Config locator (finding: AccountSid alone is insufficient).** One Twilio account
may be reused across demo locations, so `AccountSid` alone can't identify the config.
The **`path_token` is the primary locator** — each config gets a unique, hard-to-guess
segment baked into its webhook URL (`/api/telephony/twilio/events/<path_token>`), so
the URL itself selects the row. Secondary/validation: confirm `(twilio_account_sid,
To)` matches the resolved row (Twilio always sends `To`).

- Migration via Neon MCP (Neon, not Supabase).
- **Reuse `encryptCredentials()`** in `src/lib/pms/credentials.ts` for the auth token.
- **Settings page:** add a card to `settingsCards` in
  `src/app/(clinic)/settings/page.tsx`: `{ title: "Phone (testing)", href:
  "/settings/phone-test", … }`. New page `src/app/(clinic)/settings/phone-test/page.tsx`:
  - A short form: Twilio Account SID + Auth Token + the Twilio phone number, and a
    **demo-target-user** picker (defaults to the current user **at save time** — the
    chosen user is persisted as `demo_user_id`; the webhook can't know who's "current").
  - The **webhook URL to paste into Twilio** (read-only, copyable): our public
    `/api/telephony/twilio/events/<path_token>`. This exact string is stored as
    `webhook_url` and used verbatim for signature validation (see route step 1).
  - Status line: "configured / last test call N min ago" from `last_event_at`.
  - PM-role gated (`requireStaffLocationAccess` + PM-roles check), same as other
    settings.
- **No onboarding step.** This does not touch `src/app/setup/*` or `getSetupState()`.

### 2. Routes — voice webhook + call-ended callback (kept separate)

Two distinct concerns (finding: voice TwiML response ≠ status-callback response):
the **voice webhook** returns TwiML that drives the call; the **call-ended callback**
just needs a fast 2xx. Both live under the path-token so config resolves from the URL.

**A. Voice webhook — `GET/POST /api/telephony/twilio/events/<path_token>`**
(Twilio sends GET or POST per the number's config — accept both.)

1. **Resolve config** by `<path_token>` (the primary locator). Cross-check
   `(twilio_account_sid, To)` matches the row; reject on mismatch.
2. **Verify `X-Twilio-Signature`.** Use Twilio's **`RequestValidator` helper** (don't
   hand-roll the HMAC) with the stored **`webhook_url`** (the exact public URL pasted
   into Twilio) and **all** request params — not a hand-picked subset. Behind Railway's
   proxy, do **not** reconstruct the URL from the incoming request (host/proto/path can
   differ); validate against the stored `webhook_url`. Reject if invalid — this endpoint
   emits patient identity, so it must not be open.
3. **Parse** params: `From`, `To`, `CallSid`, `CallStatus`, `Direction`.
4. **Resolve + emit** (on the inbound call):
   - `normalisePhone(From)` → `patient_phone_numbers` ⋈ `patients` scoped to org
     (OTP-verify query shape). 0 / 1 / many. Anonymous/withheld `From` → `unknown`.
   - `broadcastIncomingCall(locationId, { userId: config.demo_user_id, callId:
     CallSid, match })`, `match` ∈ `{ kind:'patient', patientId }` |
     `{ kind:'multi', patientIds[] }` | `{ kind:'unknown', number }`.
   - Update `last_event_at`.
5. **Respond with TwiML that keeps the call alive** so the popped card stays up until
   the *caller* hangs up (finding: `<Hangup/>` ends the call immediately, which would
   auto-close the card the instant it opened):
   `<Response><Say>Coviu test received.</Say><Pause length="60"/></Response>`
   (or a longer/looped pause). Include the end-callback on the call so we learn when
   the caller hangs up — e.g. a `<Dial>`/redirect with an `action`/`statusCallback`
   pointing at route **B**. **Do not** emit `call_ended` here.
6. **PII discipline:** log only non-identifying metadata (location, match/no-match,
   CallSid). Never log the caller number or patient details.

**B. Call-ended callback — `POST /api/telephony/twilio/events/<path_token>/status`**

- Fired when the call completes (`CallStatus: completed`). Resolve config by
  `path_token`, verify signature (same helper, against the status URL stored likewise).
- `broadcastCallEnded(locationId, { callId: CallSid })`. Return a **fast empty 2xx** —
  no TwiML (this is an async status callback, not call instructions).
- Idempotent on `CallSid`.
- *Tester fallback:* if wiring the end-callback is fiddly, the client may also
  auto-close after N seconds or on manual close — acceptable for an internal tester.

### 3. Socket events — `incoming_call` / `call_ended`

- **Server:** add `broadcastIncomingCall(locationId, payload)` and
  `broadcastCallEnded(locationId, { callId })` to `src/lib/realtime/broadcast.ts`,
  emitting into `location:{locationId}`. Payloads carry the target `userId` + `callId`.
- **Client:** add both to the location `eventMap` in `clinic-data-provider.tsx`:
  - Ignore if `payload.userId` isn't the current user (event is location-scoped; the
    client filters to the demo target).
  - `incoming_call`: `patient` → `openPatient(patientId)`; `multi` → multi-contact
    chooser; `unknown` → `openUnknownCaller(number)` (generic panel: the number +
    search / create-patient affordance).
  - `call_ended` (matching `callId`) → close the card if this call opened it and the
    user hasn't manually navigated elsewhere.

## Edge cases

1. **Twilio trial inbound restriction.** Trial numbers only accept calls from
   SMS-verified caller IDs. Verify the test phones you dial from, or upgrade off trial.
   Document in the settings panel help text.

2. **Signature verification.** Verify `X-Twilio-Signature` via Twilio's
   `RequestValidator` helper, against the **stored exact `webhook_url`** and **all**
   params (not a reconstructed URL, not a param subset). Behind Railway's proxy,
   reconstructing the external URL from the request can fail — validate against the
   stored URL. Without this the endpoint is an open phone→patient identity API.
   Non-negotiable.

7. **TwiML must keep the call alive.** `<Hangup/>` (or letting the TwiML simply end)
   terminates the call immediately, which fires the completed callback and auto-closes
   the card the instant it opened. Return `<Say>…</Say><Pause length="60"/>` (or a
   pause loop) so the card stays up until the *caller* hangs up. The card closes from
   the **separate** status callback (route B), not from the voice webhook.

3. **No match.** `unknown` panel with the (normalised) number; still a useful demo of
   the absent-record case.

4. **Card already open / repeated test calls.** Newer `incoming_call` replaces the
   current pop unless the user manually interacted; `call_ended` only closes the card
   whose `CallSid` opened it.

5. **Idempotency / retries.** Twilio retries on non-2xx; respond 200 + TwiML quickly,
   key on `CallSid` so a duplicate doesn't double-pop.

6. **Liveness.** Track `last_event_at`; show it in settings so a misconfigured webhook
   is visible ("no test call received yet").

## Out of scope (→ real-phone-system version, deferred)

- Real phone-system integration (Aircall `call.answered`, RingCentral telephony
  sessions) and true "answering staffer's screen" targeting.
- Provider abstraction layer, onboarding step, per-user extension field, click-to-dial.
- Transfers / ring groups / hold / multi-party.
- PMS phone-number fallback (`getPatientByPhone()`).
- Call logging / writeback to the PMS.

## Rough effort

- `telephony_test_config` migration + minimal settings panel: ~half a day.
- Twilio webhook route (signature verify, parse, match, emit, TwiML response):
  ~half–1 day.
- Socket events + client listeners + slide-over `openUnknownCaller`/`closePatient`:
  ~1 day.
- Test setup (verify caller IDs / upgrade off trial, point the number at the route):
  ~half a day of fiddling.

**Net:** small — a focused internal test trigger, no persistent connections, no
provider matrix.

## Open questions for later

- When the real integration is wanted: pick Aircall vs RingCentral (both verified to
  carry the answer event + caller number + hangup; RingCentral has free repeated
  testing behind a KYC/business-doc gate, Aircall has a lower gate but real-call test
  cost). Reintroduce the provider interface + onboarding + extension field then.
