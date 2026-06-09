# Handoff: Build the Nookal PMS integration (mirror the Cliniko build)

You are building a **two-way Nookal integration** for the Coviu platform. A
complete, working **Cliniko** integration already exists in this codebase — your
job is to add Nookal as a **second provider behind the same vendor-agnostic
normalization layer**, reusing every generic surface and only writing
Nookal-specific code inside a new adapter folder.

Nookal API docs: https://api.nookal.com/developers/setup (and the linked
`/dev/reference/*` pages — appointment, patient, location, practitioner,
services, documents, treatment-notes, invoices).

**This is a permanent prototype** (not a production deploy, but built to
production standards). Stubbed SMS / dev OTP codes / key-gated-dormant clients
are expected and fine — don't flag prototype-isms as production risks. The DB is
**Neon** (not Supabase); apply schema changes via the Neon MCP and mirror them
into `src/lib/db/schema.ts`. When appending params to a Postgres function, drop
the old overload rather than leaving a duplicate.

---

## 1. Read the Cliniko build first — it is your blueprint

The architecture, decisions, and gotchas are already settled. **Read these
before writing anything:**

- `docs/plans/cliniko-integration.md` — the full design (normalization layer,
  schema deltas §8, read sync §5, write sync §6, connection/auth §10). Almost
  all of it is provider-agnostic and applies verbatim to Nookal.
- `src/lib/pms/` — the whole layer. In particular:
  - `adapter.ts` — the `PmsAdapter` interface + `PmsAdapterFactory`,
    `PmsCapabilities`, `PmsFieldCatalogueEntry`, `PmsCredentialField`. This is
    the contract you implement. Note the optional methods
    (`uploadPatientAttachment?`, `getWebHint?`) — implement only what Nookal
    supports.
  - `registry.ts` — the provider registry. You will add one line here.
  - `types.ts` — canonical `PmsPatient`, `PmsAppointment`, `PmsPractitioner`,
    `PmsAppointmentType`, `PmsBusiness`, `PmsFormSubmissionInput`,
    `PmsPushResult`/`PmsFieldResult`. **Do not change these** unless Nookal
    genuinely needs a new canonical field; the whole point is they're shared.
  - `connection.ts`, `credentials.ts` — opaque encrypted credential storage +
    connection loading + `adapterForConnection`. Generic; reuse as-is.
  - `integrations-service.ts` — connect/verify/disconnect, `provisionFromPms`
    (auto-create rooms from practitioners + auto-map practitioner→room +
    auto-map business→location + import appointment types), `getMappingData`,
    the mapping writers, `importAppointmentTypes`, `confirmAppointmentTypeSync`.
    Generic; should work for Nookal with **no changes** once the adapter exists.
  - `session-gate.ts`, `web-link.ts` — generic.
  - `sync/pull.ts`, `sync/push.ts`, `sync/cursor.ts`, `sync/mapping.ts` — the
    sync engine. Generic; talks only to `PmsAdapter`.
  - `cliniko/` — the concrete adapter. **This is the template for your
    `nookal/` folder**: `client.ts` (HTTP, auth, pagination, backoff),
    `types.ts` (raw API shapes), `map.ts` (raw ↔ canonical), `field-map.ts`
    (static write-back field catalogue), `adapter.ts` (implements `PmsAdapter`),
    `field-map.ts` constants.
- `src/hooks/usePmsConnection.ts` + `src/components/clinic/shared/providers.tsx`
  — the shared PMS connection context (status fetched **once** per location and
  shared, so the Cliniko-dependent UI doesn't flicker). Provider-agnostic — it
  reads `provider`/`syncActive`/`providerLabel`/`accountSubdomain` from
  `/api/pms/connection`. Nookal flows through it automatically.
- All `src/app/api/pms/*` routes (connection, mappings, sync, push,
  push-appointment, attach-pdf, import-types, confirm-type, catalogue,
  patient-link, cron/pms-sync) — generic; they resolve the adapter via the
  registry and never branch on provider.

**The golden rule:** if you find yourself adding `if (provider === 'nookal')`
anywhere outside `src/lib/pms/nookal/`, stop — that logic belongs behind the
`PmsAdapter` interface (capabilities, fieldCatalogue, validateField, etc.).

---

## 2. What you're actually building

A new `src/lib/pms/nookal/` folder implementing `PmsAdapter`, registered in
`registry.ts`, plus the small wiring to make Nookal selectable. The provider
enum already includes `nookal` (`pms_provider` in the DB + schema). Everything
generic should light up for free.

### 2a. FIRST: verify the Nookal API surface against the live docs/account

The Cliniko build's hardest moments were all **undocumented/guessed API
details** (the attachment presigned path, the upload_url format, the web-link
host). The docs page for Nookal is **thin on exactly the things that matter**,
so treat these as explicit verification tasks before/while coding — do not
guess and bake assumptions in:

1. **Auth + base URL.** Nookal uses an **API key** (confirmed: `setApiKey(...)`
   in their SDK). Confirm: the exact HTTP header/param the key goes in, the base
   URL, and whether there's a region/shard component (Cliniko encodes the shard
   in the key; Nookal may differ). The adapter `verify()` should make one cheap
   authenticated call.
2. **Request/response format.** Confirm GET vs POST, JSON vs form-encoded
   request bodies, and the **response envelope shape** (Nookal historically
   wraps results like `{ status, data: { results: { ... } } }` — confirm the
   actual structure and the success/error indicator).
3. **Incremental sync.** ⚠️ Cliniko has `q[]=updated_at:>cursor`. The Nookal
   docs do **not** clearly document a last-modified/changed-since filter.
   Determine whether one exists (e.g. a `last_modified` param on appointments /
   patients). **If none exists, you cannot do a true incremental cursor** — fall
   back to a bounded window pull (today + N days of appointments) on each sync,
   and de-dupe via the connection-scoped upsert keys. Document whichever you
   pick; do not silently pretend a cursor works.
4. **Pagination.** Confirm the model (page number? offset? `nextPage`?) and the
   page size cap, then implement it in `nookal/client.ts` the way
   `cliniko/client.ts` does its `list()` async-iterator.
5. **Rate limits.** Confirm and honour (Cliniko is 200/min with 429 + backoff).
6. **Resources → canonical mapping.** Map Nookal's endpoints to the canonical
   types: appointments, patients, practitioners, locations (→ `PmsBusiness`),
   services/appointment-types. Watch naming: Nookal "locations" likely map to
   our `PmsBusiness`; Nookal "services" likely map to our `PmsAppointmentType`.
7. **Write capabilities.** Determine what Nookal supports for write-back and set
   `PmsCapabilities` accordingly:
   - Patient field updates (→ `writePatientFields`)? Build the static
     `field-map.ts` catalogue with **provider-namespaced keys** (`nookal:...`),
     exactly like Cliniko's. Only include fields Nookal's update-patient
     endpoint actually accepts; add `validateField` rules per field.
   - Posting form answers / notes (→ `writeForms`)? Nookal has "Treatment
     Notes" and "Documents" — decide which (if either) is the form-answer
     target, or set `writeForms: false` if there's no clean self-contained path.
   - File attachments (→ `writeAttachments`)? Nookal has a "Documents" resource.
     If it supports uploading a file to a patient, implement
     `uploadPatientAttachment` (mirror Cliniko's flow; Nookal's upload mechanics
     may differ — verify the exact steps, don't assume Cliniko's S3-presigned
     flow). If not, set `writeAttachments: false` and the PDF-attach button
     hides automatically.
   - Web deep links (→ `webLinks`)? If Nookal has a patient web-app URL,
     implement `webLinkForPatient` + `getWebHint` (Cliniko stores an account
     subdomain). If not, return null and the "Open in {PMS}" button hides.
8. **Webhooks.** Almost certainly none (like Cliniko) → polling via the existing
   `cron/pms-sync` route. Confirm; if Nookal *does* have webhooks, note it but
   still ship polling first.

> When an API detail can't be confirmed from docs, do what the Cliniko adapter
> did: pin the best-known value as a clearly-commented constant with a "⚠️
> verify against a live account" note, and surface a specific, actionable error
> if it's wrong — never a bare status code.

### 2b. Known sharp edges from the Cliniko build (apply the lessons)

These bit us; pre-empt them for Nookal:

- **Big integer ids.** Cliniko patient ids exceed JS's safe-integer range, so
  `Number(id)` silently corrupted them. **Treat all external ids as strings end
  to end** — never `Number()` them. Check whether Nookal ids are large too.
- **Phone normalisation.** Synced patient phones MUST be normalised to E.164 via
  `normalisePhone` (`src/lib/phone/normalise.ts`) before storing, or the patient
  OTP/intake verify won't match (`"phone not on file"`). Do this in the pull's
  patient upsert.
- **Primary phone.** The first synced phone must be marked `is_primary` (the
  workflow engine + run sheet resolve contact via the primary), else
  `add_to_runsheet` fails "No phone number on file" and no session spawns.
- **Connection-scoped upsert keys.** Idempotency keys are
  `(connection_id, pms_external_id)` via the link tables
  (`pms_patient_links`, `pms_practitioner_links`, `pms_appointment_type_links`)
  and `(location_id, pms_external_id)` for appointments (partial unique index;
  the `ON CONFLICT` must repeat the `WHERE pms_external_id IS NOT NULL`
  predicate — Drizzle `onConflictDoNothing({ where })`). All of this already
  exists and is generic; you just supply Nookal external ids as strings.
- **Sessions are workflow-backed, not direct.** Upserting an `appointments` row
  does NOT put it on the run sheet. The pull calls
  `scheduleWorkflowForAppointment` (`src/lib/workflows/scanner.ts`) so the
  `add_to_runsheet` action spawns the session. This is generic — already wired
  in `sync/pull.ts`. The appointment type must have a `type_workflow_links` row;
  the type-import path handles that.
- **Room placement = practitioner→room.** A synced appointment's room comes from
  the **practitioner→room** mapping (`pms_practitioner_links.room_id`), not the
  type. `provisionFromPms` auto-creates a room per practitioner and maps it; the
  pull gate is: type confirmed telehealth + sync_enabled + practitioner mapped
  to a room. Generic — works for Nookal once `listPractitioners` returns data.
- **`intake_package` must not be dropped for imminent appointments** — already
  fixed in the scanner; no action needed, just don't regress it.
- **Lazy patient + reconciliation.** The pull lazily fetches a patient via
  `adapter.getPatient(externalId)` if an appointment references an unlinked one,
  and a reconciliation pass re-pulls patients deleted locally. Implement
  `getPatient` and `getAppointment` on the Nookal adapter (single-record
  fetches) so these work.

---

## 3. Build order (mirror Cliniko, verify as you go)

1. **`nookal/client.ts`** — auth, base URL, request format, pagination,
   rate-limit backoff, key-gated (dormant without a key). Verify §2a items 1–5.
2. **`nookal/types.ts`** — raw Nookal response shapes (the subset you read/write).
3. **`nookal/map.ts`** — raw ↔ canonical translation for patients, appointments,
   practitioners, locations→businesses, services→appointment-types. External ids
   as strings.
4. **`nookal/field-map.ts`** — static, `nookal:`-namespaced write-back catalogue
   (only fields Nookal's patient-update endpoint accepts), with the registration
   field subset for the seeded form. Skip if no patient-field write support.
5. **`nookal/adapter.ts`** — implement `PmsAdapter`: `verify`, `listAppointments`
   (incremental or windowed per §2a item 3), `listPatients`, `getPatient`,
   `getAppointment`, `listPractitioners`, `listAppointmentTypes`,
   `listBusinesses`, `pushFormSubmission` (fill-blanks-only, per-field results),
   `capabilities`, `fieldCatalogue`, `validateField`, `credentialFields`, and
   the optional `webLinkForPatient`/`getWebHint`/`uploadPatientAttachment` as
   supported. Export a `nookalFactory: PmsAdapterFactory`.
6. **Register it** — add `[nookalFactory.provider]: nookalFactory` to
   `FACTORIES` in `registry.ts`. That's the only registry change.
7. **Make Nookal selectable in the UI** — in `src/components/setup/pms-selection-grid.tsx`
   Nookal is currently `comingSoon: true`. Flip it to a real connect (mirror the
   Cliniko inline API-key modal → `/api/setup/pms/connect`). The Settings →
   Integrations connect form already renders whatever `credentialFields()`
   declares, so it works with no UI change.
8. **No schema changes expected.** The link tables, `pms_connections`
   (creds/subdomain/sync columns), `forms.pms_provider`, and
   `form_submissions` push columns are all provider-generic and already exist.
   Only add a column if Nookal needs something Cliniko didn't (justify it).

### Verify end-to-end (same path we validated for Cliniko)
Connect Nookal (real key) → Settings → Integrations shows status + auto-maps the
single business + auto-creates rooms from practitioners + imports services →
confirm a service as telehealth + sync-on in Workflows → "Sync now" on the run
sheet pulls an appointment → it spawns a session with the patient (primary
E.164 phone) on the run sheet → open the intake → complete it → "Sync to Nookal"
writes the fields back (per-field results) → "Open in Nookal" deep link resolves
(if supported).

---

## 4. Operational guardrails (same as Cliniko)

- The Nookal API key is a credential: stored encrypted via the existing
  `credentials.ts` blob, never logged or pasted into chat.
- Get **manual sign-off before the first WRITE** (patient update / document
  upload) hits a real Nookal account.
- Gentu remains a stubbed demo (no real adapter, no credentials → not
  sync-active). Don't touch it.
- Deploy TODOs already noted for the project: the `pms-sync` cron on Vercel and
  `PMS_ENCRYPTION_KEY`; and `DISABLE_OTP_RATE_LIMIT=true` is a test-only flag to
  turn off before any real environment.

---

## 5. Definition of done

- [ ] `src/lib/pms/nookal/` implements `PmsAdapter`, registered in `registry.ts`.
- [ ] No `provider === 'nookal'` branches outside `src/lib/pms/nookal/`.
- [ ] External ids handled as strings everywhere (no `Number()`).
- [ ] Synced phones normalised to E.164, first one primary.
- [ ] Capabilities reflect what Nookal actually supports; unsupported surfaces
      (attach PDF, web link, form write-back) hide cleanly via capability gating.
- [ ] Incremental-vs-windowed sync decision documented in `pull`/adapter
      comments with the reason.
- [ ] `npx tsc --noEmit` clean, `npm run build` compiles, no new lint errors.
- [ ] End-to-end path in §3 verified against a live Nookal account (or clearly
      noted where a live account was unavailable and what remains to confirm).
- [ ] Update `docs/plans/cliniko-integration.md`'s provider list / this repo's
      PMS notes to mention Nookal is built.
