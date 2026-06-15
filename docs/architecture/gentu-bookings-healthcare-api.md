# Architecture: Gentu (Magentus) — Bookings & Healthcare APIs

A reference for the two Gentu APIs the Coviu adapter sits on: **Bookings** and
**Healthcare**. This is an **API-surface reference**, grounded in the sandbox
OpenAPI specs (`api.pm.sandbox.magentus.com`). The adapter is **built on branch
`feat/gentu-integration`** (`src/lib/pms/gentu/`) — type-checked, pending live
verification against a Magentus tenant (blocked on app provisioning, §0a of the
plan) and merge to `main`. It slots into the model in
`docs/architecture/pms-integrations.md`; read that first for the ring model, the
golden rule, and the push machinery this doc maps onto. The build/decision
record is `docs/plans/gentu-integration.md`.

> Scope note: Gentu also publishes a third spec, **Update Patient**. It is not a
> separate capability — it is the same `PATCH /patients/{id}` operation (same
> lambda `@lambdas/patch-update-patient`, byte-identical body) carved into its
> own spec, almost certainly for credential scoping. This doc treats patient
> update as a Bookings operation and flags the scoping question in §7.

## 1. TL;DR for the impatient

- **Two APIs, split by job.** Healthcare = **read-rich clinical** (appointments
  with includes, procedures, referrals) + the one good **attachment write**.
  Bookings = **write-rich admin** (create patient, **`PATCH` patient**, create
  appointment, cancel appointment, contacts, account holders).
- **Can we write a form back into Gentu?** Two halves:
  - **Demographic fields** the patient entered → **yes, structurally**, via
    `PATCH /patients/{id}` (Bookings). Widest field set of any PMS we've seen.
  - **The form as a record** → **yes, as a categorised PDF** via
    `PUT .../attachments` (Healthcare). Filed, not queryable.
  - **The form as structured/queryable clinical data** → **no endpoint exists**
    in either API. → `writeForms: false`, exactly like Nookal.
- **Auth is OAuth2 client-credentials + a pairing-code bootstrap.** This is the
  big departure from Cliniko (API key) and Nookal (key in form body). It needs
  the credential-persistence hook called out as a prerequisite in
  `pms-integrations.md` §3 **before** the build starts.
- **Everything is keyed by `tenantId`** (the practice / "Tenant"), and **every
  id is a UUID string**. The existing "ids are strings end to end" rule already
  covers this; no safe-integer hazard, but never coerce a UUID.

## 2. The two base surfaces

Both APIs share host, versioning (`/v1`), the `tenantId`-scoped path shape, and
the OAuth2 client-credentials security scheme. Token endpoint (both):
`https://api.pm.sandbox.magentus.com/oauth2/token`. Both declare `scopes: []`
in-spec — the real scoping is provisioned per-app in Apigee (see §7).

| | **Bookings API** | **Healthcare API** |
|---|---|---|
| Primary role | Admin writes | Clinical reads + attachment write |
| Create patient | ✅ `POST /patients` | — |
| Update patient | ✅ `PATCH /patients/{id}` | — (GET only) |
| Patient match / search | ✅ `POST /patients/match`, `POST /patients/list` | — (GET by id only) |
| Appointments | ✅ create + cancel | ✅ list (with includes) + get |
| Appointment types | ✅ list | ✅ list |
| Practitioners / users | ✅ list, get, sites | ✅ list, get, sites |
| Schedules (availability) | ✅ list | — |
| Procedures | — | ✅ list + get |
| Referrals | — | ✅ list (by patient) |
| Account holders / contacts | ✅ full CRUD-ish | get account holders only |
| **Attachment write** | `POST .../incoming-correspondence` (inbox) | ✅ **`PUT .../attachments` (categorised)** |
| Pairing bootstrap | ✅ `PUT /apps/{appId}/pairing/{pairingCode}` | ✅ (same) |

The practical division for the adapter: **read/sync off Healthcare, writes off
Bookings, attachment off Healthcare.** Reasons in §5–§6.

## 3. Auth, tenancy, and the pairing flow

Three concepts stack:

1. **App** — your integration, identified by an `appId` (UUID, "the UUID of the
   app in Apigee"). Holds the OAuth2 client credentials.
2. **Tenant** — a practice. Everything data-bearing is under
   `/v1/tenants/{tenantId}/…`. `GET /v1/tenants` lists the tenants your app is
   authorized for; each carries `tenantAccess: enabled|disabled`.
3. **Pairing code** — how a practice grants your app access to *their* tenant.
   The practice generates an 8-char code; you consume it:
   `PUT /v1/apps/{appId}/pairing/{pairingCode}` → returns the `tenantId`.

**Connect flow for the adapter** (maps onto `connectPms` / `credentialFields`):

```
1. App holds OAuth2 client_id / client_secret  (provisioned once, our side)
2. Clinic generates a pairing code in Gentu
3. Clinic pastes code into Coviu connect form
4. We PUT /apps/{appId}/pairing/{code} → capture tenantId
5. Store tenantId (the per-connection key) + whatever token material we hold
6. verify() = GET /v1/tenants/{tenantId}/status  ("Hello world!")
```

So `credentialFields()` is **not** a single `api_key`. It is (at minimum) the
pairing code at connect time; the client_id/secret/appId are app-level config,
not per-clinic secrets. The per-connection durable artifact is the
**`tenantId`** plus token material.

**Token lifecycle is the real work.** Client-credentials means a short-lived
bearer token fetched from `tokenUrl` and refreshed on expiry. Our current
credential model (`credentials.ts`) writes the blob **once at connect and only
reads it after** — it has no persist-back hook. Per `pms-integrations.md` §3,
**build the credential-persistence hook before starting this adapter**, or hold
tokens in a short-lived in-process cache keyed by connection and re-mint from
client credentials on miss (client-credentials tokens are re-mintable without
user interaction, so an in-memory cache + re-fetch is viable and avoids the
schema change — decide this explicitly, don't drift into it).

Open question to confirm with Magentus (§7): does one app credential reach both
Bookings and Healthcare, or are they separately scoped/provisioned?

## 4. The canonical data model (FHIR-flavoured)

Gentu's shapes are loosely FHIR-shaped and **verbose**. The adapter's `map.ts`
absorbs all of this; the domain never sees it. The patterns that will bite:

- **Names are split awkwardly.** `name.given` holds *given names including
  middle* ("Joey Doe Boe" → first `Joey`, middle `Doe Boe`). There is a
  *parallel, mutually-exclusive* representation via the `extension` array:
  `firstname`, `middlename`, `maiden-name`, `pronouns` as
  `{system, valueString}` entries. **You may not mix `name.given` with the
  `firstname`/`middlename` extensions in one request** — pick one mode. For
  writes, prefer the extension mode (the spec itself recommends it: "more
  predictable control over name fields").
- **Contacts are an array of `{system, use, rank, value}`** — `rank` is
  priority (1 = highest); mobile = `phone`/`mobile`. The map must pick the right
  `(system,use)` tuple, not just "the phone field." **Read and write shapes
  differ — do not collapse them:**
  - **Reads** (Healthcare patient) allow `system` ∈ `email | fax | phone`,
    `use` ∈ home/work/mobile.
  - **Writes** (Bookings `PATCH patient`) allow `system` ∈ `email | phone`
    only — **no `fax`** — and restrict to the combinations
    `email/home`, `phone/mobile`, `phone/work`, `phone/home`.
  - Consequence for the catalogue: **`fax` is read-only; never offer it as a
    writable patient field**, and the write-param map must reject any
    `(system,use)` tuple outside the four allowed write combinations rather
    than passing it through to a 400.
- **Identifiers are a typed union** keyed by `type`: `mc` (Medicare), `pen`
  (pensioner), `hc` (healthcare card), `dvg/dvo/dvw/dvau` (DVA gold/orange/
  white/unknown), `mb` (private health). Each has its own required shape (DVA
  needs a `card-name` extension; Medicare an IRN extension; all need a `period.
  end` expiry). Max one per type. This is a **much wider identifier surface
  than Cliniko/Nookal expose** and most of it has no canonical home today —
  scope what we actually capture in intake before modelling all of it.
- **Emergency contacts, indigenous status, occupation, pronouns,
  `emailEnabled`/`smsEnabled`, `deceased`, `chartNumber`** all exist on the
  patient. Rich, but again: only map what intake collects.
- **Dates:** `birthDate` is `YYYY-MM-DD`; everything time-bearing is ISO-8601
  **with offset** and **must be URI-encoded** in query strings (the spec is
  emphatic — unencoded `+` gets stripped).

## 5. Read sync (Gentu → run sheet) — use the Healthcare API

`pullConnection()` order is patients → appointments → reconciliation
(`pms-integrations.md` §5). Mapping that onto Gentu:

- **Appointments:** `GET /v1/tenants/{tenantId}/appointments` with
  `include=patients,practitioners,referrals`. This is the win that makes
  Healthcare the read surface: **one call returns appointments plus their
  patients and practitioners**, side-loaded in the same response — fewer
  round-trips than the lazy `getPatient` backfill we do elsewhere. Required
  query params: `fromDate`, `toDate`, `practitionerId`, `limit` (5–100), cursor
  via `cursor`. **Note `practitionerId` is required** — there is no
  "all practitioners" list call; sync iterates the mapped practitioners.
- **Single fetches:** `GET .../appointments/{id}`, `GET .../patients/{id}` —
  these power reconciliation and any lazy linking that survives the includes.
- **Patients:** there is no "list changed patients since X" on Healthcare. Two
  consequences: (a) the patient feed is effectively **driven by appointments**
  (side-loaded), and (b) if we ever need standalone patient search it lives on
  **Bookings** (`POST /patients/list` with filters + sparse `fields`, or
  `POST /patients/match` for exact first+last+DOB → single id).
- **Practitioners / types / sites:** `GET .../practitioners`,
  `.../practitioners/{id}`, `.../appointment-types`,
  `.../practitioners/{id}/sites` (sites = our `PmsBusiness` candidate; confirm
  against a live tenant which concept maps to a Coviu location — could be
  tenant, site, or practitioner-site).
- **Cursoring — the `updatedAt` watermark model does NOT apply here.** The
  appointment list filters **only** by `fromDate`/`toDate` and paginates via an
  opaque `pagination.next`. There is **no "changed since" filter and no
  `updatedAt` field on the appointment schema** (the appointment carries
  `startAt`/`endAt` and `cancelled-at` extensions, but no last-modified
  timestamp). So:
  - `pagination.next` is **page pagination within a date window**, not an
    incremental watermark. Don't persist it as a `pms_sync_cursors` "everything
    since X" watermark.
  - Sync is a **rolling re-sweep of a date window** (e.g. today → today+N),
    paginating `next` to exhaustion, relying on upsert idempotency to absorb
    re-seen rows. There is no cheap "only what changed" pull.
  - **`map.ts` therefore has no appointment `updatedAt` to return** — unlike
    Cliniko/Nookal, the cursor is not timestamp-derived. (Patients have no
    list-since on Healthcare at all; the patient feed is appointment-side-loaded
    per the bullet above.) Treat the watermark guidance in
    `pms-integrations.md` §5 as not-applicable for Gentu appointments, and
    document the window size + re-sweep cost as a deliberate gap.
  - The one thing still worth confirming on a live tenant: the **max window
    width** and any page-count/rate ceiling, since a re-sweep is heavier than an
    incremental pull.

**No webhooks** (`webhooks: {}` in both specs) — polling, like the others.

**Status vocabulary** (appointment): `none | confirmed | completed |
in_waiting_room | with_doctor | invoiced | cancelled | did_not_arrive`. Map
`cancelled`/`did_not_arrive` to the session cancel cascade
(`cancelSessionFor`); the rest are read-only context for us.

## 6. Write sync (Coviu forms → Gentu)

This is the heart of "get the integration right." Three write targets, mapped
onto `orchestratePush` (`pms-integrations.md` §2, §6).

### 6a. Demographic fields → `PATCH /v1/tenants/{tenantId}/patients/{patientId}` (Bookings)

This is the `patient_field` leg. It is the answer to "do we need the patient
update API" — **yes, this is it.**

- **PATCH/merge semantics, not fill-blanks.** The spec recommends `GET` first
  to read current state. So our **fill-blanks-only safety must live on our
  side**: `fillBlanksWrite()`'s `readCurrent()` hook reads the patient, and we
  only include fields that are currently empty. This is exactly the machinery
  in `push-helpers.ts`; Gentu just makes the GET-first mandatory rather than
  optional. Honour the "unreadable record fails every field" rule — never treat
  a failed GET as "all blank."
- **Name writes use the extension mode** (`firstname`/`middlename`), never
  `name.given`, to avoid the mutually-exclusive-mode validation error. Surname
  is `name.family`.
- **Field catalogue is large** (Medicare/DVA/concession/health-fund identifiers,
  indigenous status, pronouns, occupation, emergency contacts). Build the
  `gentu:`-namespaced catalogue from **what intake actually collects**, not the
  full API surface. Start with the registration subset (name, DOB, contact,
  address, Medicare) and grow.
- **Read/write asymmetry to watch:** reads come back FHIR-shaped (extension
  arrays, typed identifier unions); writes take the same shapes but with the
  mutual-exclusion rules. Unlike Nookal there's no casing flip, but the
  identifier union means `writeParamFor` is non-trivial per identifier type —
  this is real `map.ts` work, not a rename table.

### 6b. Form body as a record → `PUT /v1/tenants/{tenantId}/patients/{patientId}/attachments` (Healthcare)

This is `uploadPatientAttachment`, gated on `writeAttachments`. Healthcare's
attachment endpoint is **better than Bookings' `incoming-correspondence`**
because it takes a **`category`**: `attachment | consult_note | correspondence
| diagnostic_report | diagnostic_request | pregnancy | procedure`. Render the
intake to PDF, upload as `attachment` (or `consult_note`).

- **Body / content-type:** the required `Content-Type` header enum lists the
  binary MIME types **and `multipart/form-data`**
  (`application/pdf | image/jpeg | image/png | image/tiff | video/mp4 |
  multipart/form-data`). Prefer the **raw binary PDF body** (the request body is
  documented as a single binary file), but the spec does not rule out multipart
  — **verify on a live tenant whether multipart is accepted or required** before
  hardcoding binary-only, so we don't reject a documented path.
- **Required query params:** `fileName` (with extension, regex-validated — give
  it a human label like `Coviu-intake-2026-06-15.pdf`, not a raw UUID),
  `practitionerId` (**required** — for a patient-authored intake with no
  clinician, map to the appointment's practitioner; confirm Magentus accepts
  this), optional `setDate` (±30 days of upload).
- **Max 4 MB.** The intake PDF must stay under this; if packages can exceed it,
  the adapter needs a size guard with an actionable error, not a silent 4xx.
- **Async + virus scan.** `PUT` returns `{message, attachmentId}` immediately;
  the file is then scanned and uploaded. Poll
  `GET .../attachments/{attachmentId}` for `status`:
  `accepted → scanned_clean → completed` (success) or `scanned_infected` /
  `failed`. The adapter's attachment flow must **poll to `completed`** before
  reporting success — a 200 on `PUT` is "accepted," not "stored."

### 6c. Form as structured clinical data → not supported

There is **no `patient_forms`-style endpoint** anywhere in either API — no
structured questionnaire/note sink (Healthcare's notes are read-only attachment
*categories*, not a write target for structured answers). So:

```
capabilities: {
  writePatientFields: true,    // PATCH patient (Bookings)
  writeForms:         false,   // no structured form sink — Nookal pattern
  writeAttachments:   true,    // PUT attachments, categorised (Healthcare)
  writeNotes:         false,
  webLinks:           false,   // no documented patient deep-link URL
  webhooks:           false,
}
```

Consequence for the catalogue: there is **no form-answer group**. Every
`pmsTarget` is a `patient_field`; `orchestratePush` simply has no
`writeFormAnswers` hook. This is the documented Nookal shape — the abstraction
already handles it.

## 7. Things to confirm against a live tenant before building

Per `pms-integrations.md` §8, the API archaeology is the irreducible cost. The
specs leave these genuinely unresolved — pin each as a verified constant or an
actionable-error fallback, never a guess:

1. **Scoping:** one app credential for both APIs, or separate provisioning?
   (Both specs say `scopes: []` but separate `tokenUrl` is shared.) Decides one
   token path vs two.
2. **Token lifecycle:** TTL, and whether re-minting from client-credentials is
   rate-limited. Decides in-memory cache vs the credential-persistence hook.
3. **Re-sweep cost:** appointment sync is window-pagination, not an incremental
   watermark (settled in §5 — no `updatedAt`, no changed-since filter). What's
   still open is the **max `fromDate`/`toDate` window width** and any
   page-count / rate ceiling, since the re-sweep is heavier than an incremental
   pull. Decides the sweep window and cron cadence.
4. **Location concept:** which of tenant / practitioner-site maps to a Coviu
   location and to `PmsBusiness`? `locations.pms_external_id` needs the right
   value.
5. **Attachment `practitionerId`:** acceptable to use the appointment's
   practitioner for a patient-authored intake PDF?
6. **PATCH merge behaviour:** does omitting a field leave it untouched (true
   PATCH) or null it? Our fill-blanks logic assumes omitted = untouched —
   verify, because the alternative is data loss.
7. **Identifier write validation:** the typed-union identifier shapes
   (DVA `card-name`, Medicare IRN, `period.end` expiry) are strict; confirm
   exact accepted formats before exposing them in the catalogue.

## 8. How this maps to the adapter skeleton

When built (`src/lib/pms/gentu/`), following `pms-integrations.md` §8:

- **`client.ts`** — OAuth2 client-credentials transport: token mint/refresh,
  `tenantId`-scoped base path, two API hosts (or one with path prefixes — see
  §7.1), backoff, URI-encoded ISO datetimes. Gated so it stays dormant without
  credentials.
- **`types.ts`** — the FHIR-ish raw shapes for the read/write subset only
  (don't transcribe the whole spec).
- **`map.ts`** — the heavy file: name extension-mode ↔ canonical, the typed
  identifier union, read-vs-write contact `(system,use,rank)` tuples (writes
  drop `fax` and the disallowed combinations — §4), UUID strings, ISO offsets.
  **No appointment `updatedAt`** — the cursor is window-based, not
  timestamp-derived (§5).
- **`field-map.ts`** — `gentu:`-namespaced `patient_field` catalogue (no
  form-answer group), registration subset, write-param map (per-identifier-type
  logic, not a rename table).
- **`adapter.ts`** — reads off Healthcare, writes off Bookings, attachment off
  Healthcare; `orchestratePush`/`fillBlanksWrite` for the write path (GET-first
  fill-blanks); `capabilities()` per §6c; pairing-code connect; export factory.
- **Register** one line in `registry.ts` `FACTORIES`, replacing the `gentu`
  demo stub. The setup grid / connect form / catalogue light up from metadata.

Guardrails unchanged: credentials never logged or pasted into chat; manual
sign-off before the **first real write**; the credential-persistence hook
(§3 of the integrations doc) **before** the build, given OAuth.
