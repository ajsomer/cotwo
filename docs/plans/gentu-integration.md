# Plan: Gentu (Magentus) Integration (two-way) — third provider behind the normalization layer

Status: **Spine built on branch `feat/gentu-integration`; live verification
blocked on Magentus.** The adapter (`src/lib/pms/gentu/`), the five generic-layer
changes (§1a), and the registry line are implemented — `tsc`, lint, and
`npm run build` clean. The demo stub is replaced with a real adapter. **Not yet
verified end-to-end** against a Magentus tenant: every authed tenant call 500s
on `app.partnerId` (the sandbox app isn't provisioned — §0a), and the marketplace
listing that generates pairing codes is a Magentus-side prerequisite (§1a.5).
Unverified API behaviours are pinned with `⚠️ verify` constants + actionable
fallbacks. **First write holds for sign-off** regardless. App credentials are in
`.env.local` (app-level OAuth client — see §10). Not committed/merged.

Gentu is the **third concrete `PmsAdapter`** behind the vendor-agnostic layer
that Cliniko established (`docs/plans/cliniko-integration.md`) and Nookal
validated (`docs/plans/nookal-integration.md`). The generic spine — schema, sync
engine, Settings → Integrations, form builder binding, push UI, deep links,
connect route — is reused. The bulk of new code is `src/lib/pms/gentu/`, one
line in `registry.ts`, and the setup-grid flip. The genericise pass that Nookal
did (§3a of its plan) is **already done on `main`**, so this build inherits a
clean generic layer.

**What makes Gentu different from the first two providers** (and where the risk
concentrates — each is a section below):
1. **OAuth2 client-credentials + a pairing-code bootstrap**, not a static API
   key. App creds are app-wide (env); the per-clinic secret is the pairing code
   → `tenantId` (§3, §10).
2. **Two APIs**, split by job: reads off **Healthcare**, writes off **Bookings**,
   attachment off **Healthcare** (§4).
3. **No incremental cursor** — appointment list is `fromDate`/`toDate` window
   pagination with no `updatedAt`; sync is a rolling re-sweep (§5).
4. **No structured form sink** anywhere → `writeForms: false`, the Nookal shape
   (§6).

**The golden rule:** if you add `if (provider === 'gentu')` anywhere outside
`src/lib/pms/gentu/`, stop — that logic belongs behind the `PmsAdapter`
interface (`capabilities()`, `fieldCatalogue()`, `validateField()`,
`credentialFields()`, `webLinkForPatient()`, `getWebHint()`,
`uploadPatientAttachment?()`).

API reference: **`docs/architecture/gentu-bookings-healthcare-api.md`** is the
companion to this plan — it has the per-endpoint detail, the FHIR-shape traps,
and the live-tenant verification checklist. Read it alongside §4–§6 here.

---

## 0. What already exists and is reused verbatim

Read these first — they are the contract and the blueprint:

- `docs/architecture/pms-integrations.md` — current-state reference for the
  whole layer (ring model, golden rule, `orchestratePush`/`fillBlanksWrite`,
  capabilities-are-truthful, schema, sync). **This is the spec Gentu implements.**
- `docs/architecture/gentu-bookings-healthcare-api.md` — the Gentu API surface,
  endpoint by endpoint, with the seven live-tenant verification items.
- `docs/plans/cliniko-integration.md` / `docs/plans/nookal-integration.md` —
  the two prior builds. **Almost everything is provider-agnostic.** Nookal is
  the closer analogue (second provider, `writeForms: false`, reused spine).
- `src/lib/pms/adapter.ts` — the `PmsAdapter` / `PmsAdapterFactory` contract +
  `PmsCapabilities`, `PmsFieldCatalogueEntry`, `PmsCredentialField`. Implement
  only the optional methods (`uploadPatientAttachment?`, `getWebHint?`) Gentu
  supports.
- `src/lib/pms/types.ts` — canonical `PmsPatient`, `PmsAppointment`,
  `PmsPractitioner`, `PmsAppointmentType`, `PmsBusiness`,
  `PmsFormSubmissionInput`, `PmsPushResult`/`PmsFieldResult`. **Do not change
  these** unless Gentu genuinely needs a new canonical field.
- `src/lib/pms/push-helpers.ts` — `orchestratePush`, `fillBlanksWrite`,
  `validateCatalogueValue`. The write skeleton lives here; Gentu supplies only
  API-call hooks. **Do not copy the skeleton into the adapter.**
- `src/lib/pms/cliniko/` and `src/lib/pms/nookal/` — the **templates** for the
  `gentu/` folder (`client.ts`, `types.ts`, `map.ts`, `field-map.ts`,
  `adapter.ts`). Nookal is the better starting point for capabilities shape
  (`writeForms: false`, separate read/write field maps).
- `src/lib/pms/registry.ts` — `FACTORIES` maps provider enum → factory.
  **One line added here.**
- `src/lib/pms/connection.ts`, `credentials.ts` — opaque AES-256-GCM credential
  blob + connection loading + `adapterForConnection`. Generic; reused as-is
  (the Gentu blob holds the pairing-derived `tenantId`, not an API key — §3).
- `src/lib/pms/integrations-service.ts` — `connectPms`, `provisionFromPms`
  (rooms from practitioners, practitioner→room map, business→location map, type
  import), mapping writers, `importAppointmentTypes`, `confirmAppointmentTypeSync`.
  Generic; works for Gentu once the adapter exists.
- `src/lib/pms/sync/pull.ts`, `push.ts`, `cursor.ts`, `mapping.ts` — the sync
  engine. Talks only to `PmsAdapter`. Already normalises phones to E.164, marks
  the first phone primary, upserts on connection-scoped keys, lazy-fetches
  unlinked patients, reconciles, and calls `scheduleWorkflowForAppointment`.
- `src/lib/pms/session-gate.ts`, `web-link.ts`, `seeded-registration-form.ts` —
  generic.
- All `src/app/api/pms/*` routes + `src/app/api/setup/pms/connect/route.ts` —
  generic; resolve the adapter via the registry, never branch on provider.

**The Nookal genericise pass is done** — the three Cliniko-hardcoded leaks it
fixed (`connect-form.tsx` provider, two `as "cliniko"` casts) are already on
`main`, so the **Settings → Integrations** connect path is provider-clean.

**But Gentu is NOT a clean drop-in like Nookal was.** It requires five changes
*outside* `src/lib/pms/gentu/` — three because Gentu today is a **live demo
simulation** (a fake-connect path that seeds demo data and writes a
credential-less marker), and two because of generic-contract gaps Cliniko/Nookal
never hit (the attachment lacks practitioner context, and OAuth pairing needs a
credential-exchange hook). These are spelled out in **§1a** and must be done as
part of this build — do not assume the spine is untouched. The `/api/setup/pms`
**demo route**, the **setup grid's Gentu exception**, the **setup/rooms
imported-flag**, the **attachment interface**, the **`exchangeCredentials`
factory hook + `connectPms`**, and the **no-PMS skip path** all change. None of
them is a `provider === 'gentu'` branch; they're generic-layer corrections.

---

## 0a. Live sandbox auth check (2026-06-15) — what's settled and what's blocked

App credentials (`GENTU_API_KEY` = client id, `GENTU_API_KEY_SECRET` = client
secret, `GENTU_APP_ID`) are in `.env.local`. Ran the documented "first API call"
flow against `api.pm.sandbox.magentus.com` (read-only, secrets/token redacted).

**Settled (verified live):**
- **Token endpoint is `POST /v1/oauth2/token`** — note the `/v1` prefix; the
  OpenAPI specs' bare `/oauth2/token` is wrong. Auth is **HTTP Basic**
  (`--user client_id:secret`) + `grant_type=client_credentials` form body.
- **Token: `expires_in: 3599` (~1h), `refresh_token_expires_in: 0`** — no
  refresh token. Re-mint from client-credentials on expiry → **in-memory cache +
  re-mint is correct; no persist-back hook** (§10, §2 item 2). `status: approved`.
- **App ID returns as `application_name`** on the token response; it's only
  needed for the pairing call, not for token mint or normal requests.

**Blocked (Magentus must provision the app):**
- Every authenticated tenant-scoped call (`GET /v1/tenants`,
  `GET /v1/tenants/{id}/status`) returns **`HTTP 500 {"fault":{"faultstring":
  "Unresolved variable : app.partnerId","errorcode":"entities.UnresolvedVariable"}}`**.
  The token is accepted (no-auth correctly `401`s; our token gets past auth into
  the gateway), so **auth works** — the app is missing its `partnerId` / tenant
  pairing on Magentus's side. Their own guide says to contact them on this error.
- **This blocks the live-verification half of the build, not the build itself.**
  See §8a for what's buildable now vs. gated. App ID
  `d24d9845-b7c7-450c-a0f1-fcb6734662ae` is the public Apigee identifier (safe to
  quote to Magentus); the key/secret/token were never exposed.

---

## 1. Goal

A two-way Gentu integration, structured identically to Cliniko/Nookal:

- **Read (inbound):** pull Gentu appointments into the Coviu appointment book so
  the run sheet reflects Gentu, with patients, practitioners, appointment types,
  and the location concept as dependencies. Telehealth-only scope for v1.
- **Write (outbound):** push completed Coviu form submissions back into Gentu —
  **patient demographic fields** (`PATCH /patients`, Bookings) and the **intake
  PDF as a categorised attachment** (`PUT .../attachments`, Healthcare). **No
  structured form-answer write** (`writeForms: false`, §6).

---

## 1a. Code/contract changes this build requires (NOT just a new adapter folder)

Unlike Nookal — which dropped in as pure new-folder code behind an unchanged
spine — Gentu touches **five things outside `src/lib/pms/gentu/`**. Three are
because Gentu today is a **demo simulation, not a registry stub**, and two are
genuine generic-contract gaps that Cliniko/Nookal never exercised (the
attachment practitioner context, and the credential-exchange hook for OAuth
pairing). Each is a deliberate generic-layer change (not a
`provider === 'gentu'` branch), so the golden rule holds.

### 1a.1 Replace the Gentu demo path with the real registry-backed connect

Gentu is **not** a passive enum stub today — there is a live fake-connect path
that must be torn out and replaced, or the real adapter and the demo will both
exist and fight:

- **`src/components/setup/pms-selection-grid.tsx:81`** special-cases
  `provider.id !== "gentu"` for the real credential modal and routes Gentu
  (`:95`) down a "demo simulation" branch that POSTs `/api/setup/pms`. **Remove
  the Gentu exception** so Gentu flows through the same
  `/api/pms/providers`-driven credential modal as every other registry provider
  (it will render `credentialFields()` → the pairing-code field, §3).
- **`src/app/api/setup/pms/route.ts:59`** — the `if (provider === "gentu")`
  block calls `seedGentuData()` (seeds demo forms, three rooms, four fake
  clinicians via direct `public.users` inserts) and writes a **credential-less
  `provider:"gentu", status:"connected"` marker**. **Delete the Gentu branch and
  `seedGentuData()` entirely.** A real Gentu connection is created by the
  generic `connectPms` path (`/api/setup/pms/connect` → registry), is
  **sync-active only with credentials**, and provisions real rooms/types from
  the live tenant via `provisionFromPms`. The demo clinicians/forms/rooms have
  no place once the adapter is real.
- **`/api/pms/providers`** exposes Gentu automatically once `gentuFactory` is in
  `FACTORIES` (it reads `staticMetadata()`); no change there beyond the registry
  line.
- **`src/app/api/setup/rooms/route.ts:44-49`** computes `imported` as
  *sync-active connection* **OR** *credential-less Gentu marker*. **Drop the
  Gentu-marker clause** — after the real adapter, "imported" means
  sync-active/provisioned (the `credentialsEncrypted` check alone), and a clinic
  that skips PMS goes through manual room entry (see 1a.2).

> ⚠️ Migration note: any existing demo `pms_connections` row
> (`provider:"gentu", status:"connected", credentials_encrypted IS NULL`) is a
> **marker, not a real connection**. Decide explicitly whether to leave it
> (harmless — never sync-active, so sync/push ignore it) or clean it up at
> deploy. Don't let it shadow a real connect; same-location `onConflictDoUpdate`
> on `pms_connections.location_id` means a real connect overwrites it anyway.

### 1a.2 First-class "no PMS" pathway (currently mislabelled as skipped Cliniko)

`src/app/api/setup/pms/route.ts:81-96`: when `provider` is `null` (the clinic
chose **no PMS**), the route writes `provider: (provider ?? "cliniko"),
status: "skipped"` — because `pms_connections.provider` is **non-null**. So
**"no PMS" is stored as "skipped Cliniko"**, which leaks into Settings defaults
and any provider-derived copy. This is not good enough for a first-class no-PMS
clinic.

**Decision (2026-06-15): model no-PMS as no `pms_connections` row.** The user
still clicks "No PMS" in the setup grid — that affordance stays. What changes is
the route's *response*: the `provider === null` branch **writes nothing**
instead of a fake Cliniko marker. Settings derives "No PMS connected" from the
absent row. No schema change. (We do **not** need to distinguish "deliberately
chose no PMS" from "never finished setup" — absence covers both acceptably.)

**The work is the audit, not the write.** Removing the marker write is one
edit; the obligation is confirming **a missing `pms_connections` row reads
correctly everywhere**:
- **Setup gate / middleware** must treat "no row" as *PMS step satisfied,
  proceed* — **not** loop the clinic back into the PMS step. This is the one to
  get right: if the gate keys "PMS step done" off a row existing, a no-PMS
  clinic gets stuck. Verify before shipping.
- **Settings → Integrations** renders "No PMS connected" + a connect CTA from an
  absent row (it largely does — `isSyncActive` is row-or-credential gated).
- **`/api/setup/rooms`** (§1a.1): "no row" → manual room entry, not "imported."

Make this change **before the setup-grid flip**, since the grid's "No PMS"
choice posts through this same route.

### 1a.3 Attachment upload needs practitioner context — extend the interface

`uploadPatientAttachment?` (`src/lib/pms/adapter.ts:111`) currently passes only
`{ externalId, fileName, contentType, contentBase64, description? }` — **no
appointment or practitioner**. But Gentu's `PUT .../attachments` **requires a
`practitionerId` query param**. The plan's "map to the appointment's
practitioner" is impossible from inside the adapter as the interface stands.

**Planned generic change** (benefits any future provider that files
practitioner-scoped documents):

- Extend the `uploadPatientAttachment` input with optional
  **`practitionerExternalId?: string`** (resolved, PMS-side id).
- The call site `attachIntakePdfToPms` resolves it from the **authoritative
  source**: the appointment's stored `pms_external_id` →
  `adapter.getAppointment(extId)` → its real `practitionerExternalId`. Do **not**
  reverse `room_id → pms_practitioner_links` as the primary path — a shared room
  maps to a single practitioner, and mappings can drift after sync, so the
  room-reverse is wrong for shared/multi-practitioner rooms. Use the room-reverse
  (`getPractitionerExternalByRoom`) only as a **fallback** for manual
  (non-PMS-sourced) appointments with no `pms_external_id`. Cliniko/Nookal ignore
  the new field, so it's additive and non-breaking.
- Gentu's adapter reads `practitionerExternalId` for the required query param;
  if it's absent, return an actionable `{ ok: false, detail: "Gentu needs a
  practitioner to file the attachment against." }` rather than a 400.

### 1a.4 Side-loaded patients don't fit the current pull contract — pick a model

`pullConnection` (`src/lib/pms/sync/pull.ts:55`) calls **`listPatients()`
before `listAppointments()`**, and `PmsAppointment` (`types.ts`) carries **no
embedded patient payload**. So the "patients arrive side-loaded from the
appointment list" idea (Healthcare `include=patients`) has nowhere to land under
today's contract without awkward adapter-internal caching. **Decide explicitly,
and prefer the no-contract-change option:**

- **(Preferred) `listPatients()` yields nothing for Gentu; `getPatient()`
  lazy-fetches by id during appointment upsert.** The pull already lazy-fetches
  unlinked patients via `adapter.getPatient(externalId)` during
  `upsertAppointment` — so an empty `listPatients` + a working `getPatient`
  (Healthcare `GET .../patients/{id}`) gives correct behaviour with **zero
  generic change**. The `include=patients` side-load becomes a *latency
  optimisation we skip for v1*, not a correctness requirement. Document this in
  `listPatients`/`listAppointments` comments.
- **(Alternative, only if lazy-fetch is too chatty)** change the sync contract so
  an appointment batch can carry side-loaded patients (e.g. `listAppointments`
  yields `{ appointment, patient? }`, or a new `listAppointmentsBatch`). Heavier,
  touches the generic pull and every adapter — defer unless live testing shows
  the per-appointment `getPatient` fan-out is a real problem (§2 item 3 window
  size feeds this).

### 1a.5 Credential-exchange hook on the factory (OAuth pairing)

Cliniko/Nookal store the connect-form input (an API key) verbatim. Gentu
collects a **one-time `pairing_code`** that must be exchanged for a durable
`tenant_id` at connect — the code is single-use, so it can't be the stored
secret. This needs a generic-contract addition (it's not a `provider==='gentu'`
branch — every future OAuth/pairing provider uses it):

- **`PmsAdapterFactory.exchangeCredentials?(input): Promise<{ok:true,
  credentials} | {ok:false, detail}>`** (`src/lib/pms/adapter.ts`) — optional;
  turns connect-form input into the blob that gets stored. Omitted by
  key-based providers (input stored as-is).
- **`connectPms`** (`src/lib/pms/integrations-service.ts`) calls it **before
  verify/encrypt**, aborting the connect with the actionable detail on failure.
  Gentu's implementation consumes the pairing code
  (`PUT /apps/{appId}/pairing/{code}`) and returns `{ tenant_id }`.
- The pairing code's marketplace generation is a **Gentu-side prerequisite**
  (our app must be listed in their marketplace so the practice can click "Add
  to Gentu" → get a code). That's not our code — it's a Magentus
  onboarding/listing step, and a second blocker alongside `app.partnerId`
  (§0a). Multi-user pairing (additional accounts → same tenant via the same
  endpoint) is **off by default** — request it from Magentus if multiple Coviu
  locations/users must attach to one practice.

These five changes are summarised again in the build order (§8) at the steps
they gate.

---

## 2. ⚠️ FIRST: verify the Gentu API surface against a live tenant

Unlike Cliniko/Nookal, Gentu ships **full OpenAPI specs**, so the *shapes* are
known (transcribed in the API reference doc). The risk has moved from "what's
the envelope" to **behaviour the specs don't pin down**. Treat the seven items
in `gentu-bookings-healthcare-api.md` §7 as verification tasks done before/while
coding. When a detail can't be confirmed, pin the best-known value as a
**clearly-commented constant with a "⚠️ verify against a live tenant" note** and
surface a specific, actionable error if wrong — never a bare status (mirror
Cliniko's `transportDetail`).

| # | What to confirm | Where it lands | Why it matters |
|---|---|---|---|
| 1 | **OAuth scoping.** One app credential for both Bookings + Healthcare, or separate? `api_product_list` on the token reveals it. ⏳ **BLOCKED** — the sandbox app isn't provisioned (see §0a); token mint omitted `api_product_list`. | `gentu/client.ts` | One token path vs two. |
| 2 | ~~**Token lifecycle.**~~ ✅ **VERIFIED 2026-06-15** (§0a): `expires_in: 3599` (~1h), `refresh_token_expires_in: 0` → **no refresh token; re-mint from client-credentials**. Confirms in-memory cache + re-mint (§10). | `gentu/client.ts` token cache | Settled. |
| 3 | **Re-sweep window.** Max `fromDate`/`toDate` width + any page-count / rate ceiling. Settled: there is **no incremental cursor** (§5). | `gentu/adapter.ts` `listAppointments` | Sweep window + cron cadence. |
| 4 | **Location concept.** Which of tenant / practitioner-site maps to a Coviu location and `PmsBusiness`? | `gentu/map.ts` + `provisionFromPms` | `locations.pms_external_id` value. |
| 5 | **Attachment `practitionerId`.** Acceptable to use the appointment's practitioner for a patient-authored intake PDF (it's a required query param)? | `gentu/adapter.ts` `uploadPatientAttachment` | Whether attachment write succeeds. |
| 6 | **Attachment body.** Raw binary vs `multipart/form-data` (the content-type enum lists both). | `gentu/adapter.ts` `uploadPatientAttachment` | Avoid hardcoding a rejected path. |
| 7 | **PATCH merge behaviour.** Does omitting a field leave it untouched, or null it? | `gentu/adapter.ts` write hooks | **Data-loss risk** — fill-blanks assumes omitted = untouched (§6). |
| 8 | **Identifier write validation.** Exact accepted formats for the typed-union identifiers (DVA `card-name`, Medicare IRN, `period.end`). | `gentu/field-map.ts` `validateField` | Whether to expose them in the catalogue at all. |

### 2a. Known sharp edges carried from the first two builds — pre-empt them

- **UUID ids — never `Number()` them.** Every Gentu id is a UUID string
  (tenant, patient, appointment, practitioner). No safe-integer hazard, but the
  "ids as strings end to end" rule still holds: stringify nothing-to-coerce at
  the `map.ts` boundary and never convert back. (Cliniko's bug was
  `Number(id)` on big integers — Gentu sidesteps it but the discipline is the
  same.)
- **Phone normalisation + primary phone.** The generic pull normalises synced
  phones to E.164 and marks the first primary. The adapter just returns the
  patient's phones in `PmsPatient.phoneNumbers` in sensible order (primary
  first). Gentu contacts are an array of `{system, use, rank, value}` — map the
  `phone/mobile` tuple, ordered by `rank`.
- **Connection-scoped upsert keys.** Idempotency is `(connection_id,
  pms_external_id)` via the link tables and `(location_id, pms_external_id)` for
  appointments. Generic — supply Gentu UUIDs as the external ids.
- **Sessions are workflow-backed, not direct.** Upserting an `appointments` row
  does NOT put it on the run sheet — the pull calls
  `scheduleWorkflowForAppointment` so `add_to_runsheet` spawns the session. The
  type needs a `type_workflow_links` row (type-import handles that). Generic.
- **Room placement = practitioner→room.** A synced appointment's room comes from
  `pms_practitioner_links.room_id`, not the type. `provisionFromPms` creates a
  room per practitioner and maps it. Pull gate: type confirmed telehealth +
  `sync_enabled` + practitioner mapped to a room. Generic.
- **Lazy patient + reconciliation.** Implement `getPatient(externalId)` and
  `getAppointment(externalId)` (single-record fetches, `null` on not-found) so
  the pull can lazy-link and reconcile. Note: the Healthcare appointment list
  side-loads patients/practitioners via `include=` (§5), which **reduces** but
  doesn't eliminate the lazy-fetch need.

---

## 3. What you're building — file by file

A new `src/lib/pms/gentu/` folder mirroring `nookal/`:

```
src/lib/pms/gentu/
  client.ts      # OAuth2 client-credentials transport: token mint/refresh (in-memory
                 #   cache), two API hosts/paths (Bookings + Healthcare), tenantId-scoped
                 #   base, URI-encoded ISO datetimes, backoff. Credential-gated (dormant
                 #   without app creds / tenantId).
  types.ts       # Raw Gentu (FHIR-ish) shapes — read/write subset only, not the whole spec.
  map.ts         # Raw ↔ canonical: patients (name extension-mode, typed identifier union,
                 #   contact tuples), appointments, practitioners, location concept→PmsBusiness,
                 #   appointment-types→PmsAppointmentType. UUID strings. NO appointment updatedAt.
  field-map.ts   # Static gentu:-namespaced patient_field catalogue (NO form-answer group)
                 #   + write-param map (per-identifier-type, not a rename table)
                 #   + GENTU_REGISTRATION_FIELDS + catalogueEntry() + read/write contact rules.
  adapter.ts     # Implements PmsAdapter; exports gentuFactory: PmsAdapterFactory.
```

### Adapter method checklist (`PmsAdapter`)

- `provider = "gentu"`, `displayName = "Gentu"`.
- `verify()` — `GET /v1/tenants/{tenantId}/status` ("Hello world!"). Map a
  failed token mint → `{ ok: false, detail: "Gentu rejected the app credentials." }`
  and a missing/expired pairing → an actionable "reconnect" detail.
- `listAppointments({ since?, businessId? })` — async-iterable. **Window
  re-sweep, not incremental** (§5): Healthcare `GET .../appointments` with
  `fromDate`/`toDate`, paging `pagination.next` to exhaustion, **per Gentu
  practitioner** from `listPractitioners()` (`practitionerId` is required; the
  adapter has no mapped-practitioner input, so it iterates ALL of them and the
  generic pull later skips appointments whose practitioner has no room mapping).
  **Ignore `opts.since`** (§5).
  `include=` side-load is optional and not used in v1 (§1a.4).
- `listPatients({ since? })` — **yields nothing for Gentu** (the preferred model,
  §1a.4): Healthcare has no list-since, so patients are lazy-fetched by
  `getPatient` during appointment upsert rather than listed. Document this in
  the comment so it doesn't read as a bug. (Do **not** rely on side-loaded
  patients under the current pull contract — they have nowhere to land; §1a.4.)
- `getPatient(externalId)` / `getAppointment(externalId)` — single fetches,
  `null` on not-found (Healthcare `GET .../patients/{id}`,
  `GET .../appointments/{id}`).
- `listPractitioners()` / `listAppointmentTypes()` / `listBusinesses()` — the
  location concept (§2 item 4) drives `listBusinesses`.
- `pushFormSubmission(input)` — delegate to `orchestratePush` from
  `push-helpers.ts`. Patient-field leg → `PATCH /patients/{id}` (Bookings),
  **fill-blanks-only with mandatory GET-first** (`fillBlanksWrite` `readCurrent`
  hook reads the patient; only currently-empty fields are written). **No
  form-answer leg** (`writeForms: false`). Resolve the Gentu patient UUID via
  `getPatientExternalId(connectionId, patientId)` from `sync/mapping`.
- `capabilities()` / `fieldCatalogue()` / `validateField()` /
  `credentialFields()` — static (capabilities per §6).
- `webLinkForPatient(externalId)` → **`null`** (no documented patient deep-link
  URL); `getWebHint?` omitted. `webLinks: false`.
- `uploadPatientAttachment?(...)` — Healthcare `PUT .../attachments?category=attachment`,
  **async + poll `GET .../attachments/{id}` to `completed`** before reporting
  success (§6b). `writeAttachments: true`. **Requires the new
  `practitionerExternalId?` input field** (§1a.3) for the mandatory
  `practitionerId` query param; if absent, return an actionable error, not a 400.
- Export `gentuFactory: PmsAdapterFactory` with `create({ connectionId,
  credentials, webHint })` + `staticMetadata()`.

### The OAuth client + pairing connect flow (the genuinely new transport)

`client.ts` is where Gentu departs from the first two builds. Two credential
tiers:

- **App-level (env, app-wide):** `GENTU_API_KEY` (the OAuth client id),
  `GENTU_API_KEY_SECRET` (the secret), `GENTU_APP_ID` read from env. These mint
  OAuth2 client-credentials tokens via **`POST /v1/oauth2/token`** with HTTP
  Basic auth (verified — §0a). **Never per-clinic, never in the connection blob.**
- **Per-connection (the blob):** the **`tenantId`** captured at connect via the
  pairing code. This is the only per-clinic secret; it rides in the existing
  AES-256-GCM connection blob (`credentials.ts`), so no schema change.

**Token handling — in-memory cache, re-mint on miss** (decided): hold tokens in
a short-lived per-process cache keyed by connection (or app, if one token serves
all tenants — §2 item 1); on expiry/miss, re-fetch from the env client
credentials. Client-credentials tokens re-mint without user interaction, so this
fits the "blob is written once, read after" model with **no persist-back hook**
and no migration. Cold start re-mints — acceptable. Document the cache TTL
against the verified token lifetime (§2 item 2).

**Connect flow** (maps onto `connectPms` / `credentialFields()`):

```
credentialFields() → [{ key: "pairing_code", label: "Gentu pairing code", ... }]
connect:
  1. Clinic generates a pairing code in Gentu, pastes it into Coviu.
  2. connectPms → adapter consumes it: PUT /v1/apps/{GENTU_APP_ID}/pairing/{code}
     (authed with an app client-credentials token) → returns tenantId.
  3. Store tenantId in the connection blob (the per-clinic secret).
  4. verify() = GET /v1/tenants/{tenantId}/status.
  5. provisionFromPms runs as usual (rooms, maps, type import).
```

So `credentialFields()` returns **the pairing code only** — not a client
id/secret/api_key. The connect form renders one field; the app creds come from
env inside the client.

### Registry (the only registry change)

```ts
// src/lib/pms/registry.ts
import { gentuFactory } from "./gentu/adapter";
const FACTORIES: Record<string, PmsAdapterFactory> = {
  [clinikoFactory.provider]: clinikoFactory,
  [nookalFactory.provider]: nookalFactory,
  [gentuFactory.provider]: gentuFactory,   // ← added; replaces the demo stub
};
```

### UI: replace Gentu's demo-connect with the real registry path

Gentu is **not** `comingSoon` today — it has a live **demo-connect** branch
(`pms-selection-grid.tsx:81`, `:95`) that bypasses the credential modal. Per
**§1a.1**:
- **Remove the `provider.id !== "gentu"` exception** at `:81` so Gentu falls
  into the same registry-backed credential-modal path as every other provider —
  the modal renders `credentialFields()` (the pairing-code field) and the
  connect goes through `/api/setup/pms/connect` → `connectPms` → registry, **not**
  the `/api/setup/pms` demo route.
- **Delete the Gentu demo branch + `seedGentuData()`** from
  `/api/setup/pms/route.ts` (§1a.1), and the Gentu-marker clause in
  `/api/setup/rooms/route.ts` (§1a.1 / §1a → Medium).
- The Settings → Integrations connect form already renders from
  `credentialFields()` + `displayName` (genericised — Nookal §3a). Verify the
  help text reads sensibly for a **pairing code** rather than an API key (a
  one-line "where to find your pairing code in Gentu" hint, sourced from the
  adapter, not hardcoded).

---

## 4. Two APIs, one adapter — which call goes where

Gentu splits its surface across **Bookings** and **Healthcare**
(`gentu-bookings-healthcare-api.md` §2). The adapter hides this; the rest of the
layer sees one `PmsAdapter`. The division `client.ts` implements:

| Adapter method | API | Endpoint |
|---|---|---|
| `verify` | either | `GET .../status` |
| connect (pairing) | either | `PUT /apps/{appId}/pairing/{code}` |
| `listAppointments` | **Healthcare** | `GET .../appointments?include=…` |
| `getAppointment` | **Healthcare** | `GET .../appointments/{id}` |
| `getPatient` / `listPatients` | **Healthcare** (read) | `GET .../patients/{id}` (+ side-load) |
| `listPractitioners` / `listBusinesses` / `listAppointmentTypes` | **Healthcare** | `GET .../practitioners`, `.../sites`, `.../appointment-types` |
| `pushFormSubmission` (patient fields) | **Bookings** | `PATCH .../patients/{id}` |
| `uploadPatientAttachment` | **Healthcare** | `PUT .../patients/{id}/attachments` |

`client.ts` carries both base paths (and possibly two tokens — §2 item 1). Keep
the routing in the client/adapter; **never leak "which API" into generic code.**

---

## 5. Sync is a windowed re-sweep — the `updatedAt` cursor model does NOT apply

Settled from the spec (`gentu-bookings-healthcare-api.md` §5): the Healthcare
appointment list filters **only** by `fromDate`/`toDate`, paginates via opaque
`pagination.next`, and the appointment schema has **no `updatedAt` / no
changed-since filter**. Therefore:

- **Do not** persist `pagination.next` as a `pms_sync_cursors` "everything since
  X" watermark — it's in-window page pagination.
- `listAppointments` performs a **rolling re-sweep of a date window** (e.g.
  today → today + N days) per Gentu practitioner, paging to exhaustion, relying
  on connection-scoped upsert idempotency to absorb re-seen rows. There is no
  cheap "only what changed" pull.
- **`map.ts` returns no appointment `updatedAt`.** The generic `pull.ts`
  advances the cursor only from `appointment.updatedAt` (`pull.ts:216-217`);
  with `updatedAt: null`, **no new cursor is ever written** — good.
- **The Gentu adapter must IGNORE `opts.since`.** `pullAppointments`
  (`pull.ts:194`) still reads any stored appointment cursor and passes it as
  `opts.since`. A stale cursor can exist from a reconnect, a provider change, or
  an earlier experiment. `listAppointments` must **not** translate `opts.since`
  into a `fromDate` floor that would skip the window — it ignores `since`
  entirely and always sweeps its own window. Document this in the
  `listAppointments` comment alongside the windowed-re-sweep reason. Treat
  `pms-integrations.md` §5's watermark guidance as not-applicable for Gentu.
  **The DoD requires this comment.**
- Patients have no list-since on Healthcare; they are lazy-fetched per
  appointment via `getPatient` (§1a.4), not listed. Confirm the window width +
  rate ceiling (§2 item 3) and size the cron cadence accordingly — a re-sweep is
  heavier than an incremental pull, and the per-appointment `getPatient`
  fan-out rides on top of it (the §1a.4 alternative exists if that's too chatty).

**No webhooks** (`webhooks: {}` in both specs) — polling via the existing
`cron/pms-sync`.

**Status vocabulary** (appointment): `none | confirmed | completed |
in_waiting_room | with_doctor | invoiced | cancelled | did_not_arrive`. Map
`cancelled`/`did_not_arrive` to `cancelSessionFor`; the rest are read-only
context.

---

## 6. Write capabilities — set `PmsCapabilities` to what Gentu actually supports

```ts
capabilities(): PmsCapabilities {
  return {
    writePatientFields: true,   // PATCH /patients (Bookings) — §6a
    writeForms:         false,  // no structured form/note sink anywhere — §6c
    writeAttachments:   true,   // PUT .../attachments, categorised (Healthcare) — §6b
    writeNotes:         false,
    webLinks:           false,  // no documented patient deep-link URL
    webhooks:           false,
  };
}
```

Unsupported surfaces hide automatically (push UI, attach-PDF button, "Open in
{PMS}" link, field-catalogue form-answer group are all capability-gated).

### 6a. `writePatientFields: true` — `PATCH /patients/{id}` (Bookings)

The `patient_field` leg of `orchestratePush`. The answer to "do we need the
patient update API" — **this is it.**

- **Fill-blanks-only with mandatory GET-first.** Gentu PATCH is a true
  merge/patch and the spec recommends reading current state first, so
  `fillBlanksWrite`'s `readCurrent` hook reads the patient and only
  currently-empty fields are written. Honour the **"unreadable record fails
  every field"** rule — a failed GET is never "all blank." **Verify PATCH merge
  semantics first (§2 item 7): if omitting a field nulls it rather than leaving
  it untouched, fill-blanks is unsafe and must change.**
- **Name writes use the extension mode** (`firstname`/`middlename`), never
  `name.given` — the two modes are mutually exclusive per request (would 400).
  Surname is `name.family`.
- **Contacts: writes drop `fax` and disallowed tuples.** Reads allow
  `email|fax|phone`; writes allow `email|phone` only, restricted to
  `email/home`, `phone/mobile`, `phone/work`, `phone/home`. The write-param map
  rejects out-of-set tuples rather than passing them to a 400; `fax` is never a
  writable patient field.
- **Catalogue scope:** build the `gentu:`-namespaced catalogue from **what
  intake actually collects** — for v1 that is **name, DOB, contact, address
  ONLY**. The entire typed-identifier union — **Medicare included** (it's
  `type: mc` in the same union as DVA / concession / health-fund) — is
  **deferred**: the shapes are strict, most have no canonical home today, and
  the formats are unverified (§2 item 8). The implemented catalogue
  (`field-map.ts`) reflects this — no identifier targets at all. Add them once
  intake captures them and a live tenant confirms the per-type formats.
- **Writes aren't a flat rename table** — names go to the `extension` array,
  contact to a `(system,use,rank)` tuple, address to an array element. So
  `field-map.ts` exposes `applyToPatch`/`readCurrentValue` (build the sub-shapes)
  rather than a key→param map. When identifiers are added later, each is
  per-type logic (its own required shape), not a rename.

### 6b. `writeAttachments: true` — `PUT .../attachments` (Healthcare)

`uploadPatientAttachment`, gated on `writeAttachments`. Render the intake to PDF,
upload `category: "attachment"` (or `consult_note`).

- **Required query params:** `fileName` (human label like
  `Coviu-intake-2026-06-15.pdf`, regex-validated, keep the extension),
  `practitionerId` (**required** — comes from the new `practitionerExternalId`
  input the interface change adds; the adapter cannot see the appointment
  itself, §1a.3; acceptable-to-use-appointment-practitioner is §2 item 5),
  optional `setDate` (±30 days).
- **Content-type:** prefer raw binary PDF body; the enum also lists
  `multipart/form-data` — **verify which is accepted (§2 item 6)** before
  hardcoding.
- **Max 4 MB** — size guard with an actionable error if the package exceeds it,
  not a silent 4xx.
- **Async + virus scan.** `PUT` returns `{message, attachmentId}` immediately;
  **poll `GET .../attachments/{attachmentId}` until `status: completed`** before
  reporting success (`accepted → scanned_clean → completed`;
  `scanned_infected`/`failed` → actionable error). A 200 on `PUT` is "accepted,"
  not "stored."
- **Non-terminal after the poll budget ⇒ NOT success.** If polling exhausts
  while status is still `accepted`/`scanned_clean`, we **cannot** confirm the
  file landed (Gentu may still reject it in scanning), so the adapter returns
  `{ ok: false, attachmentId, detail: "…still processing — confirm or retry" }`
  — a false "done" is worse than a retryable "pending." The `{ ok }` contract
  has no third state; if the push UI later grows an explicit "pending" status,
  surface it here instead. The returned `attachmentId` lets a retry/check
  reference the in-flight upload.

### 6c. `writeForms: false` — no structured form sink (the Nookal shape)

There is **no `patient_forms`-style endpoint** in either API — Healthcare's
"notes" are read-only attachment *categories*, not a structured-answer write
target. So the catalogue has **no form-answer group**; every `pmsTarget` is a
`patient_field`; `orchestratePush` has no `writeFormAnswers` hook. This is
exactly Nookal's documented shape — the abstraction already handles it. The form
*content* reaches Gentu only as the §6b PDF attachment.

**Answer-type caveat (carried from Cliniko/Nookal):** route choice/checkbox
answers to a patient field, coerce to text, or mark `unmapped` — never pretend a
type round-trips that the target can't hold.

---

## 7. Schema — no changes

The link tables (`pms_patient_links`, `pms_practitioner_links`,
`pms_appointment_type_links`), `pms_connections` (creds / `account_subdomain` /
sync columns), `pms_sync_cursors`, `locations.pms_external_id`,
`forms.pms_provider`, the `form_submissions` push roll-up columns, and
`pms_push_field_results` are **all provider-generic and already exist**. The
`pms_provider` enum already includes `gentu`.

**No schema change** — the no-PMS pathway is modelled as *no row* (§1a.2
decision), not an enum value, so nothing in the schema moves for this build.

Notes specific to Gentu:
- The connection blob holds the **`tenantId`** (per-clinic), not an API key.
  Reuse `credentials.ts` as-is — it's an opaque `Record<string,string>`.
- **No persist-back hook needed** — the in-memory token cache (§3) means the
  blob is still write-once/read-after. (If §2 item 2 reveals re-minting is
  rate-limited enough to force token persistence, *then* build the
  credential-persistence hook `pms-integrations.md` §3 names — but only then.)
- `account_subdomain` is unused (`webLinks: false`); leave it null.

DB is **Neon** — any change goes via the Neon MCP, mirrored into
`src/lib/db/schema.ts`; drop the old function overload when appending params.

---

## 8. Build order

0. **🚧 Magentus provisioning (§0a)** — blocks all live verification, NOT the
   buildable spine. Auth is verified; the sandbox app returns
   `app.partnerId` unresolved on every tenant call. Send the §0a signature to
   Magentus. While waiting, build steps 1–6 (§8a).
1. **`gentu/client.ts`** — OAuth client-credentials transport (`POST
   /v1/oauth2/token`, HTTP Basic, in-memory cache — verified §0a), pairing-code
   consume, two API base paths, `tenantId` scope, URI-encoded ISO datetimes,
   backoff, credential-gated. Confirm §2 items 1, 3, 6 once unblocked.
2. **`gentu/types.ts`** — raw FHIR-ish shapes for the read/write subset.
3. **`gentu/map.ts`** — raw ↔ canonical for all resources; UUID strings; name
   extension-mode; typed identifier union; contact tuples (read vs write);
   phones primary-first; **no appointment `updatedAt`** (§5).
4. **`gentu/field-map.ts`** — `gentu:` `patient_field` catalogue (no form-answer
   group) + write-param map + `GENTU_REGISTRATION_FIELDS` + `catalogueEntry()` +
   the read/write contact rules.
5. **`gentu/adapter.ts`** — implement every `PmsAdapter` method (§3 checklist):
   windowed re-sweep ignoring `opts.since` (§5), pairing connect (§3),
   `listPatients` yields nothing + `getPatient` lazy-fetch (§1a.4),
   `writeForms: false` + attachment poll-to-completed (§6); export `gentuFactory`.
6. **Register** — one line in `FACTORIES` (`registry.ts`), replacing the stub.
7. **🔧 Generic-layer changes (§1a) — do these, they are NOT optional:**
   - **§1a.3** extend `uploadPatientAttachment` input with
     `practitionerExternalId?`; resolve it in `attachIntakePdfToPms` from the
     appointment's practitioner link. (Do this with/before step 5's attachment
     method — the adapter depends on it.)
   - **§1a.1** delete the Gentu demo branch + `seedGentuData()` in
     `/api/setup/pms/route.ts`; remove the `!== "gentu"` exception in
     `pms-selection-grid.tsx`; drop the Gentu-marker clause in
     `/api/setup/rooms/route.ts`.
   - **§1a.2** no-PMS pathway: write no row; audit the setup gate, Settings, and
     `/api/setup/rooms` read a missing row correctly.
   - **§1a.5** add `PmsAdapterFactory.exchangeCredentials?` + call it in
     `connectPms` before verify/encrypt; Gentu implements it to consume the
     pairing code → `{ tenant_id }`.
8. **UI** — Gentu now flows through the generic credential modal (§1a.1 / the
   §3 UI subsection); confirm the connect-form copy reads sensibly for a pairing
   code, not an API key.
9. **Verify end-to-end** (§9) against a sandbox/live tenant **once Magentus
   unblocks (§0a)**; update provider notes.

### 8a. What's buildable now vs. blocked on Magentus

The `app.partnerId` provisioning gap (§0a) blocks **live data**, not the code.

- **Buildable now (no live tenant needed):** steps 1–7 — `client.ts` (auth half
  is verified; pairing-consume and tenant calls are *writeable*, just not
  *runnable* yet), `types.ts`, `map.ts`, `field-map.ts`, the adapter, the
  registry line, and **all of §1a** (demo removal, no-PMS, attachment interface).
  Type-check + unit-test against the spec shapes. Where a write/merge behaviour
  is unverified (§2 items 5–8), pin a **commented "⚠️ verify" constant** with an
  actionable-error fallback — the Nookal pattern.
- **Blocked until unblocked:** §9 end-to-end, and §2 items 1, 3, 4, 5, 6, 7, 8
  (everything needing a real tenant). **Hold the first write for sign-off
  regardless** (§10).

---

## 9. End-to-end verification path

Connect Gentu (sandbox pairing code) →
Settings → Integrations shows status + auto-creates rooms from practitioners +
imports appointment types (NOTE: **no location auto-map in v1** — `listBusinesses()`
returns `[]` until the location concept / practitioner-site handling is
confirmed (§2 item 4), so `locations.pms_external_id` stays unmapped and the
pull runs unfiltered, which is correct for a single-tenant account) →
confirm a type as telehealth + sync-on in Workflows →
"Sync now" on the run sheet re-sweeps the appointment window and pulls an
appointment; its patient is lazy-fetched via `getPatient` during upsert
(§1a.4) →
it spawns a session with the patient (primary E.164 phone) on the run sheet →
open the intake → complete it →
"Sync to Gentu" writes **patient demographic fields** back via `PATCH /patients`
(per-field results, fill-blanks-only) and attaches the **intake PDF**
(`PUT .../attachments`, polled to `completed`) — **no form-answer write-back**
(`writeForms: false`) →
"Open in Gentu" deep link is **absent** (`webLinks: false`).

Where a live tenant is unavailable for any leg, note exactly what remains to
confirm (the §2 items) and leave the pinned-constant + actionable-error
fallbacks in place.

---

## 10. Operational guardrails

- **App credentials** (`GENTU_API_KEY` / `GENTU_API_KEY_SECRET` /
  `GENTU_APP_ID`) live in `.env.local` / deployment env — **never logged, never
  pasted into chat, never committed.** If exposed, rotate. `.env.local` must stay
  gitignored. (The App ID alone is the public Apigee identifier — safe to quote
  to Magentus; the key + secret are not.)
- The per-clinic **pairing-derived `tenantId`** is stored encrypted in the
  existing connection blob.
- Get **manual sign-off before the first WRITE** (patient PATCH / attachment
  upload) hits a real Gentu tenant — org policy.
- Sandbox first: `api.pm.sandbox.magentus.com`. Confirm the production host +
  whether production needs separately-provisioned app creds before any
  production write.
- Deploy TODOs (project-level, not new): the `pms-sync` cron on Vercel +
  `PMS_ENCRYPTION_KEY`; plus the three `GENTU_*` env vars in the deploy env.

---

## 11. Definition of done

- [ ] `src/lib/pms/gentu/` implements `PmsAdapter`, registered in `registry.ts`
      (demo stub replaced).
- [ ] No `provider === 'gentu'` branches outside `src/lib/pms/gentu/`; no
      "which API" leak into generic code (§4).
- [ ] **Demo path removed (§1a.1):** Gentu branch + `seedGentuData()` deleted
      from `/api/setup/pms/route.ts`; `!== "gentu"` exception gone from
      `pms-selection-grid.tsx`; Gentu-marker clause gone from
      `/api/setup/rooms/route.ts`. No credential-less Gentu marker is written.
- [ ] **No-PMS pathway is first-class (§1a.2):** skipping PMS writes **no
      `pms_connections` row** (no more "skipped Cliniko"). Audited: setup
      gate/middleware treats a missing row as PMS-step-satisfied (no loop-back),
      Settings shows "No PMS connected," `/api/setup/rooms` routes to manual entry.
- [ ] **Attachment interface extended (§1a.3):** `uploadPatientAttachment` takes
      `practitionerExternalId?`; `attachIntakePdfToPms` resolves it from the
      AUTHORITATIVE source (`getAppointment(pms_external_id)`), with the
      room-reverse only as a manual-appointment fallback; Cliniko/Nookal ignore it.
- [ ] **Credential-exchange hook (§1a.5):** `PmsAdapterFactory.exchangeCredentials?`
      added; `connectPms` calls it before verify/encrypt; Gentu consumes the
      pairing code → stores `{ tenant_id }`. Key-based providers omit it.
- [ ] **Patient side-load decided (§1a.4):** `listPatients` yields nothing,
      `getPatient` lazy-fetches — documented in adapter comments. No reliance on
      side-loaded patients under the current pull contract.
- [ ] `listAppointments` **ignores `opts.since`** (stale cursors can exist; §5).
- [ ] OAuth client-credentials transport with in-memory token cache; app creds
      from env; per-clinic `tenantId` from the pairing-code connect flow (§3).
      No persist-back hook added (cache fits write-once blob).
- [ ] External ids handled as UUID strings everywhere (no `Number()`).
- [ ] Synced phones normalised to E.164 (via the generic pull), first primary;
      contact `phone/mobile` tuple mapped by `rank`.
- [ ] **Windowed re-sweep documented** in `listAppointments` with the reason
      (no `updatedAt`/no changed-since filter, §5); `map.ts` returns no
      appointment `updatedAt`.
- [ ] `capabilities()` is truthful: `writePatientFields: true`,
      `writeForms: false`, `writeAttachments: true`, `webLinks: false`.
      Unsupported surfaces hide.
- [ ] Patient PATCH is fill-blanks-only with mandatory GET-first; **PATCH merge
      semantics verified** (omitted = untouched), else fill-blanks reworked
      (§2 item 7, §6a).
- [ ] Name written via extension-mode; `fax` not offered as a writable field;
      out-of-set contact tuples rejected, not sent (§6a).
- [ ] Attachment upload polls to `completed`; **non-terminal after the budget
      ⇒ `ok:false`** (retryable, not a false "done"); 4 MB size guard;
      `practitionerId` + content-type confirmed (§2 items 5–6, §6b).
- [ ] `npx tsc --noEmit` clean, `npm run build` compiles, no new lint errors.
- [ ] End-to-end path (§9) verified against a sandbox/live tenant, or clearly
      noted where unavailable and what remains to confirm.
- [ ] `docs/architecture/pms-integrations.md` provider notes + the
      Cliniko/Nookal plan provider lists updated to mention Gentu is built.
