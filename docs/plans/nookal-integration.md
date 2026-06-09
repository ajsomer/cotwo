# Plan: Nookal Integration (two-way) — second provider behind the normalization layer

Status: **Built & live-verified** (branch `feat/nookal-integration`, merged to
main 2026-06-09). The adapter is implemented and registered; the genericise pass
and setup-grid flip are done; `tsc --noEmit` + `npm run build` clean. Verified
end-to-end against a **live Nookal account**: connect → rooms auto-created from
practitioners → appointment types imported → appointment sync → intake PDF
attached → patient field write-back (DOB + email) landed.

Live testing corrected four API facts the docs didn't make clear (all now fixed
in the adapter):
- `getAppointmentTypes` returns rows under result key **`services`** (not
  `appointmentTypes`).
- Appointments carry **`appointmentStartDateTimeUTC`/`EndDateTimeUTC`** (already
  UTC) — use those, not the location-local `appointmentDate`+time (which was
  being stored as naive UTC and shifting times by the tz offset).
- Patient write endpoint is **`editPatient`** (not `updatePatient` — 404'd).
- Nookal is **asymmetric**: reads return PascalCase (`DOB`/`Email`), `editPatient`
  expects snake_case (`date_of_birth`/`email`) and **silently ignores unknown
  params with `status: success`** — so wrong casing no-op'd with a false
  "written". Split into separate write-param / read-field maps; dropped
  Gender/Title/Occupation (not documented as editable).

Nookal is added as a **second concrete `PmsAdapter`** behind the vendor-agnostic
layer that the Cliniko build (`docs/plans/cliniko-integration.md`) established.

**Still open (not blocking):** the `add_to_runsheet` workflow action fires at
appointment time via the scanner/cron, which doesn't run automatically in local
dev — so a synced appointment's session spawns on schedule in a deployed env but
needs the cron to be running. Verify once the `pms-sync`/scanner cron is wired
on Vercel (the existing project-level deploy TODO). The
generic spine — schema, sync engine, Settings → Integrations, form builder
binding, push UI, deep links, connect route — is reused. The bulk of new code is
`src/lib/pms/nookal/`, plus one line in `registry.ts`, the setup-grid flip, and a
**small genericise pass** to remove the handful of Cliniko-specific assumptions
that the first build left outside the adapter (§3a — one of them, the Settings
connect form, is an actual runtime bug for Nookal, not just cosmetic).

**The golden rule:** if you add `if (provider === 'nookal')` anywhere outside
`src/lib/pms/nookal/`, stop — that logic belongs behind the `PmsAdapter`
interface (`capabilities()`, `fieldCatalogue()`, `validateField()`,
`credentialFields()`, `webLinkForPatient()`, `getWebHint()`,
`uploadPatientAttachment?()`).

Nookal API docs: <https://api.nookal.com/developers/setup> and the linked
`/dev/reference/*` pages (appointment, patient, location, practitioner,
services, documents, treatment-notes, invoices).

---

## 0. What already exists and is reused verbatim

Read these first — they are the contract and the blueprint:

- `docs/plans/cliniko-integration.md` — the full design. §4 (normalization
  layer), §5 (read sync), §6/§6.1/§6.2 (write sync + per-field feedback + deep
  links), §8 (schema deltas), §10 (per-provider auth). **Almost all of it is
  provider-agnostic and applies to Nookal verbatim.**
- `src/lib/pms/adapter.ts` — the `PmsAdapter` interface, `PmsCapabilities`,
  `PmsFieldCatalogueEntry`, `PmsCredentialField`, `PmsAdapterFactory`. This is
  the contract Nookal implements. Note the optional methods
  (`uploadPatientAttachment?`, `getWebHint?`) — implement only what Nookal
  supports.
- `src/lib/pms/types.ts` — canonical `PmsPatient`, `PmsAppointment`,
  `PmsPractitioner`, `PmsAppointmentType`, `PmsBusiness`,
  `PmsFormSubmissionInput`, `PmsPushResult`/`PmsFieldResult`. **Do not change
  these** unless Nookal genuinely needs a new canonical field — sharing them is
  the whole point.
- `src/lib/pms/cliniko/` — the **template** for the `nookal/` folder:
  - `client.ts` — HTTP, auth, shard derivation, pagination async-iterator
    (`list()`), 429/5xx backoff. Key-gated: throws on empty key so the client
    stays dormant without credentials.
  - `types.ts` — raw API shapes (the read/write subset).
  - `map.ts` — raw ↔ canonical translation. **External ids stringified at the
    map boundary** (`String(c.id)`).
  - `field-map.ts` — static `cliniko:`-namespaced write-back catalogue +
    `PATIENT_PATCH_FIELD` (key → API property) + `CLINIKO_REGISTRATION_FIELDS`
    (seeded-form subset) + `catalogueEntry()`.
  - `adapter.ts` — implements `PmsAdapter`; exports `clinikoFactory`.
- `src/lib/pms/registry.ts` — the provider registry. `FACTORIES` maps provider
  enum → factory. `buildAdapter()` decrypts creds + passes `account_subdomain`
  as `webHint`. **One line added here.**
- `src/lib/pms/connection.ts`, `credentials.ts` — opaque AES-256-GCM credential
  blob + connection loading + `adapterForConnection`. Generic; reused as-is.
- `src/lib/pms/integrations-service.ts` — `connectPms` (verify → encrypt →
  store → `getWebHint` → seed registration form), `provisionFromPms`
  (auto-create rooms from practitioners, auto-map practitioner→room,
  auto-map business→location, import appointment types), `getMappingData`, the
  mapping writers, `importAppointmentTypes`, `confirmAppointmentTypeSync`.
  **Generic; works for Nookal with no changes once the adapter exists.**
- `src/lib/pms/sync/pull.ts`, `push.ts`, `cursor.ts`, `mapping.ts` — the sync
  engine. Talks only to `PmsAdapter`. The pull already: normalises phones to
  E.164, marks the first phone primary, upserts on connection-scoped keys, lazy-
  fetches unlinked patients via `getPatient`, reconciles deleted patients, and
  calls `scheduleWorkflowForAppointment` so sessions reach the run sheet.
- `src/lib/pms/session-gate.ts`, `web-link.ts`, `seeded-registration-form.ts` —
  generic.
- `src/hooks/usePmsConnection.ts` + `src/components/clinic/shared/providers.tsx`
  — shared PMS connection context (status fetched once per location, shared so
  the PMS-dependent UI doesn't flicker). Reads `provider` / `syncActive` /
  `providerLabel` / `accountSubdomain` from `/api/pms/connection`. Nookal flows
  through automatically.
- All `src/app/api/pms/*` routes (connection, mappings, sync, push,
  push-appointment, attach-pdf, import-types, confirm-type, catalogue,
  patient-link, cron/pms-sync) and `src/app/api/setup/pms/connect/route.ts`
  (calls `connectPms({ locationId, provider, credentials })`) — all generic;
  resolve the adapter via the registry and never branch on provider.

**The `pms_provider` enum already includes `nookal`** (DB + `schema.ts`). No
schema migration is expected (§7).

---

## 1. Goal

A two-way Nookal integration, structured identically to Cliniko:

- **Read (inbound):** pull Nookal appointments into the Coviu appointment book
  so the run sheet reflects what Nookal has, with patients, practitioners,
  appointment types (services), and locations (businesses) as dependencies.
  Telehealth-only scope for v1 (same as Cliniko §5).
- **Write (outbound):** push completed Coviu form submissions back into Nookal
  via a static, `nookal:`-namespaced field-mapping catalogue — to the extent
  Nookal's API supports patient-field updates / form-answer posting / document
  upload. Capabilities reflect what Nookal *actually* supports; unsupported
  surfaces hide cleanly.

---

## 2. ⚠️ FIRST: verify the Nookal API surface against the live docs/account

The Cliniko build's hardest moments were all **undocumented/guessed API
details** (the attachment presigned path, the upload_url format, the web-link
host). Nookal's docs are thin on exactly those things. Treat the following as
**explicit verification tasks done before/while coding** — do not guess and bake
assumptions in. When a detail can't be confirmed from docs, pin the best-known
value as a **clearly-commented constant with a "⚠️ verify against a live
account" note**, and surface a specific, actionable error if it's wrong — never
a bare status code (mirror Cliniko's `transportDetail`).

> **✅ Auth + transport VERIFIED (2026-06-09)** against the working Elixir client
> [`theo-agilelab/nookal-api`](https://github.com/theo-agilelab/nookal-api)
> (`lib/nookal/client.ex`) + the Nookal docs. Items 1–2 below are now settled —
> the step-0 blocker is cleared:
> - **Base URL:** `https://api.nookal.com/production/v2/<function>` — single host,
>   **no shard** (unlike Cliniko).
> - **Method:** every call is **`POST`**.
> - **Auth:** `api_key` is a **form-body field** (not header, not query),
>   Content-Type `application/x-www-form-urlencoded; charset=UTF-8`.
> - **Envelope:** `{ "status": "success" | "failure", "data": { "results": {
>   <resourceKey>: [...] } }, "details": {...}, "settings": { currentPage,
>   nextPage, pageLength } }`. Failure → `details.errorMessage` (object spec also
>   names `errorCode` / `errorDescription`). Results at
>   `payload.data.results.<resourceKey>`.
> - **Pagination:** `page` / `page_length` form params (cap **200**);
>   `settings.nextPage` is null on the last page → loop terminator.
> - **Endpoints confirmed:** `verify`, `getLocations`, `getPractitioners`,
>   `getPatients`, `getAppointments`, `getPatientFiles`, `getFileUrl`,
>   `getTreatmentNotes`, `addTreatmentNote`, `uploadFile`, `setFileActive`.
>
> Still verify against a **live account**: that `last_modified` filters as
> documented (§4), exact field names per resource object, and the file-upload
> PUT mechanics (§5). Those don't block `client.ts`.

| # | What to confirm | Where it lands | Cliniko comparison |
|---|---|---|---|
| 1 | ~~Auth + base URL~~ ✅ **VERIFIED** (see box above): POST, `api_key` in form body, base `…/production/v2/`, no shard. | `nookal/client.ts` | Cliniko = HTTP Basic, shard in key. Nookal = `api_key` form-body field. |
| 2 | ~~Request/response format~~ ✅ **VERIFIED**: form-encoded POST; envelope `{status, data.results.<key>, settings.nextPage}`. | `client.ts` + `types.ts` | Cliniko = JSON `{ <resource>: [...], links }`. |
| 3 | **Incremental sync (mostly settled — verify behaviour).** Docs show `last_modified` on `getAppointments`/`getPatients` → prefer true incremental (§4). Confirm the param actually filters as documented on a live account. | `nookal/adapter.ts` `listAppointments`/`listPatients` | Cliniko = `q[]=updated_at:>{cursor}` ascending. |
| 4 | **Pagination.** `page` / `page_length` (docs show page_length cap **200**); confirm the page/last-page indicator. | `client.ts` `list()` async-iterator | Cliniko = `per_page=100`, follow `links.next`. |
| 5 | **Rate limits.** Confirm + honour with bounded backoff (respect any `Retry-After`). | `client.ts` | Cliniko = 200/min → 429 + backoff. |
| 6 | **Resources → canonical mapping.** appointments, patients, practitioners, **locations → `PmsBusiness`**, **services → `PmsAppointmentType`**. | `nookal/map.ts` | Watch the naming: Nookal "locations" are our businesses; Nookal "services" are our appointment types. |
| 7 | **Write capabilities** (drives `PmsCapabilities` — §5). | `field-map.ts` + adapter | See §5 sub-table. |
| 8 | **Webhooks.** Almost certainly none → polling via the existing `cron/pms-sync`. If they exist, note it but ship polling first. | `capabilities().webhooks` | Cliniko = none. |

### 2a. Known sharp edges from the Cliniko build — pre-empt them for Nookal

- **Big-integer ids.** Cliniko patient ids exceed JS's safe-integer range, so
  `Number(id)` silently corrupted them (broke the attachment `upload_url`).
  **Treat all external ids as strings end to end** — never `Number()` them.
  Check whether Nookal ids are large; stringify at the `map.ts` boundary
  (`String(c.id)`), exactly as Cliniko does.
- **Phone normalisation.** Synced patient phones MUST be normalised to E.164 via
  `normalisePhone` (`src/lib/phone/normalise.ts`) before storing, or patient
  OTP/intake verify won't match ("phone not on file"). **This already happens in
  `sync/pull.ts`'s patient upsert** — the adapter just needs to return the raw
  numbers in `PmsPatient.phoneNumbers`; the generic pull normalises them.
- **Primary phone.** The first synced phone is marked `is_primary` by the pull
  (the workflow engine + run sheet resolve contact via the primary), else
  `add_to_runsheet` fails "No phone number on file". Generic — just ensure
  `map.ts` returns the patient's phones in a sensible order (primary first).
- **Connection-scoped upsert keys.** Idempotency is `(connection_id,
  pms_external_id)` via the link tables (`pms_patient_links`,
  `pms_practitioner_links`, `pms_appointment_type_links`) and `(location_id,
  pms_external_id)` for appointments (partial unique index; the `ON CONFLICT`
  repeats the `WHERE pms_external_id IS NOT NULL` predicate). All generic — just
  supply Nookal external ids as strings.
- **Sessions are workflow-backed, not direct.** Upserting an `appointments` row
  does NOT put it on the run sheet. The pull calls
  `scheduleWorkflowForAppointment` (`src/lib/workflows/scanner.ts`) so the
  `add_to_runsheet` action spawns the session. Generic — already wired in
  `sync/pull.ts`. The appointment type must have a `type_workflow_links` row;
  the type-import path handles that.
- **Room placement = practitioner→room.** A synced appointment's room comes from
  the practitioner→room mapping (`pms_practitioner_links.room_id`), not the type.
  `provisionFromPms` auto-creates a room per practitioner and maps it. The pull
  gate: type confirmed telehealth + `sync_enabled` + practitioner mapped to a
  room. Generic — works once `listPractitioners` returns data.
- **`intake_package` must not be dropped for imminent appointments** — already
  fixed in the scanner; don't regress it.
- **Lazy patient + reconciliation.** The pull lazily fetches a patient via
  `adapter.getPatient(externalId)` if an appointment references an unlinked one,
  and re-pulls patients deleted locally. **Implement `getPatient` and
  `getAppointment` (single-record fetches) on the Nookal adapter** so these work.

---

## 3. What you're building — file by file

A new `src/lib/pms/nookal/` folder mirroring `cliniko/`:

```
src/lib/pms/nookal/
  client.ts      # Auth, base URL, request/envelope unwrap, pagination, backoff. Key-gated.
  types.ts       # Raw Nookal response shapes (read/write subset).
  map.ts         # Raw ↔ canonical: patients, appointments, practitioners,
                 #   locations→PmsBusiness, services→PmsAppointmentType. Ids as strings.
  field-map.ts   # Static nookal:-namespaced write-back catalogue (only fields
                 #   Nookal's update-patient endpoint accepts) + PATIENT_PATCH_FIELD
                 #   + NOOKAL_REGISTRATION_FIELDS + catalogueEntry(). Skip if no write.
  adapter.ts     # Implements PmsAdapter; exports nookalFactory: PmsAdapterFactory.
```

### Adapter method checklist (`PmsAdapter`)

- `provider = "nookal"`, `displayName = "Nookal"`.
- `verify()` — one cheap authenticated call (e.g. list locations, `per_page=1`).
  Map a rejected key → `{ ok: false, detail: "API key rejected by Nookal." }`.
- `listAppointments({ since?, businessId? })` — async-iterable. Incremental if a
  changed-since filter exists; otherwise the windowed fallback (§4).
- `listPatients({ since? })` — async-iterable.
- `getPatient(externalId)` / `getAppointment(externalId)` — single-record
  fetches; return `null` on 404 (powers lazy-link + reconciliation).
- `listPractitioners()` / `listAppointmentTypes()` (services) /
  `listBusinesses()` (locations) — return arrays.
- `pushFormSubmission(input)` — split fields by `catalogueEntry(key).writeMode`
  into patient-field vs form-answer vs unmapped; **fill-blanks-only** patient
  writes (read current, only write empty fields); per-field results; resolve the
  Nookal patient id via `getPatientExternalId(connectionId, patientId)` from
  `sync/mapping`. Mirror Cliniko's `pushFormSubmission` structure exactly.
- `capabilities()` / `fieldCatalogue()` / `validateField()` /
  `credentialFields()` — static.
  Note: with `writeForms: false` for v1 (§5), `pushFormSubmission` handles only
  patient-field + unmapped fields — there's no form-answer post until a case +
  practitioner can be resolved.
- `webLinkForPatient(externalId)` + `getWebHint()` — **default unsupported**
  (`webLinkForPatient` returns `null`, button hides) unless a live account
  confirms a patient web-app URL (§5, finding 6).
- `uploadPatientAttachment?(...)` — only if the **3-step** Documents flow works
  (`uploadFile` → presigned **S3 PUT** → `setFileActive`; §5); else omit and set
  `writeAttachments: false`.
- Export `nookalFactory: PmsAdapterFactory` with `create()` +
  `staticMetadata()` (capabilities, fieldCatalogue, credentialFields).

### Registry (the only registry change)

```ts
// src/lib/pms/registry.ts
import { nookalFactory } from "./nookal/adapter";
const FACTORIES: Record<string, PmsAdapterFactory> = {
  [clinikoFactory.provider]: clinikoFactory,
  [nookalFactory.provider]: nookalFactory,   // ← added
};
```

### UI: make Nookal selectable

`src/components/setup/pms-selection-grid.tsx` currently has Nookal as
`comingSoon: true`. Flip it to a real connect by mirroring the existing Cliniko
inline API-key modal:
- Set `{ id: "nookal", … comingSoon: false }`.
- In `handleSelect`, route `nookal` to an inline key modal (generalise the
  `clinikoModal` state, or add a parallel `nookalModal`), then `POST
  /api/setup/pms/connect` with `{ provider: "nookal", credentials: { api_key } }`.
- The Settings → Integrations connect form renders whatever `credentialFields()`
  declares for the fields, **but it hardcodes the provider** — see §3a.

### 3a. Genericise pass — Cliniko-specific assumptions left outside the adapter

The first build hardcoded the provider in a few generic surfaces. These must be
genericised or Nookal misbehaves. **The connect form is an actual runtime bug;
the rest are misleading type-casts to fix while here.**

- **`src/components/clinic/settings/integrations/connect-form.tsx` (runtime
  bug).** `handleConnect` posts `provider: "cliniko"` hardcoded (line ~46), and
  the heading/copy say "Connect Cliniko". At a Nookal location this connects the
  **wrong provider**. Fix: pass the active provider into the form (it's already
  resolvable from the connection / `IntegrationStatusDTO`), post that, and drive
  the heading/help text from the adapter's `displayName` + `credentialFields()`
  rather than literal "Cliniko" strings. The default-fields fallback that
  references a Cliniko key should also key off the active provider (or just drop
  the fallback now that two providers exist).
- **`src/lib/pms/integrations-service.ts` (type-cast, ~line 285 and ~469).**
  `eq(formsT.pmsProvider, provider as "cliniko")` and
  `pmsProvider: connection.provider as "cliniko"` narrow the real provider value
  to the `"cliniko"` literal. Runtime is correct (the actual value flows
  through), but the cast is a lie. Fix: cast to the `pms_provider` enum union
  type (or the schema's column type), not the `"cliniko"` literal.
- **`src/lib/pms/sync/push.ts` (type-cast, ~line 300).** Same pattern:
  `provider: provider as "cliniko"` when persisting `pms_push_field_results`.
  Same fix — cast to the enum union.

None of these belong behind the adapter interface (they're generic-layer leaks,
not provider logic), so fixing them keeps the golden rule intact and benefits
every future provider.

---

## 4. Incremental vs windowed sync (prefer true incremental — docs show `last_modified`)

**Prefer true incremental sync — the Nookal docs show `last_modified`.**
`getAppointments` and `getPatients` document a `last_modified` filter with
`page` / `page_length` pagination (page_length capped at **200**). Sources:
[appointment](https://api.nookal.com/dev/reference/appointment),
[patient](https://api.nookal.com/dev/reference/patient). So mirror Cliniko:
honour `opts.since` by passing `last_modified`, page forward, advance the per-
`(connection_id, resource)` watermark in `pms_sync_cursors` to the max
`updatedAt` seen. The generic `cursor.ts` + `pull.ts` already do the bookkeeping
— the adapter just maps `opts.since` → the `last_modified` param and returns
`updatedAt` on each canonical record.

**Fallback only if a live account contradicts the docs.** If the `last_modified`
filter turns out not to behave as documented, fall back to a **bounded forward-
window pull** (today + N days of appointments, plus the patients they
reference) and rely on the connection-scoped upsert keys to de-dupe; in that
mode `listAppointments` treats `opts.since` as a window floor and the cursor is
effectively unused for appointments.

**Document whichever path the build lands on** in a clear comment in
`nookal/adapter.ts` (`listAppointments`/`listPatients`) and note it here — do
not silently pretend a cursor works. The DoD requires this comment.

---

## 5. Write capabilities — set `PmsCapabilities` to what Nookal actually supports

Determine each from the live API (§2 item 7) and gate the UI via
`capabilities()`. Unsupported surfaces hide automatically (the push UI, attach-
PDF button, "Open in {PMS}" link, and field-catalogue binding are all capability-
gated already).

| Capability | Decision | Detail |
|---|---|---|
| `writePatientFields` | Verify update-patient endpoint, then enable. | Build `field-map.ts` `PATIENT_PATCH_FIELD` (only fields it accepts) + catalogue entries with `writeMode: "patient_field"` + `validateField` rules. If no update endpoint → `false`. |
| `writeForms` | **Default `false` initially.** | Nookal's form-answer sink would be **Treatment Notes**, but `addTreatmentNote` requires `patient_id`, **`case_id`**, **`practitioner_id`**, `date`, and `notes` ([patient ref](https://api.nookal.com/dev/reference/patient)). The canonical `PmsFormSubmissionInput` does **not** carry a case or a resolved practitioner, so a treatment note can't be written safely without first fetching/creating/selecting a case and resolving the practitioner from the appointment. Don't fake it: set `writeForms: false` for v1 (the form-answer group disappears from the builder) and route clinical free-text to **Documents/attachments** instead. Only flip to `true` if the adapter can reliably resolve `case_id` + `practitioner_id` — a deliberate follow-up, not v1. |
| `writeAttachments` | Enable if the **Documents** flow works — it's a **multi-step** flow, not a single POST. | Nookal documents are a documented 3-step flow: **`uploadFile`** (get a presigned target) → **presigned S3 PUT** of the bytes → **`setFileActive`** to register it ([patient ref, documents section](https://api.nookal.com/dev/reference/patient)). Implement **all three** steps in `uploadPatientAttachment` and handle `case_id` optionality. ⚠️ This differs from Cliniko's presigned-**POST** form flow — verify the exact PUT mechanics. If the flow can't be completed → `false` and the PDF-attach button hides. |
| `webLinks` | **Default `false`.** | No documented patient web-app URL was found in the Nookal API docs. Keep `webLinkForPatient` returning `null` (button hides) unless a **live account confirms a stable URL pattern**; only then implement `webLinkForPatient` + `getWebHint` (the generic layer already passes the stored hint as `webHint`). |
| `writeNotes` | `false` (held in reserve, like Cliniko). | — |
| `webhooks` | `false` (polling). | §2 item 8. |

**Field catalogue mechanics (mirror Cliniko `field-map.ts`):**
- Keys are **`nookal:`-namespaced** (e.g. `nookal:patient.date_of_birth`). Each
  adapter is the sole source of truth for its own field set — do not force a
  shared canonical vocabulary; expose only what Nookal's update endpoint accepts.
- `PATIENT_PATCH_FIELD: Record<string, keyof NookalPatientPatch>` wires each
  catalogue key to the concrete Nookal API property.
- `NOOKAL_REGISTRATION_FIELDS: string[]` — the patient-field subset the seeded
  "Patient Registration" form pre-binds (the generic
  `seeded-registration-form.ts` reads it via the adapter's catalogue).
- `validateField` enforces value shape (date `YYYY-MM-DD`, phone, enum choices)
  and returns actionable `{ failureKind, detail }` — never a bare status.
- Map Nookal's rejection payloads to `failureKind` (`validation` / `transport` /
  `auth` / `mapping`) + a human `detail`, mirroring Cliniko's `transportDetail`.

**Form-answer type caveat (carry the Cliniko lesson):** if Nookal's form/notes
sink only accepts certain answer types, prefer routing choice/checkbox answers
to a **patient field**, coerce to text, or mark `unmapped` rather than pretending
they round-trip.

---

## 6. End-to-end verification path (same as we validated for Cliniko)

Connect Nookal (real key) →
Settings → Integrations shows status + auto-maps the single business + auto-
creates rooms from practitioners + imports services →
confirm a service as telehealth + sync-on in Workflows →
"Sync now" on the run sheet pulls an appointment →
it spawns a session with the patient (primary E.164 phone) on the run sheet →
open the intake → complete it →
"Sync to Nookal" writes the fields back (per-field results) — for v1 this is
**patient-field write-back and/or attachment upload, not form-answer write-back**
(`writeForms: false`, §5) →
"Open in Nookal" deep link resolves only if a live web URL is confirmed
(`webLinks: false` by default, §5).

Where a live Nookal account is unavailable, note exactly what remains to confirm
(the §2 verification items) and leave the pinned-constant + actionable-error
fallbacks in place.

---

## 7. Schema — no changes expected

The link tables (`pms_patient_links`, `pms_practitioner_links`,
`pms_appointment_type_links`), `pms_connections` (creds / `account_subdomain` /
sync columns), `pms_sync_cursors`, `locations.pms_external_id`,
`forms.pms_provider`, the `form_submissions` push roll-up columns, and
`pms_push_field_results` are **all provider-generic and already exist** from the
Cliniko migration. The `pms_provider` enum already includes `nookal`.

Only add a column if Nookal needs something Cliniko didn't — and justify it. If
Nookal's web hint isn't a "subdomain" shaped value, the existing
`account_subdomain` column is just an opaque `webHint` string; reuse it rather
than adding a column (the registry passes it through as `webHint`, the adapter
interprets it). DB is **Neon** — apply any change via the Neon MCP and mirror it
into `src/lib/db/schema.ts`; when appending params to a Postgres function, drop
the old overload rather than leaving a duplicate.

---

## 8. Build order

0. **🚧 Confirm raw auth transport (§2 item 1)** — blocker for step 1.
1. **`nookal/client.ts`** — auth, base URL, request + envelope unwrap,
   `page`/`page_length` pagination, rate-limit backoff, key-gated. Verify §2
   items 1–5.
2. **`nookal/types.ts`** — raw response shapes for the read/write subset.
3. **`nookal/map.ts`** — raw ↔ canonical for all five resources; ids as strings;
   phones in primary-first order; return `updatedAt` for the cursor.
4. **`nookal/field-map.ts`** — static `nookal:` catalogue + `PATIENT_PATCH_FIELD`
   + `NOOKAL_REGISTRATION_FIELDS` + `catalogueEntry()`. Skip if no patient-field
   write support. (Form-answer entries only if `writeForms` is enabled — §5.)
5. **`nookal/adapter.ts`** — implement every `PmsAdapter` method (§3 checklist),
   true-incremental per §4; `writeForms: false` + the 3-step attachment flow per
   §5; export `nookalFactory`.
6. **Register** — add the one line to `FACTORIES` in `registry.ts`.
7. **Genericise pass (§3a)** — fix the hardcoded `provider` in
   `connect-form.tsx` (runtime bug) and the `as "cliniko"` casts in
   `integrations-service.ts` + `push.ts`.
8. **UI** — flip Nookal to a real connect in `pms-selection-grid.tsx`.
9. **Verify end-to-end** (§6); update provider notes (§10).

---

## 9. Operational guardrails (same as Cliniko §12)

- The Nookal API key is a credential: stored encrypted via the existing
  `credentials.ts` blob, never logged or pasted into chat.
- Get **manual sign-off before the first WRITE** (patient update / document
  upload) hits a real Nookal account.
- Gentu remains a stubbed demo (no real adapter, no credentials → not sync-
  active). Don't touch it.
- Deploy TODOs (project-level, not new): the `pms-sync` cron on Vercel +
  `PMS_ENCRYPTION_KEY`; `DISABLE_OTP_RATE_LIMIT=true` is test-only.

---

## 10. Definition of done

- [ ] `src/lib/pms/nookal/` implements `PmsAdapter`, registered in `registry.ts`.
- [ ] No `provider === 'nookal'` branches outside `src/lib/pms/nookal/`.
- [ ] **Genericise pass done (§3a):** `connect-form.tsx` posts the active
      provider (not hardcoded `"cliniko"`) and drives copy from `displayName`;
      the `as "cliniko"` casts in `integrations-service.ts` + `push.ts` cast to
      the `pms_provider` enum union.
- [ ] External ids handled as strings everywhere (no `Number()`).
- [ ] Synced phones normalised to E.164 (via the generic pull), first one primary.
- [ ] `capabilities()` reflects what Nookal actually supports: `writeForms:
      false` for v1 (no safe case/practitioner resolution), `webLinks: false`
      unless a live URL is confirmed, `writeAttachments` only with the working
      3-step flow. Unsupported surfaces hide cleanly via gating.
- [ ] Incremental-vs-windowed sync decision documented in `pull`/adapter
      comments with the reason (§4).
- [ ] `npx tsc --noEmit` clean, `npm run build` compiles, no new lint errors.
- [ ] End-to-end path (§6) verified against a live Nookal account, or clearly
      noted where a live account was unavailable and what remains to confirm.
- [ ] `docs/plans/cliniko-integration.md` provider list / repo PMS notes updated
      to mention Nookal is built.
