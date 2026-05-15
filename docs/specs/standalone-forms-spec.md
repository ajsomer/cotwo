# COVIU

Feature Spec

# Standalone Forms

Forms as first-class objects, decoupled from appointments

May 2026

**CONFIDENTIAL**

---

## Overview

| | |
|---|---|
| **Surface** | Patient-facing form runtime (new), Forms builder (extended), Readiness Dashboard (extended) |
| **Users** | Patients (form fillers), Practice Managers (form authors), Receptionists (submission reviewers) |
| **Available to** | Complete tier only. Forms are already a Complete-only feature. |
| **Real-time** | Adds a new org-scoped Socket.io room (`org:{org_id}`) for org-wide events that don't belong to a single location. Standalone submissions emit `submission_changed` on this room. The existing `location:{id}` room is unchanged. |
| **Priority** | Foundational. Unblocks pre-booking intake, referral capture, and ad-hoc data collection. |

Today, forms are filled in exactly one way: as outstanding items inside the patient entry flow, anchored to an appointment. The clinic always knows who the patient is before the form is rendered — identity is captured by the entry flow before the form ever appears.

This spec introduces a second consumption path. A form can be its own destination. A patient can land on a form URL with no appointment in sight, verify their phone number via OTP, confirm or create their identity, and submit the form. The submission then surfaces on the Readiness Dashboard as a pre-appointment item the clinic needs to triage.

The change is purely additive. Forms inside the entry flow keep working exactly as they do today.

---

## Why This Exists

Forms today only fire as part of a workflow attached to a known patient with a known appointment. That covers the post-booking case (intake before your appointment) but leaves three important cases on the floor:

1. **Pre-booking intake / referral.** A prospect or referred patient needs to fill out an intake form *before* there is an appointment to attach it to. The clinic might want this submission to inform whether they accept the patient, what clinician to route them to, or what appointment type to book.
2. **Ad-hoc collection from existing patients.** Annual update, consent renewal, follow-up survey — situations where the clinic wants a form filled in outside any specific appointment cycle.
3. **Public-facing intake.** A form embedded in a clinic's marketing site, on a printed QR code in reception, or shared in a Google Business listing — channels where the recipient is unknown until they submit.

The driving use case for v1 is **pre-booking intake / referral**. The other cases come for free once standalone forms exist.

---

## Core Concepts

### A form is now a standalone object

Today a form is a definition that lives inside other things (a workflow action, an entry-flow step). It has no independent existence as a destination.

Standalone forms invert that. A published form has a permanent shareable URL. The form itself owns the identity-capture step. Submissions stand on their own — they don't require an appointment, a session, or a workflow to exist.

### Identity is a field type, not an entry-flow gate

In the entry flow, identity is captured *before* the form is rendered (phone OTP → identity confirmation → form). Standalone forms can't rely on that — there is no entry flow.

So identity moves *into* the form itself, as a special field type the form builder can drop into any form. The identity field:

- Always captures **first name, last name, date of birth, email, phone number**.
- Is rendered as a single block in the patient view, not five separate questions.
- Behaves as a single field in the schema (`type: "identity"`).
- Pre-fills from the OTP-verified phone match when the patient exists in the clinic.
- Is the gate for resolving / creating the `patients` row at submission time.

A form may have zero or one identity field. The builder enforces "at most one" and surfaces a warning when a form intended for standalone use has none. **Placement of the identity field in the schema does not control capture order.** Identity is always captured first by the runtime; the field's schema position only controls where its read-only summary appears in the form body. The builder UX makes this explicit: when the PM drops in an identity field, the toolbox label and the inline field render both note "captured first — placement controls summary only."

### Standalone Eligibility

Two distinct states. Both matter, and the spec uses both terms throughout:

- **Schema-eligible** — the form's schema contains **exactly one** identity question. This is a property of the schema regardless of publish state.
- **Shareable** — schema-eligible **AND** `status = 'published'`. Only shareable forms can actually be filled in via `/f/{token}`.

**Schema traversal rule** (server-side, for both eligibility checks): the identity-field count is computed by walking the SurveyJS schema recursively — top-level `elements`, plus `elements` of any `page`, `panel`, or other container node. Any node with `type: "identity"` anywhere in the tree counts. Hidden / conditional / `visibleIf` settings are **ignored** for the count: a form with a conditionally-hidden identity field still counts as having one. The exact-one check is on the recursive count. (The builder's "at most one" enforcement uses the same walker so the UI and server agree.)

**Server-side enforcement points:**

- `GET /api/forms/standalone/[public_token]` — returns 404 if the form isn't shareable. Two sub-cases:
  - Form doesn't exist, or token doesn't match → flat 404 with no body.
  - Form exists but isn't shareable → 404 with a typed body `{ available: false, reason: "draft" | "archived" | "unavailable" }`.
    - `draft` and `archived` are exposed as-is because the patient-facing screen would say the same thing anyway (e.g. "isn't ready yet" / "no longer in use") and there's no value in obscuring it.
    - The `not schema-eligible` case (zero identity fields, more than one identity field, or other broken internal state) is collapsed to the neutral `unavailable` reason in the API response. The granular detail (e.g. `schema_invalid`) is logged server-side for clinic / engineering visibility but never reaches the public API. This avoids exposing "this form is misconfigured internally" to anyone with the token; from the outside, it looks the same as a generic "not available" state.
- `POST /api/forms/standalone/[public_token]/submit` — re-enforces shareability. Flat 404 in all unavailable cases (no typed reason — the only consumer is the submit handler, which trusts the page already gated on the GET).

**Existence-leak trade-off (accepted).** The two-body shape (flat vs typed) means an observer with a candidate token can distinguish "token is invalid" from "token is valid but form is currently unavailable." This is a real information leak, not a hidden one. We accept it for v1 because:

- `public_token` is a `gen_random_uuid()::text` value — 122 bits of entropy, infeasible to enumerate. The leak only matters for someone who *already* has the token. If they have it, they could also just try filling out the form to see what happens.
- The unavailable screen surfaces clinic branding (name, logo) and the typed reason. That is also a leak for someone who already has the token — they learn which clinic owns the form and whether it's draft / archived (or simply "unavailable" — internal misconfiguration is hidden behind a neutral reason). Same security envelope.
- The product win (a leaked or stale link doesn't dead-end with a bare 404; the patient knows whose form it was and that it isn't ready) is judged worth the leak.

If we ever want to close this, the fix is to return flat 404 with no body in the unavailable case and render a generic "This link isn't valid" screen regardless. Flagged as a future consideration; not v1.

**`/f/{token}` page behaviour:**
- Page fetches the GET endpoint. On a typed-404 (`available: false`), the page renders an "unavailable" screen using the clinic branding included in the typed-404 body.
- On flat 404 (invalid token), the page renders a generic "This link isn't valid" screen with no clinic branding.
- The GET endpoint includes the form's org branding (`name`, `logo_url`) in **both** the success body and the typed-404 body so the page can show "This [Clinic Name] form isn't available right now" without a second API call.

The Share tab and builder warnings are convenience signals for authors; they are **not** the security boundary. Forms without an identity field remain valid for entry-flow / workflow use (where the entry flow owns identity capture) — they just can't be filled standalone.

### Standalone submissions are pre-appointment

Standalone submissions are not tied to an appointment. They are also not tied to a session. They are tied to a **patient** (the one resolved or created at submission time) and a **form**.

Conceptually, a standalone submission is still a **pre-appointment** item: someone is reaching out *before* they have an appointment booked, asking for one (in the pre-booking intake case) or providing information that informs an eventual booking. So they surface on the Readiness Dashboard — the existing pre-appointment workspace — alongside appointment-bound readiness items, in their own section.

We do **not** auto-attach standalone submissions to any existing appointment, even if the resolved patient happens to have one. v1 leaves that as a manual decision; we'll revisit if it becomes friction.

---

## Data Model Changes

The existing schema already has what we need for most of this. The deltas:

### `forms` table

Add:
- `public_token TEXT UNIQUE` — generated on form creation, populated for every row. Drives the public `/f/{token}` URL. Single token shared across all three entry points (public link, SMS/email send, QR code). We are not tracking per-recipient send context in v1.

The existing `forms.status` column (`draft` / `published` / `archived`) already gates whether the public URL is live. A form's public URL only resolves to a fillable form when `status = 'published'`. Draft and archived forms return a 404-style "not available" screen on the public URL.

The existing `forms.schema` JSONB stores the SurveyJS schema, including any identity field.

### `form_submissions` table

Add:
- `submission_source TEXT NOT NULL DEFAULT 'entry_flow'` — one of `entry_flow`, `standalone_public`, `standalone_sms`, `standalone_qr`. Tracks the entry point that produced the submission. `entry_flow` is the existing path; the three `standalone_*` values are the new paths. Constrained via CHECK.
- `review_status TEXT NULL` — one of `pending`, `reviewed`, `archived`. **Nullable**, set only for standalone submissions. Entry-flow submissions leave this `NULL` to avoid misleading "pending review" data on rows that are already surfaced via their appointment. New standalone submissions are inserted with `review_status = 'pending'`.
- `reviewed_at TIMESTAMPTZ NULL`
- `reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`

Two CHECK constraints to keep the two halves of the table coherent:

1. **`form_submissions_source_review_consistency`** — couples `review_status` to `submission_source`:
   `(submission_source = 'entry_flow' AND review_status IS NULL) OR (submission_source != 'entry_flow' AND review_status IN ('pending', 'reviewed', 'archived'))`
2. **`form_submissions_standalone_no_appointment`** — enforces that standalone submissions never attach to an appointment:
   `submission_source = 'entry_flow' OR appointment_id IS NULL`

The existing `form_submissions.appointment_id` column stays nullable. For standalone submissions it is always `NULL` (enforced by the second CHECK, not just by convention). For entry-flow submissions it remains set as it is today. This way, a future write path that accidentally tries to attach a standalone submission to an appointment is rejected at the database — not just at the application layer.

### `patients` table

No schema changes. Patients created from a standalone form submission are written using the same columns the entry flow writes today (`first_name`, `last_name`, `date_of_birth`, with `email` and the phone joined via the existing `patient_phone_numbers` table).

Patient creation on standalone submit follows the same multi-contact resolution rules as the entry flow:
- If the OTP-verified phone matches zero patients → new patient, written with the identity field values.
- If it matches exactly one patient → the form pre-fills with that patient's identity; on submit, the existing patient is reused.
- If it matches more than one → the patient picks from a list (or "Someone else") *before* the form fields are shown. Submission attaches to the picked / new patient.

### `form_assignments` table

No schema changes. `form_assignments` keeps its existing role: per-patient form sends with bound patient state, a per-recipient token, and `pending` → `sent` → `opened` → `completed` lifecycle. Standalone forms do **not** create `form_assignments` rows.

The two SMS paths are distinct:

| | `form_assignments` SMS (existing) | Standalone share-link SMS (new in this spec) |
|---|---|---|
| Token | Per-recipient, single-use | Form-level `public_token`, reused |
| Patient binding | Bound to a `patient_id` at send time | None — recipient identifies via OTP on arrival |
| Lifecycle row | Yes (`form_assignments`) | No |
| OTP on arrival | Skipped (phone is pre-bound) | Mandatory |
| Use case | "Send Jane this intake form for her appointment on Friday" | "Share this referral form with anyone who asks" |

The v1 "Send via SMS" action in the new Share tab is the **share-link** path. See the Share tab section below for the rename and exact behaviour.

### Migration

Create migration `020_standalone_forms.sql`:

1. Confirm `pgcrypto` (for `gen_random_uuid()`) is available. It is enabled by earlier migrations in this repo; the migration should not re-create it but should fail loudly if absent.
2. `ALTER TABLE forms ADD COLUMN public_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text`. The `DEFAULT` covers existing-row backfill **and** all future inserts so application code does not need to set it explicitly.
3. `ALTER TABLE form_submissions ADD COLUMN submission_source TEXT NOT NULL DEFAULT 'entry_flow' CHECK (submission_source IN ('entry_flow', 'standalone_public', 'standalone_sms', 'standalone_qr'))`.
4. `ALTER TABLE form_submissions ADD COLUMN review_status TEXT` (nullable).
5. `ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_source_review_consistency CHECK ((submission_source = 'entry_flow' AND review_status IS NULL) OR (submission_source != 'entry_flow' AND review_status IN ('pending', 'reviewed', 'archived')))`.
6. `ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_standalone_no_appointment CHECK (submission_source = 'entry_flow' OR appointment_id IS NULL)`. This is the database-level invariant that standalone submissions never attach to an appointment.
7. `ALTER TABLE form_submissions ADD COLUMN reviewed_at TIMESTAMPTZ`.
8. `ALTER TABLE form_submissions ADD COLUMN reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL`.
9. `ALTER TABLE forms ADD COLUMN public_token_rotated_at TIMESTAMPTZ` (nullable; populated only on regeneration, not on initial token creation).
10. `ALTER TABLE forms ADD COLUMN public_token_rotated_by UUID REFERENCES users(id) ON DELETE SET NULL` (same).
11. Indexes:
   - **No separate `idx_forms_public_token`** — the `UNIQUE` constraint on `forms.public_token` already creates one.
   - **`idx_form_submissions_readiness_pending`** — a partial index sized to the inbox query: `CREATE INDEX idx_form_submissions_readiness_pending ON form_submissions(created_at DESC, form_id) WHERE submission_source != 'entry_flow' AND review_status = 'pending'`. Pending is the hot path (the inbox surface). The index narrows reads to standalone-pending rows and orders them newest-first; the `form_id` join to `forms` then filters by org. We do **not** index `reviewed` rows — those are loaded only when staff explicitly view the "already reviewed" filter, where a sequential scan over a smaller partial range is fine.
   - **Scaling caveat (not a v1 blocker).** Without `org_id` on `form_submissions`, the query plan still has to walk pending rows across all orgs before the join filters them — fine while standalone-pending counts are small, less fine if a single Postgres instance ends up hosting many orgs with high standalone volume. If that becomes the shape of the load, we'd denormalize `org_id` onto `form_submissions` (or rewrite the query to first select org-scoped `form_id`s and then filter) and add a composite partial index `(org_id, created_at DESC)`. Flag for revisit; don't pre-optimize for it now.
   - If `reviewed_at` becomes a sort key for any future surface, add an index then. Don't pre-index for it now.
12. RLS: standalone form-fill reads go through the service-role client (same pattern as the existing patient-entry routes), so no new RLS policies for the patient-facing surface. Staff reads of standalone submissions reuse the existing org-scoped `form_submissions` policies. The review actions (`mark reviewed`, `archive`) go through the service-role client too, with org membership verified in the route from the authenticated user.

---

## Patient-Facing Runtime

### Entry points and URLs

All three entry points resolve to the **same** URL:

```
/f/{public_token}
```

- **Public link.** PM copies the URL from the form builder's Share tab and pastes it anywhere — website, email, social, business listing.
- **Clinic-sent share link (SMS / email).** Clinic-initiated send of the same `/f/{public_token}` URL to a recipient phone number or email. The link is **unbound** — no patient is attached to the send, no `form_assignments` row is created, the recipient still verifies via OTP on arrival exactly like any other standalone visitor. The only thing distinguishing this from copying the public URL into an SMS by hand is that the clinic uses the in-product action so the send goes through the SMS provider, and the URL carries `?src=sms` for attribution. The submission ends up with `submission_source = 'standalone_sms'`.
- **QR code.** PM downloads a QR code PNG from the Share tab. The QR encodes `/f/{public_token}?src=qr`. The `src=qr` query param sets `submission_source = 'standalone_qr'` on the resulting submission. (Similarly, `?src=sms` for SMS sends.) Public link with no `src` param → `standalone_public`.

This is the lightest tracking layer that lets the inbox tell staff how the submission arrived. It is not a substitute for per-recipient tracking; that's a later concern.

### Layout

Standalone forms use the existing `(patient)` route group layout — the same 420px mobile-first container, the same persistent header (clinic logo, clinic name, dynamic stepper). Standalone forms do **not** show a room name in the header (there is no room).

### Flow

The patient moves through these screens in order. Identity-capture is gated *first*, before any custom form fields are rendered. Reuse the entry-flow's existing identity components where possible.

0. **Unavailable** (only rendered when the GET returns typed-404 — form not shareable). Clinic branding (logo, name) plus a patient-facing message tied to the typed reason:
   - `reason: "draft"` → "This form isn't ready yet. Please check back later or contact [Clinic Name]."
   - `reason: "archived"` → "This form is no longer in use. Please contact [Clinic Name] if you need to fill out an alternative."
   - `reason: "unavailable"` → "This form isn't available. Please contact [Clinic Name]." Patient-facing copy is deliberately generic, and the API reason itself is neutral too — internal misconfiguration detail is logged server-side rather than returned in the response.

   No "Get started" button. Patient closes the tab. This screen exists so a leaked or stale link doesn't dead-end with a bare 404.

1. **Primer.** Clinic logo, clinic name, form title (from `forms.name`), short description (from `forms.description`), "Get started" button. Not a numbered step. Only rendered when the form is shareable.

2. **Phone OTP.** Phone input → SMS code verification. Identical to the entry flow's OTP step. Once verified, we have a phone number in E.164 plus a verified flag in the session.

3. **Identity confirmation.** Branches on phone-to-patient match count, same as the entry flow:
   - Zero matches → render the identity capture form (first name, last name, DOB, email — phone is pre-filled and locked). On submit, this resolves to a *pending* patient in client state (not yet written to DB).
   - One match → "Is this you?" with the matched patient's name, DOB, and email shown. **Confirm-only — the patient cannot edit these fields here.** Confirming proceeds; "Someone else" goes to the capture form for a new patient. This keeps the existing-patient path aligned with the Identity write rules (which forbid mutating the patient record from a standalone submission). If the patient wants to correct their details, they take the "Someone else" branch and a new patient is created for staff to reconcile.
   - Multiple matches → list of matching patients with a "Someone else" option. Pick proceeds (also confirm-only — no edit on a picked match); "Someone else" goes to the capture form.

   The identity step is rendered regardless of whether the form's schema contains an identity field. The identity field in the schema is a *placeholder* that tells the runtime "show identity here in the flow" — when the runtime hits that field, it's already been captured at step 3 and is displayed read-only as a confirmation block. (See Identity Field Type below.)

4. **Custom form fields.** Render the rest of the SurveyJS schema. Any non-identity fields the PM added in the builder. Skips automatically if the form has no non-identity fields (rare but possible).

5. **Confirmation.** Generic "Thanks, we've received your submission" screen. No CTA, no clinic-configurable thank-you message in v1. Patient closes the tab.

The dynamic stepper shows steps 2–4 as numbered, with the primer and confirmation outside the count.

**Source attribution persistence.** The `src` query param can be lost across the multi-step client flow (back/forward navigation, refresh, multi-tab). To prevent that:

- On first load of `/f/{token}`, the page reads the raw `src` from `window.location.search`, runs it through the same sanitizer the server uses (`sms`/`qr` → mapped; else `standalone_public`), and stores the sanitized value in `sessionStorage` keyed by token.
- All subsequent navigations within the flow read from `sessionStorage`, not the URL.
- The submit POST sends the **sanitized** value as a body field (`source`), not as a query param. The server re-runs the sanitizer on the received value (defense in depth: client storage is patient-controlled).
- If `sessionStorage` is unavailable (privacy mode, etc.), submit falls back to whatever the URL currently has, sanitized server-side. Worst case attribution is `standalone_public`, never invalid.

### Identity field type

In the SurveyJS schema, the identity field is represented as a single custom question type:

```json
{
  "type": "identity",
  "name": "patient_identity",
  "isRequired": true
}
```

There are no per-field configuration options in v1 — the identity field always captures the same five values, all required. The form builder offers it as a single draggable item in the toolbox labelled "Patient identity". A form may contain at most one identity field; the builder enforces this (and warns if a PM publishes a form intended for standalone use that lacks one).

At render time, the standalone runtime treats the identity field as a no-op placeholder *inside the form body* — identity is captured at step 3 before form fields render. If the patient is on step 4 and scrolls past where the identity field sits in the schema, they see a read-only summary card ("You're filling this out as Jane Citizen, born 1 Jan 1990 — change") rather than empty input fields. The "change" link returns to step 3.

When the same form is used inside the **entry flow** (not standalone), the entry flow has already captured identity via its own pre-form steps. The entry-flow renderer also treats the identity field as a read-only summary in the same way. No double-capture.

### Submission

On submit (final form action):

1. POST `/api/forms/standalone/[public_token]/submit` with the SurveyJS response payload, the OTP-verified phone token, the patient selection (one of: `{ kind: "existing", patient_id }`, `{ kind: "someone_else", identity }`, or `{ kind: "new", identity }`), and the sanitized `source` body field.
2. Service-role server route:
   - Verifies the form is **shareable** (schema-eligible AND `status = 'published'` — see Standalone Eligibility for the term definitions).
   - Verifies the OTP token and extracts the verified phone (E.164).
   - **Verifies the patient selection against the OTP phone-match set** (critical — see "Patient selection authorization" below).
   - Resolves the patient (see Identity write rules below).
   - Inserts a `form_submissions` row with `patient_id` set, `appointment_id = NULL`, `submission_source` set from the `source` body field after server-side re-sanitization (see Source attribution below), `review_status = 'pending'`.
   - Returns `{ ok: true }`.
3. Client navigates to the confirmation screen.

**Patient selection authorization** (hard rule — defends against a tampered client submitting an arbitrary patient id):

After verifying the OTP token, the server independently re-resolves the **OTP-match set** by querying `patient_phone_numbers` for the verified phone, joined to `patients` for org scope. It does **not** trust any match set sent by the client. Then it validates the patient selection:

- `kind: "existing"` — `patient_id` MUST be a member of the server-resolved match set. If not, reject 403. This is what prevents "client tells server to attach this submission to a totally unrelated patient."
- `kind: "someone_else"` — **only valid when the match set is non-empty** (this is the household / shared-phone case where the patient is acknowledging that other patients exist on this phone but they are someone different). If the server resolves an empty match set, reject 400 ("no matching patients on this phone; use `new` instead"). The identity payload must contain all five required fields; phone is forced to the OTP-verified value, not whatever the client claims.
- `kind: "new"` — only valid when the match set is empty. If the server resolves any matches, reject 409 ("phone is already linked to one or more patients; use `existing` or `someone_else`"). This prevents the client from silently creating a duplicate patient when a confirmation step exists.

The `new` vs `someone_else` distinction is meaningful: both create a new patient row, but `someone_else` records that the patient was *consciously* added on a phone that already has other patients (so the duplicate-suspected check applies and the inbox surfaces the relationship to staff), while `new` is the unambiguous zero-match case (no duplicate check needed). Keeping them as distinct kinds — rather than normalizing on the server — means the client's intent is preserved and the server can validate it. A confused or tampered client sending the wrong kind gets a clear error rather than silently being normalized.

The OTP token itself binds verified-phone → server session, and the phone-match set is server-resolved on every submit. The client's role is to surface choices; the server is the only authority on which patient ids the request is allowed to touch.

**Identity write rules** (hard, not negotiable):

- **New patient via zero phone matches:** Create a `patients` row from the identity payload (first/last name, DOB, email). Insert the OTP-verified phone into `patient_phone_numbers`. Link the submission to this new patient.
- **Existing patient (one match confirmed, or one selected from multi-match list):** **Do not mutate the patient record.** The existing values for first name, last name, DOB, and email are authoritative. The submission stores the patient-entered values inside its `responses` payload as an audit snapshot, but they do not overwrite the patient row. If staff spot a discrepancy in the inbox, reconciliation is a manual decision they make against the patient record.
- **"Someone else" against a phone that matches existing patient(s)** — the duplicate-risk case. The phone is shared (parent / child / household), so a new patient must be created and attached to the same phone in `patient_phone_numbers` (the table already supports many-patients-to-one-phone — that's how multi-contact resolution works in the entry flow). Two safeguards:
  1. **Soft duplicate check** before creation: server compares the submitted (first_name, last_name, DOB) against every existing patient already attached to this phone, case-insensitive and DOB-exact. If a match is found, the submission still proceeds and creates the new row, **but** the submission is flagged via a server-owned metadata key on the response payload.

     **Namespace ownership.** The SurveyJS response payload is patient-controlled (a tampered client could put anything in it, including a key called `_meta`). So the server does not write metadata into `responses` directly. Instead, the submit route writes to a dedicated `responses.__server_meta` key that it always **overwrites** (or strips and re-writes) before persistence — anything the client put under that key is discarded. The naming `__server_meta` with double-underscore prefix is intentional: it's a clear "do not write to this from any client" marker, and it doesn't collide with SurveyJS's own conventions (which don't use that prefix).

     ```json
     "__server_meta": {
       "duplicate_suspected": true,
       "possible_duplicate_patient_id": "<uuid of the matching existing patient>",
       "possible_duplicate_patient_name": "Jane Citizen"
     }
     ```

     Storing the matching patient's id **and** display name at submission time means the Readiness inbox can render "Possible duplicate of Jane Citizen" without an extra join or a stale-name risk if the patient is later renamed. The detail page uses the id to deep-link to the existing patient record for staff to action.

     The server-owned namespace rule applies to **any** future server-set metadata, not just duplicate flagging. If we add more server-side annotations later (e.g. workflow trigger context), they live under `__server_meta` too. The client never gets to write there.
  2. The Identity write rules for the existing-patient branch still apply: once staff resolve the duplicate (merge in the patient record, or confirm it's a separate person), reconciliation is manual.

  This matches the entry flow's existing behaviour for "Someone else" on a known phone — it does *not* introduce new dedup logic, just surfaces the risk to staff. If the entry flow gains stronger dedup later, both paths inherit it.

**Identity snapshot — canonical response shape (server-owned).** The identity field has `name: "patient_identity"` in the schema (see the Identity field type definition above). The corresponding entry in the submitted `responses` payload is always shaped as follows, regardless of what the client sends:

```json
"patient_identity": {
  "first_name": "Jane",
  "last_name": "Citizen",
  "date_of_birth": "1990-01-15",
  "email": "jane@example.com",
  "phone": "+61400000000",
  "resolved_patient_id": "<uuid>",
  "resolution_kind": "existing" | "someone_else" | "new"
}
```

**Server is the only writer.** The submit route **always overwrites** `responses.patient_identity` with the values from the validated identity step before persistence — whatever the client put in this block under the identity key is discarded. This applies whether the form is filled standalone (identity captured at step 3) or via the entry flow (identity captured by the entry flow's own steps). The shape is identical in both contexts.

- `first_name`, `last_name`, `date_of_birth`, `email` — the **values the patient submitted/confirmed** at the identity step. Same field meaning in every branch:
  - For `existing` resolutions, the identity step is confirm-only (no edit), so the submitted values are by construction identical to the patient row's values at the moment of confirmation. The server snapshots those confirmed values into the response. If the patient row is later edited by staff, the snapshot does not change — it remains an audit record of what the patient saw and confirmed.
  - For `new` and `someone_else`, the submitted values are whatever the patient typed in the identity capture form.

  In all cases the snapshot is authoritative for "what did the patient actually submit," and the `patients` row is authoritative for "who is this patient now." The divergence callout on the detail page compares these two sources for `existing` resolutions specifically — divergence only arises if staff edit the patient record after submission.
- `phone` — always the OTP-verified phone in E.164. Never trusted from the client; the server forces this to the verified value.
- `resolved_patient_id` — the uuid of the patient row this submission is linked to (the same value as `form_submissions.patient_id`). Stored inside the snapshot for self-containedness — anyone reading the response payload alone can identify the patient without joining.
- `resolution_kind` — which branch of the Identity write rules applied. Lets the detail page render the right comparison view (e.g. show "divergence callout" only when `kind = "existing"` and snapshot values differ from the patient record).

Why pin it down here: the detail page's identity comparison, the PDF export, and any future audit tooling all read this same block. If clients were allowed to write their own shape, those consumers would drift. By making the server the only writer with a fixed key and structure, every downstream surface gets the same contract.

**Where the data lives.** The canonical record for billing/contact purposes is the `patients` row (per Identity write rules, never mutated for existing patients). The `responses.patient_identity` block is the **submission-time snapshot** for audit, displayed alongside the canonical patient record on the detail page.

**Source attribution** (server-side, not client-trusted): The submit route reads the `source` field from the **request body** (persisted by the client across the flow via `sessionStorage` — see "Source attribution persistence" below) and **re-sanitizes** by mapping only the whitelist — `standalone_sms` and `sms` → `standalone_sms`; `standalone_qr` and `qr` → `standalone_qr`; anything else (including missing) → `standalone_public`. The server accepts both raw (`sms`/`qr`) and already-sanitized (`standalone_sms`/`standalone_qr`) inputs so the client doesn't need to know which is canonical. Arbitrary values never reach the database column.

---

## Clinic-Facing Surfaces

### Forms builder — Share tab

In `src/app/(clinic)/forms/[id]/page.tsx`, add a new "Share" section (tab or sidebar panel) to the form editor. The Share tab is visible only when the form is **schema-eligible** (has exactly one identity field). Within the tab, the controls' state depends on whether the form is also **shareable** (published).

The tab shows:

- **Public URL** — `{site}/f/{public_token}` with a prominent copy button. Visible whenever the form is schema-eligible. **This is the primary share mechanism in the prototype** — because no real SMS provider is wired up, the copy-URL action is how PMs (and the user in demo) actually load the form from a browser without any SMS plumbing. The URL is displayed in full (not truncated behind a copy icon only) so it's also readable / typeable from screen.
  - When the form is in draft, the URL is shown alongside a "This form is in draft — publish it before sharing. The link won't work for patients yet." banner. The URL is still copyable so the PM can pre-stage the link in marketing or printed materials before publishing.

    **Acknowledged inconsistency:** disabling QR/SMS in draft doesn't prevent staff from manually pasting the copied draft URL into another channel — anyone who copies the link can paste it into any SMS, email, or doc on their own. We're accepting this asymmetry: the in-product channels (QR, SMS-send) are gated so the *product* doesn't actively distribute unavailable links, but copy-to-clipboard is a generic affordance that we trust the PM not to misuse. The banner is the warning. If staff misuse becomes a real problem we can downgrade draft-copy to a secondary action behind a confirm — flagged but not v1.
  - When the form is archived, the URL is hidden and replaced with a banner: "This form is archived. The link returns 'not available' to patients. Restore it to drafts and republish to make it shareable again."
- **QR code PNG** download for the same URL with `?src=qr` appended. Generated client-side (e.g. `qrcode` npm package). PM can drop this into a printed sign. **Disabled in draft and archived states** — staff shouldn't accidentally distribute a QR that points at an unavailable form. The button shows the reason in a tooltip ("Publish the form to enable QR download").
- **"Share via SMS" action** (renamed from "Send via SMS" to make the semantics clear). Opens a phone-number-only input — **not** a patient picker. The action fires an SMS containing the public URL with `?src=sms` appended via the existing pluggable SMS provider (console provider in the prototype). It does **not** bind a patient, does **not** create a `form_assignments` row, and does **not** skip OTP on the patient side. The recipient still goes through OTP and identity confirmation like any other standalone visitor. **Disabled in draft and archived states** — same rationale as QR, no accidental sends pointing at unavailable forms. In the prototype console provider path, the message body (including the URL) is rendered in the UI after sending so the user can click through without a real phone connected — see the SMS architecture memory note.

Summary of control state by form status (assuming schema-eligible):

| Control | Draft | Published | Archived |
|---|---|---|---|
| Public URL copy | Enabled (with "publish first" banner) | Enabled | Hidden (with "archived" banner) |
| QR download | Disabled | Enabled | Disabled |
| Share via SMS | Disabled | Enabled | Disabled |
| Regenerate public link | Enabled | Enabled | Enabled |

- **"Regenerate public link"** action (low-prominence, behind a confirm dialog). Generates a fresh `public_token` for the form. The old token immediately stops resolving. This is the kill-switch for leaked links: archive is "stop everyone from filling this out," regenerate is "the URL leaked, give me a fresh one without disrupting the form's content." Available in all statuses (draft, published, archived) — the action is always meaningful, but the consequences vary, so the confirm dialog copy is **status-aware**:

  - **Published:** "Anyone with the old link will see 'This form isn't available.' Existing submissions are unaffected. Any QR codes you've printed will need to be regenerated. Are you sure?"
  - **Draft:** "Anyone with the old link will see 'This form isn't available' once you publish. Any QR codes pre-staged with the old link will need to be regenerated. Continue?"
  - **Archived:** "This form is archived — the old link already returns 'not available.' Rotating now only changes the link that will be used if you restore the form and republish. Continue?"

  Implementation: `POST /api/forms/[id]/regenerate-token` writes a new `gen_random_uuid()::text` value to `forms.public_token`. Auth: practice manager / clinic owner only.

  **Auditing.** Token regeneration is a destructive action against live patient-facing material — it can break printed QR codes and SMS messages mid-flight. The route must leave an audit trace:
  - Update `forms.updated_at` (existing trigger) and write the regenerating user into a new `forms.public_token_rotated_at TIMESTAMPTZ` and `forms.public_token_rotated_by UUID REFERENCES users(id) ON DELETE SET NULL` pair. Both nullable; populated only on regeneration (not on initial token creation).
  - Add these two columns to the same `020_standalone_forms.sql` migration.
  - Surface the last-rotation info in the Share tab next to the URL: "Link last rotated 3 days ago by Sarah Mitchell" when populated. Helps staff coordinate when multiple admins have rotation rights.
  - A full audit log table is out of scope for v1 — two columns on `forms` is the minimum that makes the action accountable without introducing a new logging primitive.

When the form is **not schema-eligible**, the Share tab renders a state-specific message and hides all Share controls (copy URL, QR, SMS, regenerate) — not disabled, hidden, since there's nothing to interact with until the schema is right:

- **Zero identity fields:** "This form has no Patient Identity field — patients filling it out standalone wouldn't be identified. Add a Patient Identity field to enable sharing."
- **More than one identity field:** "This form has multiple Patient Identity fields — only one is allowed. Remove the duplicates until exactly one remains to enable sharing."

The builder enforces the "at most one" rule at edit time, so the "more than one" case should be rare in practice. The Share tab handles it anyway, because legacy or programmatically-imported forms could end up in this state and the user-facing message needs to tell the PM what's actually wrong.

### Readiness Dashboard — Standalone submissions section

In `src/app/(clinic)/readiness/page.tsx`, add a section to the existing dashboard for standalone submissions. Placement: above appointment-bound readiness items, since they typically represent new patient interest that's most time-sensitive to action. Exact placement to be tuned in design.

Section content:
- Filter: `form_submissions` where `submission_source != 'entry_flow'` AND `review_status = 'pending'`, scoped to the org via `forms.org_id`.
- Each row shows: patient name, form name, time submitted, source (Public link / SMS / QR), duplicate-suspected badge if flagged, and an "Open" action that opens the submission detail page.
- Actions per row: **Mark reviewed** and **Archive**. State machine and stamping rules below.
- Empty state: "No standalone form submissions awaiting review." Visible only when the org has at least one shareable form, to avoid permanent empty sections.

**Review state machine** (server-enforced in the review-action routes):

Allowed transitions:
- `pending` → `reviewed` (via `/review` route)
- `pending` → `archived` (via `/archive` route)
- `reviewed` → `archived` (via `/archive` route — staff decides a reviewed submission is no longer relevant)

Idempotent (return 200 with current state, do not re-stamp `reviewed_at`/`reviewed_by`):
- `reviewed` → `reviewed` (re-applying the same status is a no-op)
- `archived` → `archived` (same)

Disallowed (route returns 409):
- `archived` → `reviewed` or `archived` → `pending` (archive is terminal; the section doesn't surface archived rows, so this would only happen via direct API call)
- `reviewed` → `pending` (no path back to pending; staff would re-open by some other means if that's ever a requirement)
- Any transition on a row where `submission_source = 'entry_flow'` (those rows have `review_status = NULL` and don't participate in this state machine)

Stamping rules — to keep the schema minimal we use a single reviewer pair for both states:
- `reviewed_at` / `reviewed_by` capture **whoever last advanced the row**, regardless of whether they marked-reviewed or archived. The current `review_status` value disambiguates what the stamp means.
- `reviewed` → `archived` transition overwrites `reviewed_at` / `reviewed_by` with the archiver's user and time.
- Rationale: a separate `archived_at` / `archived_by` pair is cheap to add later if staff need audit-grade separation, but for v1 the single pair plus `review_status` is sufficient context.

**Display labels are state-aware.** The column names (`reviewed_at` / `reviewed_by`) reflect implementation, not what staff should see. UI and API responses present them with state-correct semantics:

- When `review_status = 'reviewed'`: label as "Reviewed by [name] [time]".
- When `review_status = 'archived'`: label as "Archived by [name] [time]" — even though it's the same backing column.
- When `review_status = 'pending'`: stamps are NULL; no label.

The submission detail page and the API response should derive these labels from `review_status` rather than exposing the raw `reviewed_*` column name. Consumers that need the raw values for audit purposes can still read them, but the typed/labelled surface is the default.

**Submission detail view.** The `/api/forms/submissions/[id]` API route already exists (staff-only). The matching clinic-side **page** does not. This spec adds it at `src/app/(clinic)/forms/submissions/[id]/page.tsx`. The page is reused for *both* entry-flow and standalone submissions — it is not standalone-specific.

**Authorization (unconditional rule).** Submission access is authorized via the submission's **form** (`forms.org_id`), not via the patient. Specifically: the requesting staff user must have at least one `staff_assignment` whose `location.org_id` equals the form's `org_id`.

This rule applies uniformly to entry-flow and standalone submissions. `forms` is chosen as the auth anchor because it's the durable, never-merged record — patients can be merged or split, but the form that produced a submission can't drift away from its org.

Multi-location clinics: staff with an assignment in *any* location of the org can access the submission. Standalone submissions are org-level triage; a receptionist at location A should be able to action a submission that may eventually be booked at location B.

Implementation: an `assertStaffCanAccessSubmission(supabase, submissionId)` helper that resolves the form's `org_id` and verifies org membership. The existing `assertStaffCanAccessPatient` may be reused only if it already implements the same form-org-anchored check (which would require verifying its actual implementation — if it currently resolves through `patients.org_id` or patient-to-location joins, it does not satisfy this contract and the new helper is added regardless).

Layout: top — patient identity block showing **both** the linked patient record (canonical, loaded from `patients`) and the submission's identity snapshot (loaded from `responses.patient_identity` — the canonical shape pinned down in the Identity snapshot section above) side-by-side, with a "values differ" callout if any of first/last/DOB/email diverge. Comparison only runs when `responses.patient_identity.resolution_kind = "existing"`; for `new` and `someone_else` resolutions there's nothing to compare against because the snapshot *is* the source of the patient row. Middle — full response payload (excluding `patient_identity` and `__server_meta` from the generic field rendering, since they have dedicated treatment) with field labels from the form schema. Side rail — metadata: form name, submitted_at, submission_source, state-aware review/archive label, and the **Mark reviewed** / **Archive** actions. PDF export uses the existing `/pdf` route.

**Review actions UI gating** (explicit, not implicit):
- When `submission_source = 'entry_flow'`: the Mark reviewed / Archive actions are **hidden** entirely. Entry-flow rows have `review_status = NULL` and don't participate in this state machine; the UI must not render the actions, not just rely on the API rejecting them.
- When the row is already `archived`: both actions are hidden (terminal state).
- When the row is `reviewed`: Mark reviewed is hidden (idempotent), Archive is shown.
- When the row is `pending`: both actions are shown.

The API rejection (`409` on `entry_flow`, on disallowed transitions) is a defense-in-depth backstop, not the primary mechanism. The UI must compute the action set from `submission_source` and `review_status` and never show a button that, when clicked, would 409.

There is **no** new top-level sidebar item. There is **no** auto-attachment to appointments. Reviewing a submission is just a triage signal — what staff *do* about it (call the patient, book an appointment, ignore) happens outside the dashboard.

Real-time: standalone submissions are **org-scoped, not location-scoped** — they have no `location_id`. The existing Readiness real-time uses the `location:{id}` Socket.io room, which doesn't match this shape.

A new `org:{id}` Socket.io room is added for org-wide events. Readiness joins both `location:{selected_location_id}` (existing) and `org:{org_id}` (new) on mount. The standalone submit route emits `submission_changed` to `org:{org_id}`. Multi-location clinics get one feed for standalone submissions regardless of which location is currently selected.

The `server.ts` change must include **org-membership authorization** on the join: the client emits `join:org` with an org id, the server verifies the connecting socket has an authenticated cookie session, resolves the user's `staff_assignments` (joined through `locations.org_id`), and rejects (or simply ignores) the join if the user has no assignment in that org. A client cannot join an arbitrary org room. This mirrors how `join:location` should already be authorizing — if it isn't, this is a good prompt to verify and tighten that path at the same time. Server-side membership resolution uses the same Supabase auth-cookie pattern the API routes use; no separate token exchange.

(An earlier draft of this spec considered skipping real-time entirely and relying on page-load fetch or polling. That option is **not** v1 — Readiness already has a real-time event feed for its other sections, and the standalone-submissions section sitting next to live-updating content with stale data would feel broken. Polling is rejected.)

**Schema invariant that makes this safe.** `staff_assignments.location_id` is `NOT NULL`, and CLAUDE.md is explicit that "`staff_assignments` has no `org_id` column. The org is always derived via `locations.org_id`." So every staff user — clinic owner, practice manager, receptionist, clinician — has at least one location assignment, and the location-join check resolves their org membership correctly. There is no "org-level role without a location assignment" path in this schema; if that ever changes (e.g. true org-level admins added later), the org-room join authorization needs to be updated to include the new membership path, and this assumption flagged. v1 stands on the current invariant.

The submit route emit also uses the **server-side resolved org**, not a client-supplied id, so a malicious patient submitting a forged payload can't fan out to a different org's room.

---

## Tier and Role Gating

- **Tier.** Standalone forms are Complete-only, same as forms in general. The Share tab is hidden on Core; the Readiness section doesn't exist on Core because Readiness itself doesn't.
- **Roles.** Practice Managers (and Clinic Owners) author forms and configure share controls. Receptionists (and Clinic Owners, Practice Managers) see and action the standalone submissions section on Readiness. Clinicians do not interact with this surface — they continue to see forms only via the run sheet / session context.

---

## What This Spec Does Not Cover

These are deliberate v1 cuts. Some may become follow-ups.

- **Per-recipient SMS tokens.** v1 reuses the public token for SMS sends, with `?src=sms` for attribution. A future pass can introduce per-recipient tokens that pre-bind the phone number and reduce friction. Touches `form_assignments` (or a new sibling table) and the OTP step.
- **Auto-attachment to appointments.** Out of scope. v1 keeps standalone submissions free-floating.
- **Inbox as a top-level surface.** v1 surfaces standalone submissions inside Readiness. If staff find the volume / shape warrants a dedicated nav item, revisit.
- **Configurable thank-you messages or post-submit CTAs.** v1 ships a generic confirmation screen. PM-configured thank-you copy and "Book now" CTAs are a later concern.
- **Embedded form widget for clinic websites.** Out of scope. Public URL is the only embed mechanism. iframe embedding of `/f/{token}` works incidentally but isn't a supported feature in v1.
- **Field-type restrictions for standalone use.** All existing SurveyJS field types are assumed to work standalone. If we find one that doesn't (e.g. a field that referenced appointment data), we'll patch it then.
- **Multi-language / accessibility tuning beyond what the entry flow already does.** Inherit whatever the entry flow has.
- **Patient editing / re-submission.** Once submitted, a standalone submission is immutable. The patient cannot return to the URL and edit. (They'd need to re-submit via the same URL, which would create a second submission row.)
- **Workflow-engine integration of standalone submissions.** A standalone submission does *not* trigger workflow actions in v1. If we want "submission of form X triggers workflow Y," that's a workflow engine enhancement, not a standalone-forms enhancement.

---

## Open Questions

1. **Where exactly does the standalone submissions section sit in Readiness?** Above appointment-bound items as proposed, or as a separate tab? Visual-design question best resolved in the Figma pass.

2. **Socket.io org-room scope creep.** Adding an `org:{id}` room solves the standalone-submission feed cleanly. It's also a primitive that other org-wide features will want (org-wide notifications, settings changes). Flag for review: the moment we add this room, we should think about what *else* will live on it, so we don't accidentally couple "standalone submission triage" with unrelated future events.

3. **Audit-grade archive separation.** v1 reuses `reviewed_at` / `reviewed_by` for both review and archive transitions, with `review_status` disambiguating. If anyone (compliance, customer success) ever needs to answer "when was this archived, and by whom, even if it was reviewed first?" we'll need a separate `archived_at` / `archived_by` pair. Cheap to add; not worth pre-paying for v1. Flag if there's a known requirement coming.

**Resolved during review (was previously open):**
- `submission_source` attribution forgeability — accepted for v1. Server-side whitelist sanitization (`sms`/`qr` → mapped; anything else → `standalone_public`) is sufficient to keep the column trustworthy as a typed value, even if the underlying signal is forgeable.
- Identity conflict behaviour — resolved as a hard rule in Identity write rules above: existing patient records are not mutated; submitted values are stored in the submission's `responses` snapshot for staff reconciliation.
- Token-on-creation vs token-on-publish — resolved as token-on-creation, with the **Regenerate public link** action as the kill-switch for leaked URLs. Archive remains the way to stop a form being filled out at all; regenerate is for "the URL leaked, give me a fresh one." Both are now spec'd.

---

## Implementation Sketch

Order of operations once we proceed:

1. **Migration** (`020_standalone_forms.sql`): the schema deltas above.
2. **Backend**:
   - New route: `GET /api/forms/standalone/[public_token]` — enforces **shareability** (schema-eligible + published). Returns 200 with form data when shareable; typed 404 (`{ available: false, reason: ... }`) with branding metadata when not shareable; flat 404 when the token doesn't match a form.
   - New route: `POST /api/forms/standalone/[public_token]/submit` — re-enforces shareability, validates patient selection against the server-resolved OTP-match set, applies Identity write rules (including duplicate-suspected flagging), sanitizes the received `source` field to the whitelist, **constructs the canonical `responses.patient_identity` snapshot block** (see Identity snapshot — canonical response shape) and writes it into the response payload, **overwrites the `responses.__server_meta` block** with any server-set annotations (duplicate-suspected flag + ids when applicable), inserts the submission, emits `submission_changed` to `org:{org_id}` using the server-resolved org id. The submit route is the sole writer of both `responses.patient_identity` and `responses.__server_meta` — whatever the client puts under those keys is discarded.
   - New route: `POST /api/forms/[id]/regenerate-token` — practice manager / clinic owner only, writes a new `gen_random_uuid()::text` to `forms.public_token` AND stamps `public_token_rotated_at = now()` and `public_token_rotated_by = <auth user>`. Org-scoped via existing form-access auth.
   - Extend `GET /api/forms/submissions/[id]` to expose `submission_source`, `review_status`, `reviewed_at`, `reviewed_by`, the canonical `responses.patient_identity` snapshot block (always present on standalone submissions; see Identity snapshot — canonical response shape for the exact contract), and the `responses.__server_meta` block (duplicate flag + ids) when set. Detail page, PDF export, and audit comparison all read from these typed blocks rather than walking the raw response payload.
   - New routes for review actions: `POST /api/forms/submissions/[id]/review` (sets `review_status = 'reviewed'`, stamps reviewer) and `POST /api/forms/submissions/[id]/archive` (sets `review_status = 'archived'`, stamps reviewer). Both enforce the state machine documented above; idempotent on target-equals-current; reject `entry_flow` rows with 409.
   - Add an `assertStaffCanAccessSubmission(supabase, submissionId)` helper that authorizes via the submission's `form_id → forms.org_id → staff_assignments.location.org_id` chain. Use this helper from both the GET and the review/archive routes. The existing `assertStaffCanAccessPatient` may be reused only if its implementation matches this contract; otherwise the new helper takes over for submission-scoped routes regardless.
3. **Identity field type**:
   - Register a custom SurveyJS question type `identity` in `src/lib/survey/` (alongside the existing theme file).
   - Form builder toolbox addition with the "captured first — placement controls summary only" hint.
   - Builder validation: at most one identity field per form.
   - Renderer recognition of the placeholder in both standalone and entry-flow contexts (read-only summary card with a "change" link in standalone, read-only in entry flow).
4. **Patient runtime**:
   - New route group page `src/app/(patient)/f/[token]/page.tsx`.
   - Reuse entry-flow OTP and identity components (lift into `src/components/patient/identity/` if not already there).
   - Unavailable-state screen (renders on typed-404 from the GET, uses branding from the typed-404 body).
   - Source attribution persistence: sanitize and store `src` in `sessionStorage` keyed by token on first load; submit reads from sessionStorage and server re-sanitizes.
   - New confirmation screen.
5. **Forms builder Share tab**:
   - Edit `src/app/(clinic)/forms/[id]/page.tsx` (or its child shell).
   - Prominent public URL with copy button — primary prototype share mechanism. Shown in both draft and published states with appropriate banner.
   - QR code generation client-side.
   - "Share via SMS" action: phone-number input only, no patient binding, no `form_assignments` row. Uses the existing console SMS provider in the prototype, which also surfaces the message body in the UI for click-through testing.
   - "Regenerate public link" action with confirm dialog.
6. **Socket.io org room**:
   - Add `join:org` handling in `server.ts` alongside the existing `join:location`. Server resolves the user's Supabase cookie session, joins through `staff_assignments` → `locations.org_id`, and rejects the join if the user has no assignment in the requested org.
   - Verify (and tighten if needed) the existing `join:location` handler applies the same authorization.
   - **Only clinic staff clients** join `org:{org_id}` on mount. Patient flows never join org rooms (they don't need org-wide signals and shouldn't have the auth context to do so anyway).
7. **Submission detail page**:
   - New page `src/app/(clinic)/forms/submissions/[id]/page.tsx` serving both entry-flow and standalone submissions. Shows the dual identity block (patient record vs submission snapshot, with divergence callout), the response payload, and metadata + review actions in a side rail.
8. **Readiness section**:
   - Edit `src/app/(clinic)/readiness/page.tsx`.
   - Add `submission_changed` Socket.io event handling on the `org:{org_id}` room.

Each step is independently mergeable; the surface only "lights up" once the runtime, the share controls, the detail page, and the Readiness section are all in.
