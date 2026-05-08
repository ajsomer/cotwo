# Spec: Caller ID Trigger Layer

**Status**: Draft v1
**Tier**: Complete only (Core deferred)
**Date**: 2026-05-06

---

## Overview

| | |
|---|---|
| **Surface** | Phone integrations settings page, inbound call screen-pop slide-over (run sheet + readiness), patient registration journey, new "Calls" history view on the patient profile |
| **Users** | Receptionists (primary — answer calls, fire actions), practice managers (configure provider integration, configure call-triggered workflows), patients (receive SMS triggered by the call) |
| **Available to** | Complete tier only. Core sees no caller-ID surfaces. |
| **Real-time** | Yes. Inbound call events broadcast over the existing location Socket.io room. |
| **Priority** | New revenue surface. Positions Coviu as the integration layer on top of existing VoIP, not a phone system. |

The caller ID trigger layer is Coviu's interface to whatever phone system a clinic already runs (3CX, Aircall, Twilio, RingCentral). Coviu does not handle audio, does not own the call leg, and does not route minutes. We subscribe to the provider's "ringing" or "call started" webhook, look up the calling number against `patient_phone_numbers`, broadcast a screen-pop to the location's run sheet, and expose a small set of one-click actions that fire **existing workflow actions** against either an existing patient or a newly-created contact.

The thesis is that the call itself is uninteresting. The event of a known patient calling — or a new patient calling for the first time — is a high-signal trigger for automation Coviu already does well: send the intake package, send a card capture link, send a fact sheet, send a rebooking nudge. Caller ID is the wedge; the workflow engine is the value.

> **Coviu is the caller ID, not the phone. The call is just the event. The workflow engine is the action.**

---

## V1 scope and what is deferred

V1 ships:

1. A pluggable **`CallProvider` adapter** with a single concrete implementation (Twilio Voice). Aircall, 3CX, and RingCentral adapters are out of scope but the interface is designed to fit them.
2. A normalised **`/api/calls/inbound/[provider]` webhook receiver** that translates provider-specific payloads into a single internal `IncomingCallEvent` shape.
3. **Phone number lookup** against `patient_phone_numbers`, returning either a matched patient (or set of matched patients for shared numbers), or unmatched.
4. **Real-time screen-pop broadcast** over the existing location Socket.io room as a new `call:incoming` event, plus a corresponding `call:ended` event.
5. **Screen-pop slide-over** rendered on the run sheet and readiness dashboard, with two variants (matched / unmatched) and a small set of action buttons.
6. **Call-triggered actions** that fan out to the existing workflow engine via a new ad-hoc execution path: send intake package, send registration package (new), send fact sheet, send rebooking nudge, send custom SMS.
7. A new **registration package** journey type (sister to the intake package) that captures `first_name`, `last_name`, `dob`, and creates the patient + phone number record. Used as the "send new patient registration" action when the caller is unmatched.
8. **`calls` and `call_actions` tables** for persistence and audit.
9. A **Phone Integrations settings page** under Settings, location-scoped, where a practice manager pastes Twilio credentials and copies the webhook URL.
10. A **calls history panel** on the patient profile (small, derived from `calls`).

V1 does **not** ship:

- Aircall, 3CX, RingCentral adapters (architecture allows them; build follows demand).
- Outbound click-to-call (we are the caller ID, not the dialer).
- Call recording, transcription, AI summarisation.
- Call disposition prompts ("what happened on this call?").
- IVR flows triggered by Coviu (no `<Gather>` digit collection, no menus).
- Cross-location notification routing (the existing run sheet only-shows-the-selected-location constraint applies — see CLAUDE.md realtime conventions).
- Per-clinician routing or stickiness.
- A call-triggered post-appointment workflow (post-workflows are still Process-flow-only in V1).

---

## Core concepts

### The call is an event, not an entity we operate on

Coviu never holds a call leg, never plays audio, never decides where to route a call. The provider does that — Twilio's TwiML execution, Aircall's softphone, 3CX's PBX. From our perspective an inbound call is exactly two events:

- **`incoming`** — provider says "a call started ringing." We do the lookup and broadcast the screen-pop.
- **`ended`** — provider says "the call ended." We dismiss the screen-pop (if not already dismissed) and finalise the `calls` row.

Everything between those two events (ringing duration, hold music, who picked up, what was said) is the provider's problem and we do not try to model it. This constraint is what makes the integration pluggable across providers — we are observing call lifecycle, not controlling it.

### One adapter per provider, one normalised event shape

The `CallProvider` interface defines exactly the surface Coviu needs:

```typescript
interface CallProvider {
  readonly providerKey: 'twilio' | 'aircall' | 'three_cx' | 'ring_central';
  parseInboundWebhook(req: Request): Promise<NormalisedCallEvent | null>;
  verifyWebhookSignature(req: Request, secret: string): boolean;
}

type NormalisedCallEvent =
  | {
      kind: 'incoming';
      provider: string;
      external_call_id: string;
      from_e164: string;
      to_e164: string;          // the clinic's number, used to match to a location
      received_at: string;       // ISO timestamp
    }
  | {
      kind: 'ended';
      provider: string;
      external_call_id: string;
      ended_at: string;
      duration_seconds: number | null;
    };
```

Every provider produces the same `NormalisedCallEvent`. Everything downstream — lookup, broadcast, screen-pop, actions — is provider-agnostic. The only provider-specific code is the parser and the signature verifier. This mirrors the PMS adapter pattern referenced in CLAUDE.md.

### Numbers are matched against `patient_phone_numbers` within the called location's org

Phone numbers are clinic-scoped (CLAUDE.md: "Phone number as identity key, no cross-clinic identity"). A call ringing at the Bondi location of Clinic A only matches patients in Clinic A's org. Cross-org matching never happens.

The match is keyed off the **destination number** (`to_e164`) → location, then the **source number** (`from_e164`) → patients in that org. If multiple locations share a destination number (rare but possible — a clinic with one Twilio number routing to several physical sites via IVR), the destination is ambiguous and we fall back to the receptionist's currently-selected location.

Match outcomes:

- **Single match.** One patient in `patient_phone_numbers` for that org has the calling number. Screen-pop renders the matched variant.
- **Multi-match.** Multiple patients share the calling number (e.g. a parent's phone tied to several children, or a couple sharing a phone). Screen-pop renders a picker. Receptionist clicks the right person to reveal full context. This reuses the multi-contact resolution model from the patient entry flow.
- **No match.** Unknown number. Screen-pop renders the unmatched variant with a single primary action: **Send registration package**.

### Caller-ID-triggered actions are ad-hoc workflow runs

When the receptionist clicks "Send intake package" on the screen-pop, Coviu does not invent a new firing path. It creates a one-action workflow run by:

1. Resolving the patient (from the screen-pop's matched patient, or the just-created patient from a registration package).
2. Resolving an `appointment_id` if the patient has a future appointment. If not, creating a synthetic appointment-like anchor (see "Patient-anchored actions without appointments" below).
3. Creating an `appointment_workflow_runs` row with a new direction value `caller_triggered` (or, alternately, reusing `pre_appointment` and tagging the run with a `trigger_source` column — see Schema section).
4. Creating a single `appointment_actions` row pointing at the chosen action type.
5. Setting `scheduled_for = now() + 1 minute` (the same 1-minute buffer post-appointment workflows use to avoid the race against the engine scan).
6. Letting the existing engine pick it up on the next scan.

The action handlers are unchanged. `intake_package`, `send_file`, `send_sms`, `send_rebooking_nudge` already work. Caller ID is just a new way to schedule one of them on demand. This is the central architectural bet of this spec: **call-triggered actions are not new actions; they are the existing actions invoked from a new trigger surface**.

### Patient-anchored actions without appointments

The intake package and other workflow actions today assume an `appointment_id`. A call from an existing patient with no upcoming appointment, or a brand-new caller, has no appointment to anchor against. Two options were considered:

1. **Make `appointment_id` nullable on `appointment_workflow_runs` and on `appointment_actions`**, anchor caller-triggered runs against `patient_id` directly. Cleaner data model, but requires every consumer (readiness API, action handlers, scheduler) to handle the null case.
2. **Create a synthetic, lightweight appointment row** with `scheduled_at = NULL` and `appointment_type_id = NULL`, marked with a new flag `kind = 'caller_anchor'`, only used to satisfy the FK.

V1 picks **option 1 with a guarded migration**. The intake package spec already made `appointments.scheduled_at` nullable for collection-only workflows. We extend that pattern: introduce a new `caller_triggered` workflow direction whose runs do not require an appointment FK. This avoids polluting the appointments table with synthetic rows that would show up on the run sheet, the readiness dashboard, and patient histories.

Concretely:

- `appointment_workflow_runs.appointment_id` becomes nullable for runs whose `direction = 'caller_triggered'`. Application-level constraint, with a partial CHECK.
- `appointment_workflow_runs` adds `patient_id` (nullable, populated for caller-triggered runs).
- `appointment_actions` rows for caller-triggered runs use the parent run's `patient_id` to look up phone numbers and send SMS, instead of joining through the appointment.
- The readiness dashboard and run sheet **do not** show caller-triggered runs. They are observable on the patient profile's calls history panel only. (This keeps the "the run sheet is for today's sessions" invariant intact.)

### The registration package mirrors the intake package

The intake package (`docs/specs/intake-package-workflow-spec.md`) is a single bundled patient journey behind one link with persistent progress. Its first-class concept — "verify identity and confirm contact" — assumes the patient was already added to the org by the receptionist.

The registration package is the inverse case: the patient calls, we don't have them yet, the receptionist clicks "Send registration package," the SMS goes out, and the patient lands on a journey that **creates** the contact rather than confirming it. After phone OTP succeeds, the journey shows a capture form (first name, last name, DOB, optional reason for contact) and creates the `patients` + `patient_phone_numbers` rows. From there it can optionally roll into the standard intake package items (card capture, consent, forms) if the practice manager configured it.

A registration package is configured per-organisation (one default per location, with org-level fallback). It is **not** tied to an appointment type because there is no appointment yet. Configuration lives in a new `registration_packages` table mirroring the structure of `workflow_action_blocks.config` for `intake_package`:

```typescript
{
  includes_card_capture: boolean;
  includes_consent: boolean;
  form_ids: string[];
  default_appointment_type_id?: string; // optional — flag the patient against an appointment type for downstream automation
}
```

The registration package action's handler is structurally identical to `intake_package`: generates a token, creates a journey row (in a new `registration_journeys` table — see Schema), sends an SMS, and waits for completion. On completion, the patient + phone number records exist, and any subsequent caller ID lookup for that number now matches.

---

## Trigger surface: the screen-pop

### When it appears

A `call:incoming` event arrives over the location Socket.io room. Every connected receptionist or practice manager at that location sees the screen-pop. Clinicians do not — their run sheet is filtered to their assigned rooms, and the call screen-pop is a reception-desk concern.

The screen-pop is a **slide-over from the right**, consistent with the existing "+ Add session" panel. It does not steal focus, does not block the run sheet, does not modal. The receptionist can dismiss it with Escape or the X, in which case it stays available via a small banner ("1 active call") at the top of the run sheet header until the call ends.

If multiple calls come in simultaneously (rare in a single-location reception desk but possible at multi-location hubs), the slide-over stacks: the most recent call is on top, older calls collapse to a vertical list of "Calls in progress" cards in the slide-over. Each can be expanded.

### When it dismisses

The slide-over auto-dismisses on `call:ended` if the receptionist has not interacted with it. If the receptionist has already clicked an action (e.g. fired a registration package), the slide-over flips to a "completed" state showing what was done, with a "Close" button. This avoids the slide-over disappearing mid-action.

If the receptionist explicitly closes it before `call:ended`, the small banner remains until `call:ended`.

### Variant 1: matched (single patient)

**Header (slide-over title bar):**
- Phone icon, "Incoming call"
- Patient name (large), DOB, age
- Phone number (E.164 formatted)
- Close button

**Body sections (vertical):**

1. **Patient summary card.** Last visit date, total visits, primary clinician, any flags (e.g. "Card not on file," "Outstanding intake form"). Each flag is a one-line item with a small icon. The flags reuse the same logic as the readiness dashboard's per-row indicators.

2. **Next appointment card** (if `appointments.scheduled_at > now()`): appointment time, appointment type, room, clinician. Inline buttons: "Confirm" (sends a custom confirmation SMS), "Send intake package" (only visible if the appointment has an active workflow run with the intake package not yet complete), "Reschedule" (opens the existing add-patient panel pre-filled).

3. **Quick actions.** Always visible, regardless of appointment state:
   - **Send fact sheet** — opens the file picker (reuses the existing files library file picker component). Picks a file, fires `send_file` against the patient.
   - **Send custom SMS** — opens a small textarea inline. Reuses the same SMS-sending plumbing as `send_sms`.
   - **Send rebooking nudge** — fires the standard `send_rebooking_nudge` action with org default copy.
   - **Open patient profile** — navigates the run sheet to the patient profile slide-out (existing component on the readiness dashboard).

4. **Recent calls** (small, last 3 only): "Yesterday at 14:32 — sent rebooking nudge", etc. Pulled from the new `calls` table.

### Variant 2: matched (multi-contact)

When a single phone number maps to multiple patients in the org, the slide-over header shows the phone number and a section: **"Who's calling?"** with a vertical list of patient cards (name, DOB, last visit). The receptionist clicks one. The slide-over body then re-renders as the single-match variant for the selected patient.

A "Someone else" option at the bottom of the list opens the registration package action — the same as the unmatched flow — to capture a new contact on the existing phone number.

### Variant 3: unmatched

**Header:**
- Phone icon, "Incoming call from unknown number"
- Phone number (E.164 formatted, large)
- Close button

**Body:**

1. **Primary action card** (large, teal): **"Send new patient registration"**. One-line description: "We'll text them a link to register, capture details and any required forms." Click fires the registration package action (see registration package action below). After click, the card flips to "Sent — waiting for completion" with a small progress indicator.

2. **Secondary actions:**
   - **Send custom SMS** — for "we'll call you back" or "here's our address."
   - **Search patients** — opens an inline patient search by name, in case the calling number is wrong but the receptionist knows who it is. On selection, the slide-over re-renders as the matched variant for the selected patient. (This is also where the receptionist can manually attach the call to the right patient — useful for when a family member is calling on behalf of a patient.)

3. **Mark as not a patient** — if the call is a vendor, wrong number, etc. Logs the call against a "non-patient" disposition for analytics, no action fires.

### Action confirmation pattern

Every action button on the slide-over follows the same pattern: click → fire → flip to a confirmation state inline → toast at the bottom of the screen ("Intake package sent to Jane Smith"). No modal confirmations. Receptionists are answering a phone call; modal interruptions are bad UX.

The fired action's `appointment_action.id` is stored in `call_actions` (see Schema) so the screen-pop's "completed" state can show what was done, when, and the result (sent / failed / patient opened).

---

## Schema changes

### Migration: `020_caller_id_layer.sql`

```sql
-- 1. Provider configuration per location.
CREATE TABLE phone_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    -- NULL = org-wide (used as fallback when destination number doesn't match a location)
  provider TEXT NOT NULL,
    -- 'twilio' | 'aircall' | 'three_cx' | 'ring_central'
  destination_number TEXT NOT NULL,
    -- The clinic's phone number in E.164. Used to route inbound webhooks to the right location.
  webhook_secret TEXT NOT NULL,
    -- Provider-specific signing secret. Used to verify webhook authenticity.
  provider_config JSONB NOT NULL DEFAULT '{}',
    -- Provider-specific extra fields (account SID, API key, etc.)
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_phone_integrations_destination
  ON phone_integrations(destination_number)
  WHERE enabled = TRUE;
CREATE INDEX idx_phone_integrations_location ON phone_integrations(location_id);
CREATE INDEX idx_phone_integrations_org ON phone_integrations(org_id);

-- 2. Call event persistence.
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_call_id TEXT NOT NULL,
    -- The provider's call ID (Twilio CallSid, Aircall call ID, etc.)
  from_e164 TEXT NOT NULL,
  to_e164 TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
    -- 'inbound' | 'outbound' (outbound reserved for v2)
  match_state TEXT NOT NULL,
    -- 'matched_single' | 'matched_multi' | 'unmatched' | 'not_patient' | 'pending_match'
  matched_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    -- The patient the receptionist resolved this call to (single or selected from multi)
  candidate_patient_ids UUID[] NOT NULL DEFAULT '{}',
    -- All patient IDs that matched the calling number (for audit, even after resolution)
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Which staff member resolved/dismissed the screen-pop
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_calls_provider_external
  ON calls(provider, external_call_id);
CREATE INDEX idx_calls_org_received ON calls(org_id, received_at DESC);
CREATE INDEX idx_calls_patient ON calls(matched_patient_id, received_at DESC);
CREATE INDEX idx_calls_location ON calls(location_id, received_at DESC);

-- 3. Per-call action audit (which actions did the receptionist fire on this call?)
CREATE TABLE call_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  fired_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action_kind TEXT NOT NULL,
    -- 'intake_package' | 'registration_package' | 'send_file' | 'send_sms'
    -- | 'send_rebooking_nudge' | 'mark_not_patient'
  appointment_action_id UUID REFERENCES appointment_actions(id) ON DELETE SET NULL,
    -- The workflow engine row this dispatched to. NULL for actions that don't
    -- create an appointment_action (e.g. mark_not_patient).
  result JSONB NOT NULL DEFAULT '{}',
    -- Snapshot of action-specific result data at fire time (e.g. file_id, sms_body)
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_call_actions_call ON call_actions(call_id);
CREATE INDEX idx_call_actions_appointment_action ON call_actions(appointment_action_id);

-- 4. Registration package configuration per org/location.
CREATE TABLE registration_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    -- NULL = org default. Falls back to org-level if no location-specific row.
  config JSONB NOT NULL DEFAULT '{}',
    -- { includes_card_capture, includes_consent, form_ids, default_appointment_type_id }
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_registration_packages_org_location
  ON registration_packages(org_id, COALESCE(location_id::text, ''));

-- 5. Registration journey storage (mirror of intake_package_journeys for the
--    pre-patient case).
CREATE TABLE registration_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  registration_package_id UUID REFERENCES registration_packages(id) ON DELETE SET NULL,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
    -- The originating call, if any. NULL for registration packages fired from
    -- other surfaces in the future (web form, QR code, etc.)
  journey_token TEXT NOT NULL UNIQUE,
  invited_phone_e164 TEXT NOT NULL,
    -- The phone number we sent the registration link to. Verified at OTP.
  status TEXT NOT NULL DEFAULT 'in_progress',
    -- 'in_progress' | 'identity_captured' | 'completed' | 'expired'
  resulting_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    -- Populated once the patient capture form is submitted.
  includes_card_capture BOOLEAN NOT NULL DEFAULT FALSE,
  includes_consent BOOLEAN NOT NULL DEFAULT FALSE,
  form_ids UUID[] NOT NULL DEFAULT '{}',
  card_captured_at TIMESTAMPTZ,
  consent_completed_at TIMESTAMPTZ,
  forms_completed JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX idx_registration_journeys_token ON registration_journeys(journey_token);
CREATE INDEX idx_registration_journeys_call ON registration_journeys(call_id);
CREATE INDEX idx_registration_journeys_phone ON registration_journeys(invited_phone_e164);
CREATE INDEX idx_registration_journeys_status ON registration_journeys(status);

-- 6. Workflow engine extensions.

-- 6a. New direction value: 'caller_triggered'.
ALTER TYPE workflow_direction ADD VALUE IF NOT EXISTS 'caller_triggered';

-- 6b. New action types.
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'registration_package';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'call_followup_sms';
  -- A call-triggered SMS distinct from generic send_sms so handlers can branch
  -- on the originating call_id stored in the action's config.

-- 6c. Make appointment_id nullable on appointment_workflow_runs and add patient_id.
ALTER TABLE appointment_workflow_runs
  ALTER COLUMN appointment_id DROP NOT NULL,
  ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'appointment',
    -- 'appointment' | 'call'
  ADD COLUMN call_id UUID REFERENCES calls(id) ON DELETE SET NULL;

-- 6d. Constraint: caller_triggered runs must have patient_id (or registration_journey_id),
-- non-caller_triggered runs must have appointment_id.
ALTER TABLE appointment_workflow_runs
  ADD CONSTRAINT chk_workflow_run_anchor CHECK (
    (direction = 'caller_triggered' AND (patient_id IS NOT NULL OR call_id IS NOT NULL))
    OR (direction <> 'caller_triggered' AND appointment_id IS NOT NULL)
  );

-- 6e. Same for appointment_actions.
ALTER TABLE appointment_actions
  ALTER COLUMN appointment_id DROP NOT NULL,
  ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  ADD COLUMN call_id UUID REFERENCES calls(id) ON DELETE SET NULL;

-- 7. RLS: phone_integrations, calls, call_actions, registration_packages,
-- registration_journeys all org-scoped via existing public.user_org_ids().
-- Same pattern as files / file_deliveries.
```

### What's intentionally NOT in this migration

- No new `appointment_kind` value or synthetic appointment rows. The patient-anchored model uses the run/action FK columns directly.
- No `disposition` column on `calls`. Disposition is deferred to v2 — the screen-pop's "mark as not patient" flips `match_state`, which is sufficient.
- No `recording_url` column. Recording is out of scope.
- No outbound call columns beyond the `direction` enum. Outbound is out of scope; the column exists so future migrations don't need to backfill.

---

## Action types

### `registration_package`

| Property | Value |
|---|---|
| Label | Send registration package |
| Direction | `caller_triggered` |
| Fires | Immediately on dispatch (offset 0, with the same +1 minute buffer used elsewhere) |
| Parent action | None |
| Config | `{ registration_package_id, invited_phone_e164, call_id }` |
| Precondition | None |

**Handler behaviour:**

1. Look up the `registration_packages` row by `registration_package_id`.
2. Generate a unique journey token.
3. Create a `registration_journeys` row with the package's config snapshotted, the calling phone number, the originating `call_id`, and `expires_at = NOW() + INTERVAL '30 days'`.
4. Send SMS to `invited_phone_e164` with the registration link: `${APP_URL}/register/${token}`. The SMS body comes from a template configurable per registration package, defaulting to: "Hi! Tap here to register with {clinic_name} so we can help you better: {link}"
5. Return `{ status: 'sent', resultData: { journey_id, journey_token } }`.

**Completion:** the journey flips to `completed` when the capture form is submitted and any required items (card, consent, forms) are done. At that point:
- A `patients` row is created with `org_id`, `location_id`, captured fields.
- A `patient_phone_numbers` row is created linking the new patient to the calling phone number.
- The `registration_journeys.resulting_patient_id` is populated.
- The `appointment_actions` row for this registration package is updated to `status = 'completed'` (matching the intake package completion model).
- If `default_appointment_type_id` is set, a synthetic appointment-less workflow run is **not** created — the receptionist still has to book an appointment manually. The default type only flags the patient for downstream reporting.

### `call_followup_sms`

| Property | Value |
|---|---|
| Label | Call follow-up SMS |
| Direction | `caller_triggered` |
| Fires | Immediately (with +1 minute buffer) |
| Parent action | None |
| Config | `{ message_body, call_id }` |
| Precondition | None |

A thin variant of `send_sms` that carries the originating `call_id` so the patient profile's calls history can correlate the SMS to the call. Otherwise structurally identical to `send_sms`.

### Reused existing actions

The following existing action types can be dispatched from a call screen-pop without new handler code, as long as the action row carries `patient_id` (and optionally `call_id`) instead of `appointment_id`:

- `intake_package` — fired against an existing appointment, scoped down to "the patient's next future appointment with an active workflow run." The button only appears if such an appointment exists.
- `send_file` — fired against `patient_id`, `call_id`. Handler reads `patient_phone_numbers` from `patient_id` instead of joining through the appointment.
- `send_rebooking_nudge` — fired against `patient_id`, `call_id`.
- `send_sms` — fired against `patient_id`, `call_id`. (`call_followup_sms` is preferred when correlation matters.)

The handler updates required for these are minimal: each handler currently does `select ... from appointments where id = appointment_id`. The change is to fall back to `select ... from patients where id = patient_id` when `appointment_id` is null. The phone-number-resolution logic already supports the patient-id path (it's how the patient entry flow works).

---

## Webhook receiver

### Route: `POST /api/calls/inbound/[provider]`

The dynamic segment maps to a `CallProvider` adapter. Unknown providers return 404.

```typescript
// src/app/api/calls/inbound/[provider]/route.ts (sketch)
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const adapter = getCallProvider(params.provider);
  if (!adapter) return new Response('Unknown provider', { status: 404 });

  const body = await req.text();
  const integration = await findIntegrationByProviderAndDestination(adapter.providerKey, body);
  if (!integration) return new Response('No integration configured', { status: 404 });

  if (!adapter.verifyWebhookSignature(req, integration.webhook_secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = await adapter.parseInboundWebhook(req);
  if (!event) return new Response('OK', { status: 200 }); // event we don't care about

  if (event.kind === 'incoming') {
    await handleIncomingCall(event, integration);
  } else if (event.kind === 'ended') {
    await handleCallEnded(event, integration);
  }

  return new Response('OK', { status: 200 });
}
```

### `handleIncomingCall`

1. **Resolve location** via `phone_integrations.destination_number = event.to_e164`. If multiple, pick the location with the highest receptionist activity in the past hour as a heuristic (or fall back to org-wide).
2. **Resolve patients** via `patient_phone_numbers.phone_number_e164 = event.from_e164 AND org_id = integration.org_id`.
3. **Insert `calls` row** with `match_state` set to `matched_single`, `matched_multi`, or `unmatched`, and `candidate_patient_ids` populated.
4. **Broadcast `call:incoming`** over the location Socket.io room. Payload includes the `call_id`, calling number, and a denormalised patient summary (name, DOB, last-visit, flags, next-appointment). The denormalisation is intentional — the screen-pop must render fast, no extra fetches.
5. Return 200 to the provider quickly (under 5 seconds — Twilio retries otherwise). Heavy work (audit, slow lookups) goes to a background queue.

### `handleCallEnded`

1. Update `calls.ended_at = event.ended_at`, `duration_seconds = event.duration_seconds`.
2. Broadcast `call:ended` with the `call_id`.
3. If `match_state = 'pending_match'` (meaning the call ended before a receptionist resolved it), keep the call in the calls history with no `matched_patient_id`. Receptionists can later attach it via the calls history view (out of scope for v1, mentioned for completeness).

### Provider-specific notes

**Twilio:** the inbound webhook fires on `Status: ringing`. The body is form-encoded `application/x-www-form-urlencoded` with `From`, `To`, `CallSid`, `CallStatus`. The `X-Twilio-Signature` header is HMAC-SHA1 over the URL + body, keyed by the auth token. The webhook URL must be configured in the Twilio console. We can ignore the TwiML response (return empty 200) — the call still reaches the clinic's existing forwarding because Twilio's "A call comes in" webhook is just a notification when the number is configured to forward elsewhere via a different routing rule. **Important caveat:** if the clinic wants Twilio to forward the call to their existing landline, the TwiML response needs to be `<Response><Dial>+61...</Dial></Response>`. This is a per-integration configuration the practice manager sets in the phone integrations settings page.

**Aircall:** webhooks are configured in the Aircall dashboard and fire on `call.created` / `call.ended`. JSON body. Signing is HMAC-SHA256 with `X-Aircall-Signature`. We don't need to influence call routing — Aircall is a softphone, the receptionist's headset rings independently of Coviu.

**3CX, RingCentral:** out of scope. Their webhook shapes vary; the adapter pattern allows future addition without engine changes.

---

## Settings: Phone Integrations page

**Route:** `/settings/phone-integrations`
**Visible to:** practice managers and clinic owners. Complete tier only.
**Tier gating:** the sidebar nav item only appears for Complete-tier orgs.

### Layout

A standard settings page with a list of locations on the left (the existing settings location selector pattern) and the integration form for the selected location on the right.

### Form fields per location

- **Provider** — dropdown: Twilio (only option in v1; Aircall, 3CX, RingCentral grayed out with "Coming soon").
- **Destination number** — E.164 input. The clinic's phone number that will be receiving calls.
- **Webhook URL** — read-only, copyable. Format: `https://{app-domain}/api/calls/inbound/twilio`.
- **Provider credentials** — provider-specific:
  - Twilio: Account SID, Auth Token (used as webhook signing secret), optional Forward-to number (if set, the TwiML response forwards the call to this number).
- **Enabled** — toggle.
- **Test connection** — fires a synthetic `call:incoming` event over the location's Socket.io room with a fake "Test caller" patient summary, so the practice manager can see the screen-pop without making a real call. This is the killer onboarding affordance.

### Validation

- Destination numbers must be unique across all enabled integrations (DB-enforced).
- Saving requires all fields populated.
- The test connection button is disabled until the integration is saved at least once.

---

## Registration package configuration

**Route:** `/settings/registration-packages`
**Visible to:** practice managers and clinic owners. Complete tier only.

This is a small page with one default package per org and optional per-location overrides. Layout mirrors the appointment types editor:

- **Default package** — always present. Practice manager configures: includes_card_capture, includes_consent, form_ids (multi-select from forms library), default_appointment_type_id (optional), SMS template body.
- **Per-location overrides** — collapsible section. Each override is a full registration package config; if set, takes precedence over the org default for that location.

### SMS template

A textarea with merge fields (`{first_name}`, `{clinic_name}`, `{link}`). Default copy:

> Hi, this is {clinic_name}. Tap here to register so we can help you next time you call: {link}

Note the absence of `{first_name}` in the default — the patient hasn't told us their name yet at the time the registration SMS goes out.

---

## Patient profile: calls history panel

A new collapsible panel on the patient profile slide-out (the existing component used by the readiness dashboard). Renders the last 10 calls for the patient, with each row showing:

- Date/time
- Direction (inbound — outbound is v2)
- Duration (formatted)
- Match state (if multi-match, indicates whether this patient was selected)
- Actions fired (e.g. "Sent fact sheet: ADHD Fact Sheet")

Clicking a row expands it to show the full audit (provider, external_call_id, fired_by user, etc.). No call recording or transcription rendering — out of scope.

---

## Real-time event names

The location Socket.io room (existing) gets two new event names:

- **`call:incoming`** — payload: `{ call_id, from_e164, received_at, match: { kind, patient?, candidates? }, summary?: PatientSummary }`. Broadcast on inbound webhook receipt.
- **`call:ended`** — payload: `{ call_id, ended_at, duration_seconds }`. Broadcast on call-ended webhook receipt.

These follow the pattern documented in `docs/claude-project/conventions-realtime-and-state.md`: reuse the location room, add new event names rather than new channels.

The screen-pop subscribes to both. The patient profile calls history panel does not need real-time — it polls or refetches on view.

---

## Edge cases

### Call comes in for a number that matches no integrations

The webhook receiver returns 404. The provider may retry (Twilio does, up to 5 times). After retries exhaust, the call is silently dropped from Coviu's perspective. This is correct behaviour — if no integration is configured, Coviu shouldn't be acting on the call.

### Call comes in for an integration that's disabled

Same as above — receiver returns 404. The provider's actual call routing is unaffected because we're not in the audio path.

### Call comes in but the destination number maps to multiple locations

Heuristic: pick the location with the highest receptionist activity in the past hour. If still ambiguous, broadcast to all matching locations and let whichever receptionist resolves first "claim" the call. The other locations' screen-pops auto-dismiss when the call's `match_state` updates from `pending_match`.

### Receptionist clicks "Send registration package" but the call ends before they finish

The screen-pop does not block on the registration journey completion. Once the receptionist clicks the button, the action is fired and persisted. The call ending dismisses the screen-pop but the `call_actions` row remains. The receptionist can re-find the call in the calls history view if needed.

### Phone number matches a patient, but the receptionist clicks "Search patients" and picks a different patient

The screen-pop's matched-patient context updates. The `calls.matched_patient_id` is updated to the picked patient. The `candidate_patient_ids` is preserved for audit. This handles the family-member-calling-on-behalf-of-patient case — the call is logged against the patient the conversation was about, not the phone number's owner.

### Patient registers via a registration package but the captured phone number differs from the calling phone

Possible if the patient verifies a different number at OTP (e.g. they provided their personal mobile but the registration link went to a shared landline). The capture form's submit creates `patient_phone_numbers` for both numbers. The original calling number is added to the patient as a non-primary contact phone. Future caller ID lookups for that calling number now match.

### Receptionist closes the screen-pop, then realises they need to take an action

The "1 active call" banner stays at the top of the run sheet header until `call:ended`. Clicking it re-opens the screen-pop. After `call:ended`, the banner disappears, but the call is in the calls history view (accessible from the patient profile if a match was made, or from a future global calls history view).

### Two receptionists at the same location both click "Send registration package" simultaneously

Idempotency check on the action dispatch route: if a `registration_journeys` row already exists for the same `call_id`, return the existing row instead of creating a duplicate. The second click is a no-op. The second receptionist sees the same "Sent — waiting for completion" state.

### A registration journey expires before the patient completes it

`registration_journeys.expires_at` defaults to 30 days. After expiry, the journey is marked `expired` and the link returns a "This link is no longer available" page. The patient can call back; the receptionist will see no match (because no patient was created) and can fire a fresh registration package.

### Webhook signature verification fails

Return 401. Do not insert into `calls`, do not broadcast. Log the attempted call and the failure for security audit. This is important — without signature verification, anyone with the webhook URL could spoof a screen-pop on the run sheet.

### Provider sends `call.ended` without ever sending `call.incoming`

Insert a `calls` row retroactively with `match_state = 'pending_match'`, `received_at = ended_at - duration_seconds`, no broadcast. This handles webhook ordering bugs in the provider. Rare.

### A call is in progress when the workflow engine scan runs and tries to fire a `registration_package` action whose journey has already been completed

The handler checks the journey's status before sending the SMS. If `status = 'completed'`, mark the action as `skipped` (already done). This handles the race between the receptionist clicking the action and the patient simultaneously completing a registration that was already in progress.

---

## Affected files

| File | Change |
|---|---|
| `supabase/migrations/020_caller_id_layer.sql` | New migration: phone_integrations, calls, call_actions, registration_packages, registration_journeys, workflow engine extensions for caller_triggered direction. |
| `src/lib/calls/providers/types.ts` | New: `CallProvider` interface, `NormalisedCallEvent` type. |
| `src/lib/calls/providers/twilio.ts` | New: Twilio adapter with parser and signature verifier. |
| `src/lib/calls/providers/registry.ts` | New: `getCallProvider(key)` lookup. |
| `src/lib/calls/lookup.ts` | New: phone-number-to-patients lookup, denormalised patient summary builder. |
| `src/lib/calls/dispatch.ts` | New: helpers to fire each call-triggered action against the workflow engine (resolve patient, create run, create action, return audit row). |
| `src/lib/calls/registration.ts` | New: registration journey lifecycle (create, complete, expire). |
| `src/app/api/calls/inbound/[provider]/route.ts` | New: webhook receiver. |
| `src/app/api/calls/[id]/actions/route.ts` | New: POST endpoint the screen-pop calls when the receptionist clicks an action button. |
| `src/app/api/calls/[id]/resolve/route.ts` | New: PATCH endpoint to update `matched_patient_id` when the receptionist picks a patient from multi-match or search. |
| `src/app/(patient)/register/[token]/page.tsx` | New: registration journey patient-facing page. Mirrors the intake package page, but the first step is capture (not confirm). |
| `src/components/clinic/call-screen-pop.tsx` | New: the slide-over component with three variants (matched single, matched multi, unmatched). |
| `src/components/clinic/call-action-buttons.tsx` | New: the action button row used inside the screen-pop. |
| `src/components/clinic/calls-history-panel.tsx` | New: the patient profile panel listing recent calls. |
| `src/components/clinic/runsheet-shell.tsx` | Modify: subscribe to `call:incoming` / `call:ended`, mount screen-pop. |
| `src/components/clinic/readiness-shell.tsx` | Modify: same subscription as run sheet (receptionists may be on either page). |
| `src/components/clinic/sidebar.tsx` | Modify: add Settings → Phone integrations + Settings → Registration packages nav items (Complete tier, practice_manager + clinic_owner only). |
| `src/app/settings/phone-integrations/page.tsx` | New: settings page. |
| `src/app/settings/registration-packages/page.tsx` | New: settings page. |
| `src/lib/workflows/handlers.ts` | Modify: add handlers for `registration_package`, `call_followup_sms`. Patch existing handlers (`send_file`, `send_sms`, `send_rebooking_nudge`, `intake_package`) to fall back to `patient_id` when `appointment_id` is null. |
| `src/lib/workflows/types.ts` | Modify: add new action types to `ACTION_TYPE_META`, add `caller_triggered` direction, expose `patient_id` on action handler context. |
| `src/lib/workflows/engine.ts` | Modify: when fetching action context, fall back to `patient_id` lookup when `appointment_id` is null. |
| `src/lib/workflows/scanner.ts` | Modify: handle nullable `appointment_id` (do not anchor against `appointment.scheduled_at` for caller-triggered runs). |
| `src/server/socket/index.ts` (or wherever the Socket.io server lives) | Modify: handle the new `call:incoming` / `call:ended` broadcasts on existing location rooms. |
| `src/stores/clinic-store.ts` | Modify: add a `activeCalls` slice keyed by location, plus selectors for the screen-pop. |

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Coviu's role in the phone system | Caller ID and trigger layer, not phone system | Avoids competing with VoIP incumbents. Every VoIP system becomes a feature, not a competitor. |
| Provider integration model | Pluggable adapter, one per provider | Mirrors PMS adapter pattern. Twilio first, others by demand. |
| Call event normalisation | One internal `NormalisedCallEvent` shape, all downstream code provider-agnostic | Keeps provider-specific code at the edge. |
| Trigger surface | Slide-over screen-pop on the location run sheet (and readiness dashboard) | Consistent with existing slide-over patterns. Doesn't steal focus. |
| Call-triggered actions | Schedule existing workflow actions via the engine, with `+1 minute` buffer | No new firing path. Reuses all existing handler, scanner, audit infrastructure. |
| Anchor for patient-only actions | Nullable `appointment_id`, new `patient_id` column on workflow runs and actions | Cleaner than synthetic appointment rows. Constraint enforced via CHECK + trigger_source. |
| Registration package | New journey type sister to intake package | Captures identity before patient exists. Reuses the intake package mental model. |
| Registration package configuration | Per-org default + per-location overrides | Matches Coviu's cascading configuration pattern (org → location → clinician). |
| Multi-match resolution | Picker inside the screen-pop, mirrors the patient entry flow's contact picker | Consistent with how patients resolve identity on their side. |
| Unmatched primary action | Send registration package | The killer demo moment. Cold call → patient registered before they hang up. |
| Persistence | `calls` and `call_actions` tables | Enables patient profile calls history, audit, future analytics. Lightweight — no audio. |
| Real-time channel | Existing location Socket.io room, new event names | Follows realtime conventions. No new channel, no new subscription complexity. |
| Cross-location notification | Out of scope for v1 | Existing run sheet only-shows-the-selected-location constraint applies. |
| Outbound calls | Out of scope for v1 | We are the caller ID, not the dialer. The `direction` column exists for future. |
| Recording / transcription | Out of scope for v1 | Privacy, two-party consent laws, PHI risk. Provider can do this if needed. |
| IVR flows | Out of scope for v1 | Adds complexity; not core to the trigger thesis. |
| Disposition prompts | Out of scope for v1 | Annoying UX. Match state + fired actions are sufficient signal. |
| Unknown providers | 404 from webhook receiver | Don't try to be helpful with unknown shapes. |
| Webhook signature verification | Mandatory, fail closed | Security: anyone with a guessable URL could spoof a screen-pop otherwise. |
| Idempotency on receptionist action clicks | Per-call deduplication on `call_id + action_kind` | Two receptionists clicking the same button = one action. |
| Registration journey expiry | 30 days | Long enough for legitimate slow movers, short enough that stale links don't accumulate. |

---

## Risks and notes

- **The screen-pop must render in well under a second.** A receptionist can't be staring at a loading spinner while a phone is ringing. The denormalised patient summary on the `call:incoming` payload is non-negotiable. If the lookup is slow, the screen-pop should render the unmatched variant immediately and upgrade to matched when the data arrives.

- **Provider webhook latency varies.** Twilio fires its inbound webhook within a few hundred milliseconds of the call ringing. Aircall is similar. 3CX self-hosted can be slow depending on the clinic's network. The screen-pop's "I'm a beat behind the actual ringing" experience is acceptable as long as it's consistent.

- **The `caller_triggered` workflow direction muddies the workflow runs table.** Existing readiness dashboard and run sheet queries filter by `direction in ('pre_appointment', 'post_appointment')`. Caller-triggered runs do not appear in those views. This is intentional but must be maintained in any future dashboard generalisation.

- **Multi-location destination numbers are a real edge case.** Some clinics use one Twilio number routed to multiple sites by IVR. The "highest receptionist activity in the last hour" heuristic is a reasonable v1 default but will need refinement. A per-integration "always route to location X regardless of destination number" override is the most likely v2 improvement.

- **Twilio's TwiML response is the only place where Coviu can affect actual call routing.** If a clinic wants Twilio to forward the call to their landline, we need to return TwiML. If they want the call to ring through Twilio's own routing rules independently of Coviu, we return an empty TwiML. This is the one provider-specific configuration that matters and needs to be exposed in the settings UI.

- **The registration package SMS goes to a phone number we have not yet OTP-verified.** This is fine — the phone OTP step inside the journey verifies it. But it means we can SMS-spam unknown numbers. Rate-limit registration packages per `from_e164` per 24 hours (e.g. max 3) to avoid this being abusable.

- **The `calls` table will grow quickly.** A busy clinic might log 500 calls per day per location. Indexes are on `org_id, received_at DESC` and `matched_patient_id, received_at DESC` to keep the patient profile and history queries fast. Long-term retention policy (e.g. 24-month rolling window) is out of scope for v1 but worth flagging.

- **The handler refactor to support nullable `appointment_id` touches existing code paths.** Pre-appointment intake package, post-appointment pathway actions, etc. all currently assume `appointment_id`. Test coverage for the appointment-anchored paths must be solid before this lands; otherwise caller ID could regress existing flows.

- **Cross-location notification (the unimplemented design in CLAUDE.md) becomes more important once calls are in play.** A receptionist working a multi-location reception desk doesn't want to miss a call ringing at a location they aren't currently looking at. This is flagged in CLAUDE.md as known unimplemented; caller ID gives it a stronger justification.

- **There is no "claim a call" semantic in v1.** If two receptionists at the same location see the same screen-pop, they could both act on it. The idempotency check on action dispatch prevents double-sending, but the social coordination ("Bob, you take this one") is left to the humans. A claim/assign mechanism is plausible v2.

- **Aircall, 3CX, and RingCentral adapters are real product gaps.** The market for a caller-ID-on-top-of-existing-VoIP play is bigger than just Twilio shops. The architecture supports them; the build work is real but bounded (each adapter is roughly the work of the Twilio one). Sequencing depends on customer pull.
