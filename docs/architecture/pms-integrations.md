# Architecture: PMS Integrations

How Coviu talks to practice management systems (Cliniko, Nookal, and whatever
comes next). This is the **current-state reference** — it describes what is on
`main` today, not a plan. For the design history and the decisions behind it,
see `docs/plans/cliniko-integration.md` (the original design) and
`docs/plans/nookal-integration.md` (the second-provider build that validated
the abstraction).

## 1. The shape: three rings

```
Coviu domain (run sheet, workflows, forms, patients)
        │  only ever speaks canonical types
        ▼
Normalization layer  src/lib/pms/
  types.ts        canonical PmsPatient / PmsAppointment / PmsPushResult / …
  adapter.ts      the PmsAdapter + PmsAdapterFactory contracts
  push-helpers.ts shared write-path machinery (orchestration, fill-blanks, validation)
  registry.ts     provider enum value → factory; builds live adapters
  connection.ts   connection row loading; "sync-active" definition
  credentials.ts  opaque AES-256-GCM credential blob
  sync/           pull.ts, push.ts, cursor.ts, mapping.ts — the engine
  session-gate.ts, web-link.ts, seeded-registration-form.ts,
  integrations-service.ts — the service layer behind the UI/routes
        │  one folder per provider, behind the interface
        ▼
Concrete adapters  src/lib/pms/cliniko/   src/lib/pms/nookal/
  client.ts   transport: auth, base URL, pagination, backoff. Key-gated.
  types.ts    raw API response/payload shapes (the read/write subset)
  map.ts      raw ↔ canonical translation; external ids stringified here
  field-map.ts  static provider-namespaced write-back catalogue
  adapter.ts  implements PmsAdapter; exports the factory
```

**The golden rule:** no `provider === '<name>'` branch exists outside
`src/lib/pms/<provider>/`. Every generic surface — the sync engine, all
`/api/pms/*` routes, Settings → Integrations, the form builder, the push UI —
resolves the adapter through the registry and consumes its declared metadata
(`capabilities()`, `fieldCatalogue()`, `credentialFields()`, `displayName`).
If you find yourself writing a provider branch in generic code, the logic
belongs behind the adapter interface instead.

Two corollaries that keep the rule honest:

- **Capabilities are truthful.** `capabilities()` declares what the provider
  *actually* supports (`writeForms`, `writePatientFields`, `writeAttachments`,
  `webLinks`, `webhooks`, `writeNotes`). Unsupported surfaces hide; nothing is
  faked. Nookal ships `writeForms: false` because its only form sink
  (treatment notes) needs a case + practitioner the canonical input can't
  resolve safely — so the form-answer group simply doesn't exist in its
  catalogue.
- **External ids are strings end to end.** Cliniko patient ids exceed JS's
  safe-integer range; `Number()` silently corrupts them. Ids are stringified
  at the `map.ts` boundary and never converted back.

## 2. The adapter contract

`src/lib/pms/adapter.ts` defines `PmsAdapter`:

- **Connection:** `verify()` — one cheap authenticated call.
- **Read:** `listAppointments({since?, businessId?})` and
  `listPatients({since?})` as async iterables (pagination hidden in the
  client); `getPatient` / `getAppointment` single-record fetches returning
  `null` on not-found (these power lazy patient linking and reconciliation);
  `listPractitioners()` / `listAppointmentTypes()` / `listBusinesses()`.
- **Write:** `pushFormSubmission(input)` returning a per-field
  `PmsPushResult`; optional `uploadPatientAttachment?()` for the intake PDF.
- **Metadata:** `capabilities()`, `fieldCatalogue()`, `validateField()`,
  `credentialFields()`, `webLinkForPatient()` (+ optional `getWebHint?()`).

`PmsAdapterFactory` adds `create({connectionId, credentials, webHint})` and
`staticMetadata()` — the latter exposes capabilities/catalogue/credential
fields **without credentials**, which is what credential-less UI (connect
forms, the setup grid via `GET /api/pms/providers`) renders from.

Naming traps the canonical types absorb: Nookal "locations" are our
`PmsBusiness`; Nookal "services" are our `PmsAppointmentType`.

### The shared write-path machinery (`push-helpers.ts`)

The push skeleton is identical across providers, so it lives once in
`src/lib/pms/push-helpers.ts` and adapters supply only API-call hooks:

- `orchestratePush(input, hooks)` — resolves the PMS patient id from the
  connection-scoped link table, splits fields by the catalogue's `writeMode`
  (`patient_field` vs `form_answer` vs unmapped), runs the legs, assembles the
  per-field result. An adapter without a `writeFormAnswers` hook simply has no
  form-answer leg.
- `fillBlanksWrite(fields, hooks)` — the fill-blanks-only engine: read the
  current PMS record, write **only currently-empty fields** (we never clobber
  clinic-entered data), batch-write with per-field isolation retry when the
  batch rejects. Two safety rules hold *by construction*:
  - `readCurrent()` returning `null` (record unreadable/not found) fails
    **every** field. An unreadable record is never treated as "all blank" —
    that would turn fill-blanks into overwrite-everything.
  - Providers whose read and write field names differ (Nookal reads PascalCase
    `DOB`, writes snake_case `date_of_birth`) supply separate
    `readFieldFor`/`writeParamFor` hooks.
- `validateCatalogueValue(entry, value, label)` — catalogue-driven value
  validation (date shape, phone shape, enum membership) with actionable
  messages.

What stays in the adapter: transport (`client.ts`), payload mapping
(`map.ts`), the catalogue tables, attachment flows (genuinely different
protocols per provider), and `transportDetail()` — the translation of the
provider's error payloads into `{failureKind, detail}`. A bare status code is
never acceptable feedback; the receptionist must know what to type.

## 3. Connections, credentials, and "sync-active"

One PMS connection per **location** (`pms_connections`, unique on
`location_id`). The invariant that gates everything:

> **A connection is sync-active iff `credentials_encrypted IS NOT NULL`.**

Rows without credentials are onboarding *markers* (the clinic saw the PMS
step, possibly skipped it). All sync, push, and UI paths gate via
`isSyncActive()` in `connection.ts` — never on `status` alone. The cron sweep
selects only credentialed rows.

Credentials are an **opaque blob** the generic layer never inspects:
`credentials.ts` encrypts the adapter-declared `Record<string, string>` with
AES-256-GCM (random IV, versioned `pmsv1.` prefix; key from
`PMS_ENCRYPTION_KEY`, with a derived dev fallback). The adapter declares what
it needs via `credentialFields()` and reads the blob back in `create()`.

Known limitation: credentials are written once at connect and only ever read
after that. An OAuth provider with refresh-token rotation does not fit until
the factory grows a persist-credentials hook — do that **before** starting an
OAuth provider build, not during.

**Provider switching is destructive by design.** `connectPms` detects a
provider change on an existing connection and wipes that connection's patient
/ practitioner / appointment-type links, sync cursors, business mapping, and
subdomain hint. External ids are scoped to the old provider's account;
carrying them across would resolve old ids against the new PMS — wrong-patient
writes. Same-provider re-credentialing keeps mappings.

## 4. Schema: connection-scoped link tables, not bare columns

External-id state lives in link tables keyed on the **connection** (PMS ids
are account-scoped; two accounts can reuse the same numeric id):

| Table | Links | Notes |
|---|---|---|
| `pms_patient_links` | connection ↔ patient | unique on `(connection_id, pms_external_id)` and `(connection_id, patient_id)` |
| `pms_practitioner_links` | connection ↔ room | the practitioner→room mapping that places synced appointments |
| `pms_appointment_type_links` | connection ↔ appointment_type | carries `confirmed_modality`, `room_id`, `sync_enabled` — the **source of truth** for import state, never the org-scoped type row |
| `pms_sync_cursors` | per `(connection_id, resource)` | incremental watermarks |
| `pms_push_field_results` | per `(submission_id, question)` | per-field push receipts backing the feedback UI + retry |

`locations.pms_external_id` is a bare column (safe: location ↔ connection is
1:1) holding the business→location mapping. `appointments` upsert on the
partial unique index `(location_id, pms_external_id) WHERE pms_external_id IS
NOT NULL`. `forms.pms_provider` tags PMS-bound forms with their provider's
vocabulary. The `pms_provider` enum already contains `halaxy`, `power_diary`,
`gentu`. `halaxy`/`power_diary` remain coming-soon (no adapter). `gentu` has a
real adapter on branch `feat/gentu-integration` (OAuth client-credentials +
pairing-code → tenant_id; reads off the Healthcare API, writes off Bookings;
`writeForms: false`) — built and type-checked, pending live verification against
a Magentus tenant (blocked on app provisioning) and merge. See
`docs/plans/gentu-integration.md` and
`docs/architecture/gentu-bookings-healthcare-api.md`.

## 5. Read sync (PMS → run sheet)

Entry points: the `pms-sync` cron route (sweeps all sync-active connections)
and the "Sync now" button. Both call `pullConnection()` in `sync/pull.ts`.

Order and gates:

1. **Patients** (changed since cursor) → upsert org-scoped patients + phones.
   The pull — not the adapter — normalises phones to E.164 (`normalisePhone`)
   and marks the first number primary; without a primary phone
   `add_to_runsheet` fails. Adapters return raw numbers in sensible order.
2. **Appointments** (changed since cursor), filtered to the location's mapped
   business (`locations.pms_external_id`; unmapped → unfiltered, which is
   correct for single-business accounts). Each appointment passes three gates
   before it counts:
   - its type's link row has `confirmed_modality = 'telehealth'` AND
     `sync_enabled` (types import unconfirmed and inert; a human confirms
     them in Workflows),
   - its practitioner is mapped to a room (`pms_practitioner_links` —
     room placement comes from the practitioner, not the type),
   - otherwise it is **skipped**, not erred.
   If the appointment references an unlinked patient, the pull lazily fetches
   it via `getPatient` so appointments never land patient-less.
3. **Reconciliation** — synced appointments whose Coviu patient went missing
   are re-healed from the PMS via `getAppointment`/`getPatient`.

**Sessions are workflow-backed, not direct.** Upserting an `appointments` row
puts nothing on the run sheet. The pull calls
`scheduleWorkflowForAppointment()` so the `add_to_runsheet` action spawns the
session — which requires the type to have a `type_workflow_links` row (the
type-import path ensures one).

**Cursor semantics.** One watermark per `(connection, resource)`, advanced to
the max `updatedAt` seen. Because the watermark advances past *skipped*
records too, the mapping writers compensate: confirming a type as
telehealth+sync-enabled, or giving a practitioner a room, **clears the
appointments cursor** (`clearCursor` in `sync/cursor.ts`) so the next sync
re-pulls from scratch and picks up everything previously skipped. Upserts are
idempotent, so the re-pull is just a full sweep. Cancellations / no-shows from
the PMS cascade to the session (`cancelSessionFor`).

Cliniko syncs incrementally via `q[]=updated_at:>{cursor}`; Nookal via the
documented `last_modified` filter. Neither provider has webhooks; polling is
the model.

## 6. Write sync (Coviu forms → PMS)

The push is an **explicit staff action**, not automatic on submission. The
Process flow's Done step and the intake handoff panel gate on
`session-gate.ts`: sync-active connection + (`writeForms` ||
`writePatientFields`) + a PMS-bound form with pushable answers. Locations
without that gate keep the byte-for-byte legacy auto-complete behaviour.

Flow (`sync/push.ts` → adapter via `push-helpers`):

1. `pmsTarget` bindings live **inside `forms.schema`** as a SurveyJS custom
   property (`src/lib/survey/pms-target-property.ts`); push matches them to
   `form_submissions.responses` by question name and hands the adapter
   provider-namespaced `{key, value}` pairs.
2. Patient fields are written fill-blanks-only; form answers (Cliniko only)
   post a **self-contained `patient_form`** — Coviu owns the structure, no
   PMS template introspection ever.
3. Every field gets a result row: `written` / `skipped_existing` /
   `unmapped` / `failed` with `{failureKind: validation|transport|auth|mapping,
   detail}`. Failed rows are inline-editable and re-sendable
   (`retryField`), with an "Open in {PMS}" escape hatch where `webLinks`
   allows.
4. Results persist to `pms_push_field_results` + roll up onto the submission
   (`pms_push_status`, `pms_external_id`). **Idempotency:** the stored
   `pms_external_id` (the created `patient_form` id) is passed back as
   `existingFormExternalId` on every re-push, so re-sends PATCH the existing
   form instead of duplicating, and patient-field retries still only fill
   blanks.

The intake-package PDF can additionally be attached to the PMS patient record
(`attachIntakePdfToPms` → `uploadPatientAttachment`), gated on
`writeAttachments` both server-side and in the handoff panel.

## 7. UI surfaces (all provider-agnostic)

- **Setup grid** (`src/components/setup/pms-selection-grid.tsx`): tiles are a
  display list; which tiles are *connectable*, and what the connect modal
  renders, comes from `GET /api/pms/providers` (registry `staticMetadata()` —
  label + `credentialFields`). No single-`api_key` assumption.
- **Settings → Integrations**
  (`src/components/clinic/settings/integrations/`): connection status,
  connect/reconnect form (renders the adapter's `credentialFields`; offers a
  provider picker when not sync-active so a skipped clinic isn't locked to the
  marker row's provider), business→location and practitioner→room mapping
  cards (copy driven by `providerLabel`), subdomain editor (rendered only when
  `capabilities.webLinks`).
- **Workflows / appointment types**: confirm imported types' modality + sync
  toggle (writes the link row, clears the cursor).
- **Form builder**: the `pmsTarget` dropdown is populated from the active
  adapter's `fieldCatalogue()`, grouped, with unique-target-per-form
  validation. A seeded "Patient Registration" form is generated from the
  catalogue at connect (`seeded-registration-form.ts`).
- **Patient slideout / failed push rows**: "Open in {PMS}" via
  `web-link.ts` → `webLinkForPatient()`; hidden when the adapter returns null.
- Provider labels everywhere come from `factory.displayName` — never derived
  from the enum value.

Routes: everything under `src/app/api/pms/*` plus
`src/app/api/setup/pms/connect`. All resolve adapters via the registry,
require staff location access, and gate config writes (connect, disconnect,
mappings, subdomain) on PM roles (`clinic_owner`, `practice_manager`).
Patient-link/push routes resolve the location server-side from the
session/appointment before authorising.

## 8. Adding a provider

The scaffolding is one folder + one line; the **live API archaeology is the
irreducible cost** — every hard moment on both existing providers was
undocumented behaviour found only against a live account (result keys that
don't match function names, read/write casing asymmetry, writes that silently
ignore unknown params with `status: success`, presigned-upload mechanics).

1. `src/lib/pms/<provider>/client.ts` — transport, pagination, backoff,
   key-gated (throws on empty key so the client stays dormant).
2. `types.ts` — raw shapes for the read/write subset.
3. `map.ts` — raw ↔ canonical; **ids as strings**; phones primary-first;
   return `updatedAt` for the cursor.
4. `field-map.ts` — static `<provider>:`-namespaced catalogue, write-param
   map (+ separate read-field map if the API is asymmetric), registration
   subset.
5. `adapter.ts` — implement the contract; build the write path on
   `orchestratePush`/`fillBlanksWrite` (supply hooks, don't copy the
   skeleton); set `capabilities()` to the truth; export the factory.
6. Register: one line in `registry.ts` `FACTORIES`. The setup grid, connect
   forms, and every generic surface light up from the registry metadata.
7. Verify end-to-end against a live account: connect → provision (rooms from
   practitioners, types imported) → confirm a type → sync pulls an
   appointment → session on the run sheet → intake completed → push writes
   back with per-field results. Pin unverifiable details as commented
   constants with actionable error fallbacks.

Guardrails: credentials are never logged or pasted into chat; get manual
sign-off before the **first write** against a real account; if the provider
needs OAuth, build the credential-persistence hook first (§3).

## 9. Known gaps (deliberate, documented)

- `PmsAppointment.archived` / `PmsPatient.archived` are mapped by adapters but
  not yet honoured by the pull (a PMS-deleted appointment stays `scheduled`).
- The patients cursor advances to local `new Date()` (the canonical
  `PmsPatient` has no `updatedAt`) — clock skew can skip updates; the lazy
  per-appointment patient fetch masks this for upcoming appointments.
- One throwing record aborts that connection's sync run (no per-record
  poison isolation); the error lands in `last_sync_error`.
- Nookal timestamps are tz-naive at the map boundary — verify `last_modified`'s
  timezone against a live account before trusting long cursor gaps.
- Nookal write verification is envelope-only; its API can silently ignore
  params, so a post-write read-back compare would be the only true defence.
- `capabilities().webhooks` / `writeNotes` are declared but consumed nowhere.
