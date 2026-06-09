# Plan: Cliniko Integration (two-way) via a Normalization Layer

Status: **Design / not yet built.** This plan supersedes the sketch-level
detail in `docs/claude-project/feature-pms-integration.md` for the Cliniko
specifics. The feature doc remains the higher-level "why"; reconcile the two
once this is built (notably the auth method — see §10).

## 1. Goal

A two-way Cliniko integration, structured behind a vendor-agnostic
normalization layer so future PMS systems (Halaxy, Power Diary, Nookal, …) drop
in without rewriting core logic.

- **Read (inbound):** pull Cliniko appointments into the Coviu appointment book
  so the run sheet reflects what the PMS has. Telehealth appointments are the
  primary target. Pulls supporting records (patients, practitioners,
  appointment types, businesses) as dependencies.
- **Write (outbound):** push completed Coviu form submissions back into Cliniko
  via a **predefined, static field-mapping catalogue** (see §6). Tasks are
  out of scope as a Cliniko write target (Cliniko has no Tasks resource — §9).

## 2. Feasibility summary

Feasible, low-to-moderate difficulty (~6/10). Cliniko has a clean REST API and
our schema already carries the hooks (`pms_external_id` on `appointments` and
`appointment_types`). Difficulty is in sync correctness (cursors, idempotency,
rate limits), not the API surface.

| Capability | Feasible? | Notes |
|---|---|---|
| Read appointments → run sheet | ✅ | `GET /individual_appointments`, filter `updated_at`. |
| Read patients / practitioners / businesses / appointment_types | ✅ | All GET-supported. |
| Telehealth determination | ✅ (our side) | Map Cliniko appointment types → Coviu `modality` + room. Do NOT use the appointment's `telehealth_url` — Cliniko's [telehealth guide](https://docs.api.cliniko.com/guides/telehealth_links) confirms it can be populated even for non-telehealth types, so it's unsafe for detection. |
| Write form submissions → Cliniko | ✅ | Two Coviu-driven paths, no Cliniko template needed: direct `PATCH /patients` field updates, and self-contained `POST /patient_forms` with our own content + answers. |
| Webhooks (push) | ❌ | Not supported by Cliniko (open feature request since 2017). Use polling. |
| Tasks write-back | ⚠️ | No Cliniko Tasks resource. Keep Coviu-only. |
| Arrival / payment write-back | ⚠️ | Possible later via `PATCH`; out of scope here. |

## 3. Cliniko API facts (confirmed from docs.api.cliniko.com)

- **Auth:** HTTP Basic — `base64(api_key + ":")`. **Not OAuth.** The shard
  (`au1`, `au2`, `uk1`, …) is encoded in the API key suffix → derive the base
  URL from the key.
- **Base URL:** `https://api.{shard}.cliniko.com/v1/`.
- **Rate limit:** 200 requests / minute / user → `429` on breach. Fine for
  polling; matters during first-run backfill.
- **Pagination:** 50/page default, 100 max; responses carry `total_entries`
  and `next`/`self`/`previous` links.
- **Filtering:** `q[]` with operators (`=`, `!=`, `~`, `>`, `<`), plus `sort`
  and `order`. Incremental sync uses `q[]=updated_at:>{cursor}`, ordered
  ascending.
- **Times:** all UTC. Display in location timezone (existing convention).
- **Writes:** PATCH + `archive`/`unarchive` actions; DELETE is deprecated.
- **No webhooks.** Polling is the only option.

Relevant resources and methods:

- `individual_appointments`: GET (list/retrieve), POST, PATCH, `/cancel`,
  `/archive`, `/conflicts`.
- `patients`: GET, POST, PATCH, `/archive`, `/unarchive`.
- `practitioners`: GET only.
- `businesses`: GET, POST, PATCH, archive/unarchive.
- `appointment_types`: GET, POST, PATCH, archive.
- `patient_forms` + `patient_form_templates`: GET, POST, PATCH, archive.
- `patient_attachments`, `treatment_notes`: GET, POST, PATCH, archive (held in
  reserve; not used in v1).

## 4. The normalization layer

Vendor-agnostic adapter so Cliniko is replaceable. Three rings: Coviu domain →
normalization layer (canonical types + `PmsAdapter` interface) → concrete
`ClinikoAdapter`. The Coviu sync engine only ever talks to `PmsAdapter`; a new
PMS is one new folder implementing the interface.

```
src/lib/pms/
  types.ts            # Canonical PmsAppointment, PmsPatient, PmsPractitioner,
                      #   PmsAppointmentType, PmsBusiness, PmsFormSubmissionInput
  adapter.ts          # PmsAdapter interface + PmsCapabilities
  field-catalogue.ts  # Canonical Coviu field keys (the stable vocabulary)
  sync/
    pull.ts           # Read sync: appointments + dependencies → Coviu upsert
    push.ts           # Write sync: Coviu form submissions → PMS
    cursor.ts         # Incremental updated_at watermark per resource
    mapping.ts        # External-id resolution (Cliniko id ↔ Coviu uuid)
  cliniko/
    client.ts         # Auth, shard routing, pagination, 429 backoff
    adapter.ts        # implements PmsAdapter
    map.ts            # Cliniko payload ↔ canonical translation
    field-map.ts      # STATIC Cliniko field catalogue (see §6)
    types.ts          # Raw Cliniko response shapes
```

`PmsAdapter` (the contract):

```ts
interface PmsAdapter {
  // CONNECTION
  verify(): Promise<{ ok: boolean; detail?: string }>;   // cheap authenticated check
  // READ
  listAppointments(opts: { since?: Date; businessId?: string }): AsyncIterable<PmsAppointment>;
  listPatients(opts: { since?: Date }): AsyncIterable<PmsPatient>;
  listPractitioners(): Promise<PmsPractitioner[]>;
  listAppointmentTypes(): Promise<PmsAppointmentType[]>;
  listBusinesses(): Promise<PmsBusiness[]>;
  // WRITE — returns a per-field result so the UI can show what did/didn't copy (§6.1)
  pushFormSubmission(input: PmsFormSubmissionInput): Promise<PmsPushResult>;
  // METADATA for the UI — provider declares its own mappable targets & labels
  capabilities(): PmsCapabilities; // { webhooks, writeForms, writeNotes, writePatientFields, webLinks }
  fieldCatalogue(): PmsFieldCatalogueEntry[]; // static, provider-namespaced write targets (§6)
  validateField(key: string, value: string): { ok: true } | { ok: false; failureKind: string; detail: string }; // per-target validation (§6.1)
  webLinkForPatient(externalId: string): string | null; // human-facing web-app URL, or null (§6.2)
}
```

The Settings/onboarding UI (§7) is built entirely against this interface: it
calls `verify()` to test a connection, the `list*` methods to populate mapping
pickers, `capabilities()` to decide which surfaces to render, and
`fieldCatalogue()` to drive the form-field binding picker. **No UI code
references a specific provider** — adding a PMS means shipping a new adapter
folder, registering it, and the existing surfaces light up. `capabilities()`
also means the UI degrades gracefully per PMS (a PMS that can't write forms
hides that toggle).

**The adapter owns the connection/auth model.** Authentication differs per PMS
(Cliniko uses an API key; another provider might use OAuth), so neither the
schema nor the generic layer hard-codes a credential shape. The adapter
declares what credentials it needs (for the connect form), serialises them into
an opaque encrypted credentials blob on `pms_connections` (a **new column** —
the table exists today but has no credential storage; see §8), and reads them
back to authenticate. The generic layer treats credentials as opaque — it
stores, encrypts, and hands the blob to the adapter, never inspecting it. So
switching a provider from API-key to OAuth is entirely internal to that adapter;
no schema or generic-layer change.

## 5. Read sync (Cliniko → run sheet)

**Cadence:** cron every **2–3 minutes** (polling accepted — no webhooks).
Add a manual **"Sync now"** button on the run sheet for receptionists.

**Incremental strategy:** `q[]=updated_at:>{cursor}`, ascending, paginate,
advance the watermark to the max `updated_at` seen. **One cursor per
`(connection_id, resource)`** in `pms_sync_cursors` (§8.B) — keyed on the
connection, not the org, so replacing a connection starts its cursors clean.
First run does a bounded forward backfill (today + N days).

**Pull order (dependencies first):**
1. `businesses` → Coviu `locations` (mapping; see §7b — `locations` gains
   `pms_external_id`).
2. `practitioners` → Coviu clinicians. **Mapping is scoped to the
   staff_assignment, not the global user.** `users` is global-by-email; PMS
   practitioner identity is org/provider/business scoped. Store the link on
   `staff_assignments` (or a dedicated `pms_practitioner_links` table), never as
   a single external id on `users`.
3. `appointment_types` → upsert Coviu `appointment_types`. **Insert unmapped
   types as `in_person` (or an explicit `unmapped` modality), NOT the schema
   default `telehealth`** — otherwise an unconfirmed Cliniko type silently
   becomes telehealth and starts spawning sessions. Modality is only trusted
   after the practice confirms it in Settings (see finding below).
4. `patients` (changed since cursor) → **upsert Coviu patients** + phone
   numbers (decision: full auto-upsert). The Cliniko↔Coviu patient link is a
   **connection-scoped `pms_patient_links` row**, not a column on `patients`
   (patients are org-scoped and may link under several connections; §8.C).
5. `individual_appointments` (changed since cursor) → upsert Coviu
   `appointments`, then **schedule the pre-appointment workflow** (see below).

**Critical: appointments are session-backed via the workflow engine, not
directly.** Creating an `appointments` row does NOT put anything on the run
sheet. Sessions are created by the `add_to_runsheet` workflow action. So after
upserting a synced appointment, the pull path must call
`scheduleWorkflowForAppointment(appointmentId, appointmentTypeId, scheduledAt)`
(`src/lib/workflows/scanner.ts`) — exactly the seam the handler already
anticipates ("from add-patient panel, **PMS webhook**, or daily scan"). This
requires the imported telehealth appointment types to have a linked
pre-workflow (with an `add_to_runsheet` block); part of the type-mapping step is
ensuring a workflow link exists, else synced appointments never reach the run
sheet.

**Telehealth + room placement (our logic, not Cliniko's):** after step 3 the
practice opens **Settings → Integrations** (or Appointment Types), sees the
synced types, and confirms each as `telehealth` / `in_person` plus a target
**room** + workflow link. Stored on Coviu's side only. A confirmed
telehealth type's appointment gets its `room_id` from that mapping; the
scheduled `add_to_runsheet` action then spawns the session.

**Read scope (decision): telehealth only for v1.** Appointments whose type is
not *confirmed* telehealth are skipped — they don't reach the run sheet.
In-person sync rides the Complete-tier QR/in-person flow later. The pull still
fetches all appointment *types* (step 3) so the practice can confirm them; it
just doesn't schedule workflows / create sessions for non-telehealth types.

**Idempotency:** upserts key on **`(connection_id, pms_external_id)`** — *not*
`(org_id, …)`, since Cliniko ids are account-scoped and two accounts in one org
would collide (§8.H). Patient links resolve via `pms_patient_links`. Cliniko
`cancelled_at` / `archived_at` / `did_not_arrive` map to Coviu
`appointment_status` (`cancelled` / `no_show`) and cascade to the session. On
reschedule/cancel of an already-synced appointment, the pull must also adjust
the scheduled workflow actions (the same concern `scheduleWorkflowForAppointment`
callers handle).

## 6. Write sync (Coviu forms → Cliniko) — static field mapping

**Key API finding (confirmed from the spec):** we do **not** have to use
Cliniko's own form templates, and we do not introspect the clinic's templates
at runtime. The Cliniko API gives us two independent, fully Coviu-driven write
paths:

1. **Patient fields — direct, no form involved.** `PATCH /patients/{id}` writes
   a rich, documented set of fields straight onto the patient record:
   `first_name`, `last_name`, `date_of_birth`, `email`, `patient_phone_numbers`,
   address (`address_1..3`, `city`, `state`, `post_code`, `country_code`),
   `gender_identity` / `sex` / `pronouns`, `title`, `medicare` /
   `medicare_reference_number` / `dva_card_number`, `emergency_contact`,
   `occupation`, `referral_source`, `notes`, `appointment_notes`, and arbitrary
   **`custom_fields`**. Anything that is a standard patient attribute maps here.

2. **Form answers — self-contained `patient_form`, no template required.**
   `patient_form_template_id` is **optional** on `POST /patient_forms`. We can
   post our own `content` — `sections` → `questions`, where each question
   carries `name`, `type`, `required`, and an already-filled **`answer`**. So
   Coviu owns the form structure end to end and sends Cliniko a *completed*
   form built from the Coviu submission. A question can additionally carry a
   `patient_field_connection` / `custom_field_token`, which routes that answer
   into a native patient field or custom field as part of the same post.

**Core principle — generic mechanism, provider-specific vocabulary.** The
mapping must be *general* (one builder/property/seed/push pipeline for all PMSs)
yet *specific* (the actual fields, validation, and write semantics are Cliniko's,
or any other PMS's). The seam that achieves both is the **field catalogue**: an
adapter emits its write targets as plain data, and every generic surface
consumes that data without ever branching on which PMS produced it.

| Generic (one implementation, all PMSs) | Provider-specific (per adapter) |
|---|---|
| SurveyJS `pmsTarget` custom property + its builder dropdown | `fieldCatalogue()` — what targets exist, labels, value types, enum choices |
| Binding stored in `forms.schema` (the key only) | resolving a catalogue **key** → a concrete API write |
| Seeded-form generator (reads the catalogue) | per-field validation / value coercion |
| Push orchestration (`push.ts`) | fill-blanks read-before-write; error→`failureKind` mapping |
| Per-field result UI; "Open in {PMS}" | endpoint routing (`PATCH /patients` vs `POST /patient_forms`), `custom_field_token` |

The **catalogue entry is the contract** (extends §4's `fieldCatalogue()`):
```ts
interface PmsFieldCatalogueEntry {
  key: string;            // stable, PROVIDER-NAMESPACED: 'cliniko:patient.date_of_birth'
  group: string;          // 'Patient' | 'Form answer' | ... (groups the dropdown)
  label: string;          // 'Date of birth' (what the PM sees in the builder)
  valueType: 'text' | 'date' | 'phone' | 'enum' | 'longtext';
  enumChoices?: string[]; // for enum targets (e.g. Cliniko's accepted 'sex' values)
  writeMode: 'patient_field' | 'form_answer'; // how the adapter will write it
}
```
Keys are **provider-namespaced** (decision: per-adapter catalogue, no shared
canonical vocabulary). Each adapter is the sole source of truth for its own
field set — Cliniko exposes `sex`/`medicare`/`dva_card_number`; another PMS
won't, and we don't force a neutral middle layer that leaks when PMSs differ.
For Cliniko the catalogue lives in `cliniko/field-map.ts`; it is *fixed and
documented* ahead of time (no auto-generation, no per-clinic template reading).

Each form question binds to a catalogue key that is one of: a **patient field**
(→ `PATCH /patients` or a `patient_field_connection`), a **standalone form
answer** (→ a question in the posted `patient_form` content), or **nothing**
(Coviu-only).

**The builder UI — a SurveyJS custom property, not a custom widget.** We
register one custom property on the question class via
`Serializer.addProperty(...)` (the idiomatic SurveyJS extension point —
[docs](https://surveyjs.io/form-library/documentation/customize-question-types/add-custom-properties-to-a-form)).
SurveyJS then:
- **renders it automatically in the Property Grid** (right panel when a question
  is selected) as a **dropdown** whose choices are `fieldCatalogue()` grouped by
  `group`, plus "(Don't send to PMS)"; and
- **serialises it into `forms.schema`** with no separate save path.

So the practice manager selects a question and picks "Write back to {PMS} → Date
of birth." The dropdown is **data-driven from the active adapter's catalogue**,
so it's provider-neutral by construction — the builder code never names Cliniko.

```jsonc
// resulting question element inside forms.schema
{ "type": "text", "name": "patient_dob", "title": "Date of birth",
  "pmsTarget": "cliniko:patient.date_of_birth" }   // omitted/null = unmapped
```

**Binding rule (decision): unique target per form.** The builder warns/prevents
two questions in the same form mapping to the same catalogue key, so the push is
unambiguous (no last-wins guessing). Enforced in the property's validation.

**Auto-seeded "Patient Registration" form on connect (decision: a separate
form).** When a location connects a PMS, Coviu generates a distinct **"Patient
Registration"** form from the catalogue — one question per common patient-field
target, each with `pmsTarget` pre-set — so the clinic has a working write-back
form immediately, editable like any other in the builder. This is separate from
the existing seeded **"New Patient Intake"** (`newPatientIntakeSchema()` in
`src/lib/survey/identity-page.ts`); the two coexist (registration = PMS
write-back; intake = clinical capture). The generator is generic: it reads
whatever the active adapter's catalogue declares as patient-field targets.

**Forms are PMS-scoped (decision).** A form's `pmsTarget` keys belong to one
provider's vocabulary, so a PMS-bound form is **tagged with its provider** and
only offered/active at locations running that PMS (one-PMS-per-location, §8.A).
This prevents a Cliniko-mapped form from silently no-op'ing at a different-PMS
location. Store the provider tag on the form (e.g. `forms.pms_provider`,
nullable = not PMS-bound). Generic forms with no `pmsTarget` bindings stay
provider-agnostic and usable everywhere.

**Storage = `forms.schema` (Option A, committed).** The binding lives on the
question inside `forms.schema` — no `form_fields`, no separate mapping table.
It travels with the form (export/import/duplicate), the builder already owns
`creator.JSON`, and there's no second source of truth to drift. The only cost is
that bindings aren't directly SQL-queryable; if that need arises, derive a
**read-only projection** from `forms.schema` rather than making a table
authoritative.

**Flow when a patient completes a Coviu form tied to an appointment:**
1. `push.ts` reads each question's `pmsTarget` from `forms.schema` and matches it
   to `form_submissions.responses` by question `name`. It hands the active
   adapter `{ key, value }` pairs — `push.ts` itself stays provider-agnostic.
2. Translates the submission into a canonical `PmsFormSubmissionInput`
   (patient-field updates + standalone form answers, each tagged with its
   Cliniko target from the static catalogue).
3. `ClinikoAdapter.pushFormSubmission` resolves the Cliniko patient id (via
   the `pms_patient_links` row for `(connection_id, patient_id)` — §8.C, not a
   column on `patients`), then:
   - **patient-field writes use fill-blanks-only semantics** (decision): read
     the current Cliniko value first and only `PATCH` fields that are currently
     empty, so we never clobber clinic-entered data;
   - `POST`s a self-contained `patient_form` carrying the form answers.
4. Records the returned Cliniko id + push status against the submission — which
   `form_submissions` cannot hold today (see §8 idempotency).

**Why static, not generated:** the field set is known from the API docs ahead
of time, so the catalogue is a maintained constant. Cheaper, predictable, no
per-clinic template introspection, and the same catalogue powers the onboarding
picker and the runtime push.

### 6.1 Trigger: staff-driven write-back at "Complete", with per-field feedback

The push is **not** automatic on form submission. It is an **explicit staff
action**, triggered from the Process flow's terminal step. This matches the
product requirement: when a PMS integration is present, the **"Complete" button
transcribes the relevant fields back to the PMS** as part of completing the
session — and surfaces visual feedback for any field that did not copy over.

**Where it lives.** `src/components/clinic/process-flow/process-flow-done.tsx`
is the terminal step (`payment → outcome → done`). Today (`process-flow-done.tsx:1`)
it auto-fires `markSessionDone` on mount and auto-closes after 2s — there is no
manual gate. **The new manual path is gated strictly on a *sync-active*
connection for the session's location** — i.e. a `pms_connections` row with
`credentials_encrypted` present (§8.A) AND `capabilities().writeForms` /
`writePatientFields`. Nothing else (tier, status, presence of a marker row)
flips the behaviour:

- **Gate true** → the Done step renders a **"Complete & send to {PMS}"** button
  instead of auto-completing.
- **Gate false (no sync-active connection)** → the Done step is **byte-for-byte
  today's behaviour**: auto-fire `markSessionDone`, auto-close after 2s. Core
  tier, unintegrated Complete locations, and legacy marker-only rows all take
  this path. (Build order carries an explicit regression check, finding 6.)

When the button is shown:
1. Clicking it runs the write-back (`push.ts` → `ClinikoAdapter`) for the
   session's mapped form submission(s) **and then** `markSessionDone`. The
   session is not marked done until the staff member has triggered the push.
2. The button shows in-flight state; on settle it renders a **per-field
   result list**.

**Per-field visual feedback.** The push returns a structured per-target result
so the UI can show exactly what landed and what didn't — not just a global
success/fail. Extend the adapter return:

```ts
interface PmsPushResult {
  externalId?: string;                 // created patient_form id, if any
  fields: PmsFieldResult[];
}
interface PmsFieldResult {
  coviuQuestionName: string;           // SurveyJS question name
  target: string;                      // catalogue key, e.g. 'patient.date_of_birth'
  label: string;                       // human label for the field (for the UI row)
  attemptedValue: string;              // the value we tried to write (pre-fills the edit box)
  status: 'written' | 'skipped_existing' | 'unmapped' | 'failed';
  failureKind?: 'validation' | 'transport' | 'auth' | 'mapping'; // why it failed
  detail?: string;                     // specific, actionable reason (see below)
}
```

- **written** — value pushed. Green tick.
- **skipped_existing** — fill-blanks-only left an existing PMS value untouched
  (the §6 decision). Shown as an amber "kept existing" note, not an error.
- **unmapped** — a Coviu answer with no PMS target; informational, so staff
  know it stays Coviu-only.
- **failed** — the value didn't land. Red, with a **specific** `detail`. Because
  we never overwrite (fill-blanks-only), a failure is never "we clobbered an
  active field" — it's almost always **the value didn't fit Cliniko's
  expectations** (`validation`), or a transient `transport`/`auth`/`mapping`
  issue. These are *fixable by the receptionist on the spot*, which is the whole
  point of the next subsection.

**Failed fields are inline-editable + re-sendable (not a dead end).** When a
field fails validation, the receptionist can correct it right there in the
result list and re-send — no need to reopen the patient's Coviu form or leave
the Process flow:
1. Each `failed` row renders an **editable input pre-filled with
   `attemptedValue`** plus the `detail` message.
2. The receptionist types the corrected value and hits **"Send"** on that row
   (or "Retry failed fields" for all).
3. The corrected value is pushed via the same `PATCH`/`patient_form` path; on
   success the row flips to **written**.

This requires the **failure message to be specific and actionable** — not "write
failed." The adapter maps the PMS's rejection into a `failureKind` + a
human-readable `detail` so the receptionist knows what to type:
- `validation` → "Cliniko rejected the date — expected `YYYY-MM-DD`." /
  "Not a valid Australian mobile (E.164)." / "Cliniko doesn't recognise this
  value for *Sex*."
- `transport` → "Couldn't reach Cliniko (timed out) — try again." (retry, no
  edit needed)
- `auth` → "Cliniko connection rejected — check the integration in Settings."
- `mapping` → "This field is no longer present in Cliniko." (a config fix, not a
  value fix)
The adapter is responsible for translating Cliniko's error payloads into these;
generic "400 Bad Request" is not acceptable feedback.

**Deep link to the patient in Cliniko (escape hatch for `validation` fails).**
When a value won't go through the API, the fastest fix is to drop the
receptionist straight onto that patient's record in Cliniko and type it in the
source system. Each `failed` row therefore offers an **"Open in Cliniko ↗"**
link alongside the inline edit. We can construct it because we hold the
patient's Cliniko id (via the `pms_patient_links` row for
`(connection_id, patient_id)`) and the shard (from the connection). See §6.2
for the URL mechanics and the caveat.

**Completion is not blocked by a failed field.** The receptionist may correct
and re-send, open the patient in Cliniko and type it manually, *or* finish the
session and leave the field for later — the session lifecycle is never hostage
to a PMS write (decision: since we never overwrite, proceeding carries no
data-integrity risk).

**Reliability.** Each attempt (per-field status + attempted value + detail) is
recorded against the submission via the §8.G push columns/receipts, so a
partially-failed push survives a page reload and can be re-sent later from the
session's record. Idempotency keys on the stored
`form_submissions.pms_external_id` (the created `patient_form` id): a re-send
PATCHes only still-blank patient fields and PATCHes the existing `patient_form`
rather than duplicating it (§8.G).

**Bulk processing.** In bulk mode the write-back runs per session as each is
completed; the per-field detail collapses to a summary badge per session
("3 sent · 1 kept · 1 failed"), expandable for the detail list.

### 6.2 Deep linking to the PMS

**"Open in {PMS}" — a first-class action on every patient record slideout.**
The patient record slideout (`patient-contact-card/index.tsx` →
`DemographicsSection`) has a **Quick actions** row under the patient name
(`demographics-section.tsx:49`), today holding *Take payment* / *Send SMS* plus
the readiness slot. Add an **"Open in {PMS} ↗"** button to that row, shown
whenever the location's connection is sync-active **and** a `pms_patient_links`
row exists for `(connection_id, patient_id)`. Clicking it opens the patient's
record in the PMS web app in a new tab. The same URL builder backs the §6.1
failed-field "Open in {PMS}" link — one helper, two call sites.

- **Where the button lives:** the Quick actions row in `DemographicsSection`
  (pass an optional `pmsLink` prop, render next to Take payment / Send SMS).
  Hidden when no sync-active connection or no link row for this patient.
- **How the URL is built — adapter-owned, provider-agnostic.** Add to the
  interface:
  ```ts
  // returns the human-facing web-app URL for an entity, or null if unsupported
  webLinkForPatient(externalId: string): string | null;
  ```
  The caller resolves the patient's external id from the `pms_patient_links`
  row for the active connection and passes it in; the Cliniko adapter combines
  it with the account host/shard held in the connection. The UI never knows the
  URL shape — it just renders whatever `webLinkForPatient` returns, and shows
  nothing if null (so a PMS without web deep links degrades cleanly).
- **⚠️ Caveat to verify at build time.** Cliniko's API returns only `api.*`
  self-links, **not** the `app`/account web URL, and the exact patient web-URL
  host/path is auth-gated and undocumented publicly. Confirm the real format
  against a live Cliniko account and pin it as a constant in the adapter; if
  Cliniko changes it, it's a one-line adapter fix. Sources:
  <https://docs.api.cliniko.com/openapi/patient> (self-link is `api.*` only) and
  the community note that the patient id is the trailing segment of the web URL
  (<https://help.finger-ink.com/en/articles/4228989>).

**Reverse direction (optional, later): Connected Patient Apps.** Cliniko has a
*native, documented* feature (Settings → Our clinic → Integrations) where a
clinic registers an "App URL"; Cliniko then shows an **"Open in {Coviu}"** button
on every patient profile, deep-linking **from Cliniko into Coviu** (e.g. to the
patient's session / run-sheet context). This is additive and inbound — it does
not solve the failed-field case (which needs Coviu→Cliniko, handled above) — but
it's a clean round-trip worth offering once the core integration lands.
Source: <https://www.cliniko.com/connected-apps/>.

## 7. Connection & mapping surfaces (provider-agnostic)

Everything in this section is expressed against the **canonical layer /
`PmsAdapter`**, not Cliniko directly. Cliniko is the first concrete provider;
the UI, the mapping model, and the schema (`pms_connections`,
`pms_sync_cursors`, `pms_external_id`) are all provider-neutral so a second PMS
reuses the same surfaces. Provider-specific details (auth shape, the field
catalogue, exact resource names) live entirely inside the adapter and are
surfaced to the UI via `capabilities()` and adapter-provided metadata
(catalogue entries, resource labels). The UI renders whatever the active
adapter declares — it has no `if (provider === 'cliniko')` branches.

There are **two distinct surfaces** that share the same underlying mapping
model:

### 7a. Onboarding (first-run)

When a clinic connects a PMS during onboarding:
- **Connect:** capture credentials in the shape the adapter declares (for
  Cliniko: API key; derive shard from it). Store encrypted; verify with a cheap
  authenticated call via `adapter.verify()`.
- **First dependency pull:** businesses, practitioners, appointment types.
- **Guided mapping pass:** walk the practice through the mapping surfaces below
  with sensible auto-match defaults (e.g. name-match practitioners → users,
  business → location). This is the *first-run* pass — get them to a working
  state quickly.
- Hand off to the run sheet once at least one telehealth type is mapped to a
  room.

### 7b. Settings → Integrations (ongoing management)

A standalone, persistent **Settings → Integrations** page (practice-manager
scoped), distinct from onboarding. This is where mappings live for the life of
the connection — onboarding just seeds them. The page is generic over the
active provider; it reads labels and capabilities from the adapter.

- **Connection management:** connection status, last sync time/result, rotate
  credentials, manual **"Sync now"**, disconnect. Backed by `pms_connections`.
- **Mapping surfaces** (each a first-class, editable mapping, persisted via
  `pms_external_id` on the Coviu side):
  - **Appointment types → modality + room.** Each PMS appointment type is
    flagged `telehealth` / `in_person` and (for telehealth) bound to a Coviu
    room. Drives read-sync placement and the telehealth-only scope (§5).
    Columns/join table on `appointment_types`.
  - **Practitioners → Coviu clinicians.** Each PMS practitioner links to a
    clinician on the run sheet. **Scoped to `staff_assignments`, not the global
    `users` row** — `users` is global-by-email and PMS practitioner identity is
    org/provider/business scoped. Use a link on `staff_assignments` or a
    dedicated `pms_practitioner_links` table. First-class because an unmapped
    practitioner means appointments can't resolve a clinician.
  - **Businesses → Coviu locations.** Each PMS business links to a Coviu
    location, stored as `pms_external_id` on `locations` (a new column).
    Determines which location's run sheet an appointment lands on.
  - **Form questions → PMS field catalogue.** Coviu form questions (by SurveyJS
    `name`) bound to PMS targets (patient field / standalone form answer /
    unmapped) via the adapter-provided field catalogue (§6). Authored in the
    form builder (SurveyJS), surfaced/auditable here.
- **Capability-gated:** surfaces only appear if `capabilities()` declares the
  provider supports them (e.g. `writePatientFields`, `writeForms`). A PMS that
  can't write forms simply doesn't show the field-catalogue binding.

Both surfaces write to the same mapping records, so a mapping seeded during
onboarding is editable forever in Settings, and a clinic that skipped a mapping
at onboarding can complete it later.

## 8. Schema changes (reconciled with the live schema)

The live schema (`src/lib/db/schema.ts`, Neon — not migration 001) already has
some of this. **These are deltas against what exists, not a greenfield design.**
Verified against the repo:

**A. `pms_connections` already exists — ALTER, don't CREATE. AND re-scope it
from org to location.** Today it is a single-row-**per-org** connect marker:
`{ id, org_id (UNIQUE), provider (enum pms_provider), status (enum
pms_connection_status = 'connected'|'skipped'|'pending'), imported_data jsonb,
created_at }`. It has **no credential storage, no shard, no last_synced_at, no
updated_at**, and the unique key is `org_id` alone.

**Product decision: one PMS integration per *location*, not per org.** A
multi-location clinic has independent integrations per location (each its own
credentials, sync state, and mappings). So the connection must be re-scoped to
`location_id`:
```sql
ALTER TABLE pms_connections
  ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  ADD COLUMN credentials_encrypted TEXT,          -- opaque, adapter-owned (§4)
  ADD COLUMN default_business_external_id TEXT,
  ADD COLUMN last_synced_at TIMESTAMPTZ,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Backfill location_id for any existing rows (each org's existing connection
-- maps to its primary/first location), then enforce NOT NULL.
-- Replace the org-scoped uniqueness with location-scoped:
ALTER TABLE pms_connections DROP CONSTRAINT pms_connections_org_id_key;
ALTER TABLE pms_connections ADD CONSTRAINT pms_connections_location_id_key UNIQUE (location_id);
-- Keep org_id (denormalised, handy for org-wide queries) or derive via
-- locations.org_id — either is fine; one row per location is the invariant.
-- Reuse the existing 'connected' status for an active sync connection; if a
-- distinct live/sync state is wanted, ALTER TYPE pms_connection_status ADD
-- VALUE 'syncing' rather than introducing 'active'.
```
Note `provider` and `status` are **Postgres enums** (`pms_provider`,
`pms_connection_status`), not free text — the earlier draft's `TEXT ... DEFAULT
'active'` would not apply.

**Migration safety — legacy rows are markers, not connections (finding 3).**
The existing setup route writes `status = 'connected'|'skipped'` rows per **org**
with `imported_data` but **no credentials** — these are *onboarding markers*,
not sync-active integrations. The backfill must not silently promote them into
real per-location connections, or a multi-location org could inherit a
misleading integration on a location that never connected one. Make the
invariant explicit:
- **A connection is sync-active iff `credentials_encrypted IS NOT NULL`.** All
  sync, "Sync now", and write-back paths gate on that, never on `status` alone.
- Backfill: for each legacy row, attach `location_id` = the org's
  primary/first location and **leave `credentials_encrypted` NULL**. The row
  keeps recording "this org saw the PMS step" but does nothing until a location
  actually connects with credentials.
- Only enforce `UNIQUE(location_id)` *after* backfill assigns a location to
  every legacy row; if an org has multiple legacy rows (it shouldn't, given the
  old `UNIQUE(org_id)`), dedupe to the primary location first.

**Knock-on effects of per-location scoping:**
- The current setup route (`src/app/api/setup/pms/route.ts`) upserts on
  `pms_connections.orgId` — it must change to upsert per location.
- `default_business_external_id` becomes near-redundant: a per-location
  connection usually maps to exactly one Cliniko business, so the
  business→location mapping (§7b) is 1:1 per connection rather than a fan-out.
- Cursors (§8.B), the run-sheet location scoping (already location-scoped in
  Coviu), and the "Sync now" button all align naturally — sync is per location.

**B. Incremental cursors — new table, connection-scoped (finding 4).** Keyed on
`connection_id` (not `location_id`/`org_id`) so replacing a connection — e.g.
re-credentialing or switching the Cliniko account at a location — starts its
cursors clean rather than inheriting a stale watermark.
```sql
CREATE TABLE pms_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,                 -- 'appointments' | 'patients' | ...
  cursor_updated_at TIMESTAMPTZ,
  UNIQUE(connection_id, resource)
);
```

**C. External IDs — connection-scoped link tables, not bare columns (finding
1).** A bare `pms_external_id` column is only safe where the entity is 1:1 with
a connection. That holds for **`locations`** (one connection per location) — so
a column there is fine — but **NOT for `patients`**, which are **org-scoped**:
the same patient can appear under multiple locations' integrations, each with a
different external id, so a single column would collide. Cliniko ids are also
**account-scoped** (two Cliniko accounts can reuse the same numeric id), so
uniqueness must include the connection. Therefore:
```sql
-- locations: 1:1 with a connection, column is safe
ALTER TABLE locations ADD COLUMN pms_external_id TEXT;   -- the PMS business id

-- patients: org-scoped, may link under several connections → link table
CREATE TABLE pms_patient_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  pms_external_id TEXT NOT NULL,
  UNIQUE(connection_id, pms_external_id),   -- account-scoped id is unique within a connection
  UNIQUE(connection_id, patient_id)         -- one link per patient per connection
);
```
(`appointments` and `appointment_types` already carry `pms_external_id` — but
their **upsert keys** must become connection-scoped; see §8.H. **Do NOT add
`pms_external_id` to `users`** — practitioner identity is scoped, see D.)

**D. Practitioner mapping — connection-scoped link table (findings 1, decision).**
`users` is global-by-email and Cliniko practitioner ids are account-scoped, so
the link is keyed on the **connection** (not `provider` alone, which would
collide across two accounts on the same PMS) and on the scoped
`staff_assignment`:
```sql
CREATE TABLE pms_practitioner_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  staff_assignment_id UUID NOT NULL REFERENCES staff_assignments(id) ON DELETE CASCADE,
  pms_external_id TEXT NOT NULL,
  UNIQUE(connection_id, pms_external_id),
  UNIQUE(connection_id, staff_assignment_id)
);
```

**E. Appointment-type modality + room + confirm state — on the link table, not
the org-scoped type (findings 1 & 6).** Two problems with putting this on
`appointment_types`: (a) `appointment_types.modality` defaults to `telehealth`,
so an unconfirmed import would silently become telehealth and start spawning
sessions; (b) the type is **org-scoped** while rooms are **location-scoped**, so
two locations sharing one Coviu type cannot each store a different target room
on it. Both are solved by putting `confirmed_modality` (NULL until confirmed),
`room_id`, and `sync_enabled` on the **connection-scoped
`pms_appointment_type_links`** (§8.H) — per connection/location, never on the
shared type. Sync treats a type as telehealth-and-syncing **only** when its link
row has `confirmed_modality = 'telehealth'` AND `sync_enabled = true` AND a
target `room_id`; otherwise it creates no sessions. A `type_workflow_links` row
must also exist for the type so `add_to_runsheet` can fire (see §5).

**F. Form-field bindings — in `forms.schema`, plus a provider tag (decision).**
Bindings are stored as the `pmsTarget` custom property on each question inside
`forms.schema` — NOT in `form_fields`, NOT a separate mapping table (§6, Option
A committed). The only schema change is a **provider tag on the form**, so a
PMS-bound form can be scoped to its provider's locations (§6, "Forms are
PMS-scoped"):
```sql
ALTER TABLE forms ADD COLUMN pms_provider pms_provider;  -- NULL = generic, not PMS-bound
```
No column for the per-question binding itself — that lives in the SurveyJS JSON.

**G. Write-back idempotency + per-field receipts (decision: coarse columns +
per-field table).** `form_submissions` today is `{ id, form_id, patient_id,
appointment_id, responses, submission_source, review_status, reviewed_at,
reviewed_by, created_at }` — **no PMS columns**. The §6.1 UX (per-field
written/skipped/failed, inline edit pre-filled with the *attempted value*,
actionable failure messages, retry that survives a reload) **cannot** be
represented by a single status column — it is inherently per-field. So:

```sql
-- Coarse roll-up on the submission (cheap "did this push land?" check):
ALTER TABLE form_submissions
  ADD COLUMN pms_external_id TEXT,       -- returned patient_form id (idempotency key)
  ADD COLUMN pms_push_status TEXT,       -- pending | partial | sent | failed
  ADD COLUMN pms_pushed_at TIMESTAMPTZ;

-- Per-field detail that backs the §6.1 feedback list + inline edit/retry:
CREATE TABLE pms_push_field_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  provider pms_provider NOT NULL,
  survey_question_name TEXT NOT NULL,    -- SurveyJS question `name`
  pms_target_key TEXT NOT NULL,          -- catalogue key, e.g. 'cliniko:patient.date_of_birth'
  status TEXT NOT NULL,                  -- written | skipped_existing | unmapped | failed
  attempted_value TEXT,                  -- pre-fills the inline edit box on a failed row
  failure_kind TEXT,                     -- validation | transport | auth | mapping (on failure)
  detail TEXT,                           -- specific, actionable message
  attempts INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(submission_id, survey_question_name)
);
```
The coarse `pms_push_status` is derived from the field rows
(`failed` present → `partial`/`failed`; all `written`/`skipped`/`unmapped` →
`sent`). A retry/inline-edit updates the one field row (and bumps `attempts`),
then re-derives the roll-up. **Required before relying on retries** (finding 4).

**Idempotency mechanics (finding 5 — verified).** Cliniko's
[`PATCH /patient_forms/{id}`](https://docs.api.cliniko.com/openapi/patient-form)
**can update the form's `content`** (sections/questions/answers), so a re-send
**reuses the stored `form_submissions.pms_external_id`** and PATCHes the existing
form rather than POSTing a duplicate. Patient-field retries likewise PATCH only
still-blank fields (fill-blanks-only). **Caveat to honour:** Cliniko accepts
answers only for **text / paragraph / date** question types (empty values
invalid; paragraph answers are sanitised HTML). For answer types Cliniko can't
carry (e.g. checkbox/choice as a form answer), prefer mapping them to a
**patient field** instead, or coerce to text; if neither fits, mark that field
`unmapped` rather than pretending it round-trips. Confirm the exact accepted
type list against a live account when building the catalogue.

**H. Upsert keys must be connection-scoped (finding 2).** The earlier
`(org_id, pms_external_id)` upsert key is unsafe under location-scoped
integrations: two Cliniko accounts in the same org can reuse the same numeric
id and collide. Resolve per entity:
- **`appointments`** already has `location_id` → upsert on
  `(location_id, pms_external_id)` (connection↔location is 1:1). **Back this with
  a partial unique index** so concurrent sync runs can't duplicate (finding 3):
  ```sql
  CREATE UNIQUE INDEX appointments_location_pms_external_id_uq
    ON appointments (location_id, pms_external_id)
    WHERE pms_external_id IS NOT NULL;  -- partial: non-PMS appointments are exempt
  ```
  The upsert then uses `ON CONFLICT (location_id, pms_external_id) ...`.
- **`appointment_types`** stays **org-scoped** (so org-shared types remain
  shared across locations); the Cliniko mapping **and the per-connection
  resolution config** move to a **connection-scoped link table** (decision),
  keeping the base table untouched:
```sql
CREATE TABLE pms_appointment_type_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  appointment_type_id UUID NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
  pms_external_id TEXT NOT NULL,
  -- Per-connection resolution config (CANNOT live on the org-scoped type — two
  -- locations sharing one Coviu type need different rooms / confirm state; §8.E):
  confirmed_modality appointment_modality,         -- NULL until confirmed (telehealth/in_person)
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,  -- target room (location-scoped)
  sync_enabled BOOLEAN NOT NULL DEFAULT false,     -- only confirmed+enabled types create sessions
  UNIQUE(connection_id, pms_external_id),          -- account-scoped id, unique per connection
  UNIQUE(connection_id, appointment_type_id)
);
```
  Sync upserts the link on `(connection_id, pms_external_id)`. **This table is
  the single source of truth for PMS-import state** (finding 5): for
  PMS-imported types, `confirmed_modality` / `room_id` / `sync_enabled` here are
  authoritative, **not** `appointment_types.modality` or
  `appointment_types.pms_external_id`. New PMS sync **stops writing
  `appointment_types.pms_external_id`** (drop it later); do not maintain two
  sources of truth. A `type_workflow_links` row must still exist for the type so
  the scheduled `add_to_runsheet` action can fire (see §5).

**I. Form scoping under divergent catalogues (finding 4).** `forms.pms_provider`
(§8.F) is sufficient *today* because the Cliniko catalogue is static and
identical across accounts. **But if custom fields enter the catalogue**, two
Cliniko accounts in one org could expose different `custom_field_token`s, so a
provider tag alone wouldn't guarantee a form is compatible with a given
*account*. Forward note: when custom fields land, **scope PMS-bound forms (or
their bindings) to `connection_id`, not just `provider`.** Left as provider-tag
for v1 with this explicit upgrade path.

## 9. Out of scope / open items

- **Tasks write-back:** Cliniko has no Tasks resource. Keep Coviu tasks
  Coviu-only; no Cliniko work in v1.
- **Arrival / payment write-back:** possible later via `PATCH
  /individual_appointments`, but Cliniko has no session-lifecycle model. Defer.
- **Cliniko `patient_form_templates` introspection:** explicitly NOT done — and
  not needed. `patient_form_template_id` is optional on `POST /patient_forms`,
  so we post self-contained forms (own content + answers) and update patient
  fields directly via `PATCH /patients`. We use the static catalogue, not the
  clinic's Cliniko templates.

## 10. Authentication (per provider)

Auth is a per-provider concern owned by the adapter (§4), not a fixed
platform-wide choice. **Cliniko uses HTTP Basic with an API key**
(`base64(api_key + ":")`), with the shard derived from the key — no OAuth.
An earlier sketch in `docs/claude-project/feature-pms-integration.md` guessed
OAuth before the API docs were reviewed; that was a placeholder, not a real
constraint. The API-key approach is correct for Cliniko and the
`credentials_encrypted` blob accommodates either model for future providers.
Update the feature doc's OAuth line when this ships.

## 11. Build order

1. **Normalization layer scaffolding** — `types.ts`, `adapter.ts`
   (`PmsAdapter` incl. `verify`, `fieldCatalogue`, `validateField`,
   `webLinkForPatient`), `PmsCapabilities`, `PmsFieldCatalogueEntry`, provider
   registry. The reusable spine; everything else depends on it.
2. **Cliniko adapter** — client (auth, shard, pagination, 429 backoff) +
   read mapping + provider-namespaced field catalogue + field validation. First
   concrete provider behind the interface.
3. **Schema migration (§8)** — ALTER `pms_connections` (location-scope, creds,
   sync timestamps) **with the legacy-marker-safe backfill** (§8.A: leave
   `credentials_encrypted` NULL; sync-active iff creds present); new
   `pms_sync_cursors` (connection-scoped); `locations.pms_external_id`;
   **connection-scoped link tables `pms_patient_links`, `pms_practitioner_links`,
   `pms_appointment_type_links`** (NOT bare columns; §8.C/D/H); appointments
   upsert on `(location_id, pms_external_id)` (§8.H); type→room + workflow-link
   mapping;
   unmapped-modality safety; `forms.pms_provider` tag; `form_submissions` push
   roll-up columns + `pms_push_field_results`. All deltas against the live schema.
4. **Pull sync** — dependency pull + appointment upsert **+ call
   `scheduleWorkflowForAppointment` so sessions reach the run sheet** +
   reschedule/cancel handling + cron + "Sync now".
5. **Settings → Integrations (§7b)** — provider-agnostic connection management
   + all mapping surfaces (types→room+workflow, practitioners→pms_practitioner_links,
   businesses→locations, field catalogue). Built against `PmsAdapter`, no
   provider branches.
6. **Form builder mapping (§6)** — register the `pmsTarget` SurveyJS custom
   property (dropdown choices from `fieldCatalogue()`, grouped, + "don't send";
   unique-per-form validation). Generic over the active adapter.
7. **Onboarding pass (§7a) + seeded Registration form** — first-run connect +
   guided mapping with auto-match defaults; generate the PMS-scoped "Patient
   Registration" form from the catalogue. Reuses the Settings mapping components.
8. **Push sync (§6.1)** — explicit write-back wired into the Process flow's Done
   step: "Complete & send to {PMS}" runs patient-field `PATCH` (fill-blanks-only)
   + self-contained `patient_form` POST/PATCH, returns per-field results, renders
   the visual feedback list (inline edit + actionable failure messages + "Open in
   {PMS}"), then marks the session done. Idempotency/retry via the §8.G push
   columns + `pms_push_field_results`. **Regression check (finding 6): a
   no-PMS / Core location's Done step must still auto-complete and auto-close
   exactly as today** — the "Complete & send" path is gated strictly on a
   sync-active connection (`credentials_encrypted` present + `capabilities`).
9. **Deep linking (§6.2)** — `webLinkForPatient` on the adapter; "Open in {PMS}"
   button in the patient slideout's Quick actions row + on failed-field rows.
   Verify the Cliniko patient web-URL format against a live account.
10. **Tasks:** confirm Coviu-only (no PMS work).

## 12. Operational guardrails

- The Cliniko API key is a credential: env/encrypted storage only, never pasted
  into chat or logged.
- Get **manual sign-off before the first write** (`POST /patient_forms` /
  `PATCH /patients`) hits a real Cliniko account.
