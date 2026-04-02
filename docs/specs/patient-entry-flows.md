# Patient Entry Flows

**Surface:** Patient-facing entry flow (SMS link tap through to waiting room / check-in confirmation)
**Users:** Patients. They do not create accounts. Phone number is the identity key.
**Available to:** Core (telehealth only) and Complete (telehealth and in-person).
**Real-time:** Yes. Session state updates flow to the run sheet as the patient progresses.
**Priority:** Core patient experience. Required for end-to-end telehealth demo.

The patient entry flow is the digital front door from the patient's perspective. A patient taps a link (or scans a QR code), verifies their identity, stores a card, completes any outstanding items, and arrives in the waiting room or checks in at the clinic. The entire flow runs on the patient's phone.

> The entry point determines the URL. The flow determines the experience.

---

## Prototype Scope

### What We Build (Telehealth First)

- **SMS link entry.** Session token in URL. Appointment exists on run sheet. Patient taps, enters flow.
- **On-demand link entry.** Room token in URL. No appointment. Session created on the fly.
- **The full patient flow.** Primer → Phone OTP → Identity → Card capture → Device test → Virtual waiting room.
- **One-shot SMS.** Core tier notification sent when the receptionist saves the run sheet.
- **Real-time run sheet updates.** Patient progress (name appears, card stored, status transitions) reflected on the run sheet as it happens.

### What We Defer

- **QR code entry (in-person).** Complete tier only. Deferred until in-person modality is built.
- **In-person status flows.** Checked In state, in-person confirmation screen.
- **Form completion step.** Needs the workflow engine and form builder (Complete tier).
- **Workflow engine SMS.** Complete tier timed notifications. Core one-shot SMS only for now.

---

## Design Approach

### Mobile-First, Single Layout

Patients will almost always be on their phone. SMS links open on the phone. QR codes are scanned with the phone camera. Even on-demand links are typically sent via SMS or messaging. The entire flow is designed for a mobile viewport.

On desktop, the same layout renders in a centred container with a max-width of 420px. No responsive breakpoints. No separate desktop layout. One set of components, one set of wireframes. The container sits on the page background colour (#F8F8F6) with the clinic branding visible above the content area.

### Persistent Header

A persistent header sits at the top of every screen in the flow. It provides context and progress.

| Element | Detail |
|---------|--------|
| Line 1 | Clinic logo (uploaded during onboarding). Displayed at a fixed height, centred. |
| Line 2 | Clinic name. Text, centred below the logo. |
| Line 3 | Room name. Shown for telehealth entries (always known from the link). For in-person QR entries (future), shown only on the final confirmation screen after appointment matching. |
| Line 4 | Stepper. A horizontal progress indicator showing the number of steps in this patient's flow. Appears from Step 1 (OTP) onwards. Not shown on the primer screen. |

### Dynamic Stepper

The stepper adjusts its total step count based on what this specific patient needs to complete. If the clinic does not have payments enabled, the card capture step is removed and the total decreases. If the patient has already completed items via the workflow engine (Complete tier, future), those steps are removed. The stepper always reflects the actual number of steps remaining for this patient.

Steps are shown as small filled/unfilled circles or segments. The current step is highlighted in teal. Completed steps are filled. No step labels, just visual progress. The patient sees they are on step 2 of 4 (or 3 of 5, etc.) without needing to know what each step contains.

---

## SMS Notifications (Core Tier)

Core tier clinics send two types of SMS notification. The **prep SMS** gives the patient time to verify their phone, confirm their identity, store a card, and test their device before the appointment. The **invite SMS** is the "join now" nudge sent 10 minutes before the appointment starts. Which SMS a patient receives — or whether they receive both — depends on the gap between when the session is created and when the appointment is scheduled.

### Two SMS Types

| SMS | Purpose | Message | When |
|-----|---------|---------|------|
| **Prep SMS** | Get the patient ready ahead of time. Card capture, device test, identity confirmation. | "Hi — you have an upcoming appointment with [Clinic Name] [tomorrow at Time / today at Time]. Get ready ahead of time so your clinician can focus on you: [link]" | When session is saved, if appointment is 1+ hours away. Subject to timing rules below. |
| **Invite SMS** | Join the session. Appointment is about to start. | "Your appointment with [Clinic Name] starts in 10 minutes. Join here: [link]" | Automated, 10 minutes before scheduled_at. Always sent. |

Both SMS types use the same session entry_token link. The patient enters the same flow regardless of which SMS they tap.

### Which SMS Gets Sent

The gap between run sheet submission and the appointment determines what the patient receives:

| Gap | Prep SMS | Invite SMS | Patient Experience |
|-----|----------|------------|-------------------|
| **1+ hours** | Yes | Yes (at T-10 min) | Patient receives prep SMS, completes flow at their leisure. At T-10 min, invite SMS arrives. If already prepped, they verify OTP and land in the waiting room (details pre-filled). |
| **Less than 1 hour** | No | Yes (at T-10 min) | Not enough time for meaningful prep. Only the invite SMS fires at T-10 min. Patient completes everything on entry. |
| **Less than 10 minutes** | No | Yes (immediately) | Appointment is imminent. Invite SMS fires immediately on session creation. |

### Prep SMS Timing Rules

The prep SMS has special timing logic to avoid sending notifications at antisocial hours:

| Scenario | When Prep SMS Fires |
|----------|---------------------|
| Appointment is today, 1+ hours away | Fires immediately. |
| Appointment is tomorrow, session saved before 6pm | Queued to send at 6pm. Patient has the evening to prepare. |
| Appointment is tomorrow, session saved after 6pm | Fires immediately. |
| Session edited after prep SMS sent | No automatic re-send. Receptionist can manually resend via the run sheet. |
| Session cancelled | Cancellation SMS fires immediately: "Your appointment at [Clinic Name] has been cancelled. Please contact the clinic if you have questions." |

### Invite SMS Timing

The invite SMS is clock-based and automated. It is not triggered by the receptionist.

| Element | Detail |
|---------|--------|
| Trigger | Automated job scans for sessions with `scheduled_at` in the next 10 minutes where the invite has not yet been sent. |
| Timing | Fires at T-10 minutes before `scheduled_at`. |
| Always sent | Regardless of whether the patient has already completed the prep flow. The invite is the "join now" prompt. |
| Idempotent | A flag on the session (`invite_sent`) prevents duplicate sends. |
| Implementation | Cron job or Supabase scheduled function running every minute, checking for sessions approaching their scheduled time. |

### Returning from Prep SMS vs Invite SMS

When a patient taps the link, their experience depends on what they've already completed:

| Prior State | What They See |
|-------------|---------------|
| First time (no prior entry) | Full flow: primer → OTP → identity → card → device test → waiting room. |
| Completed prep (all steps done) | OTP verification (always required) → identity pre-filled and confirmed in one tap → card already stored (skip) → device test already passed (skip) → land in waiting room. |
| Partial prep (some steps done) | OTP verification → remaining incomplete steps only. Completed steps skipped. |

The flow always starts with OTP (phone ownership must be re-verified each session), but returning patients see their name pre-filled for confirmation and their stored card, making it a quick pass-through.

### Complete Tier Comparison

Complete tier clinics do not use the prep SMS or the automated invite SMS. The workflow engine replaces both with configurable timed actions: forms may be sent at T-14 days, card capture at T-7 days, a reminder at T-2 days, and the session link at T-10 minutes. The practice manager configures the timing per appointment type. The patient may receive multiple touchpoints over days or weeks rather than a single prep SMS.

### Integration Point: Session Creation Mutation

The prep SMS is triggered from the session creation mutation (`src/lib/runsheet/mutations.ts`). When `createSessions()` runs:

1. Calculate the gap between now and `scheduled_at`.
2. If gap >= 1 hour: send prep SMS via `smsProvider.sendNotification()`. Set `notification_sent = true` on the session.
3. If gap < 1 hour: skip prep SMS. The invite SMS will fire at T-10 min via the automated job.
4. If gap < 10 minutes: send invite SMS immediately via `smsProvider.sendNotification()`. Set `invite_sent = true`.

The SMS link URL is constructed as: `{APP_URL}/entry/{session.entry_token}`.

---

## Entry Points

There are three ways a patient enters the flow. All three use a single route (`/entry/[token]`) and the handler resolves the token type dynamically. The patient experience from the primer screen onwards is identical.

### Single Route, Dynamic Token Resolution

All entry points use the same URL pattern: `/entry/{token}`. The route handler resolves context by checking the token against tables in order:

1. **Check `sessions.entry_token`** — if match, this is an SMS link entry. Full context (session, room, location, org) resolved immediately.
2. **Check `rooms.link_token`** — if match, this is an on-demand entry. Room, location, and org resolved. No session yet.
3. **Check `locations.qr_token`** (future) — if match, this is a QR code entry. Location and org resolved. No room, no session.
4. **No match** — invalid or expired token. Show error.

This keeps the routing simple (one `[token]` param, one page component) while supporting all entry types through the same flow.

### SMS Link (Core: Telehealth / Complete: Telehealth and In-Person)

| Element | Detail |
|---------|--------|
| Trigger | Patient receives an SMS with a link. Sent by the one-shot notification (Core, telehealth only) or the workflow engine (Complete, telehealth and in-person). |
| URL contains | Session entry token. Maps directly to a specific session on the run sheet. |
| URL format | `/entry/{entry_token}` |
| Appointment context | Known. The session exists. Patient phone number, clinician, room, appointment type, and scheduled time are all resolved. |
| Room name in header | Yes. Known from the session's room assignment. |
| Tier availability | Core: telehealth only. Complete: telehealth and in-person. |

### QR Code (Complete: In-Person Only) — Deferred

| Element | Detail |
|---------|--------|
| Trigger | Patient scans a QR code displayed in the clinic's physical waiting room. One QR code per location, printed on a sign. |
| URL contains | Location QR token. Identifies the clinic location, not a specific session. |
| URL format | `/entry/{qr_token}` |
| Appointment context | Unknown at entry. After phone verification and identity confirmation, the system matches the patient to their scheduled appointment at this location for today. If no match, the patient proceeds as a walk-in. |
| Room name in header | Not initially. Shown on the final confirmation screen after appointment matching. |
| Tier availability | Complete only. In-person only. |

### On-Demand Link (Core and Complete: Telehealth)

| Element | Detail |
|---------|--------|
| Trigger | Clinic sends a unique on-demand link to the patient via SMS, email, or pasted from their PMS. |
| URL contains | Room link token. Identifies the room the patient will join. No pre-existing appointment. |
| URL format | `/entry/{link_token}` |
| Appointment context | None. No appointment exists. A session is created on the fly when the patient completes the flow. |
| Room name in header | Yes. Known from the room token in the URL. |
| Tier availability | Core and Complete. Telehealth only. |

### Entry Point Summary

| Entry Point | URL Token | Token Source | Appointment | Room Known | Session |
|-------------|-----------|-------------|-------------|------------|---------|
| SMS link | Session entry token | `sessions.entry_token` | Yes (pre-existing) | Yes | Already exists on run sheet |
| QR code (deferred) | Location QR token | `locations.qr_token` | Matched after identity step | After matching | Existing session activated, or walk-in created |
| On-demand link | Room link token | `rooms.link_token` | None | Yes | Created during flow |

---

## The Flow

Regardless of entry point, the patient moves through the same linear sequence. Steps are conditionally included based on tier, clinic configuration, modality, and what the patient has already completed.

| Step | Name | Shown When | Output |
|------|------|------------|--------|
| Primer | Welcome | Always | Patient taps "Get started" |
| 1 | Phone Verification | Always | Phone number verified via OTP |
| 2 | Identity | Always | Patient identity confirmed or captured |
| 3 | Card Capture | Payments enabled | Card on file confirmed or captured |
| 4 | Outstanding Items | Items remain (device test for telehealth, forms for Complete) | All items completed |
| 5 | Arrive | Always | Session activated on run sheet |

---

## Primer Screen

The primer screen is the first thing the patient sees after tapping a link or scanning a QR code. It sits before the stepper and before Step 1. Its purpose is to set expectations: the patient understands what is about to happen and why, especially the card capture step which can feel unexpected without context.

### Content

| Element | Detail |
|---------|--------|
| Header | Persistent header: clinic logo, clinic name, room name (if known). |
| Greeting | "Welcome to [Clinic Name]". (For returning patients identified after OTP, the greeting cannot be personalised here since identity is not yet confirmed.) |
| Explanation | A short paragraph explaining the steps: "Before your appointment, we'll ask you to verify your phone number, confirm your details, and store a payment method. This takes about 2 minutes." Adjusted based on configuration (omit payment mention if payments not enabled). |
| Action | Single primary button: "Get started". Teal background (#2ABFBF), full width. |

### Behaviour

- **No stepper on this screen.** The stepper appears from Step 1 onwards.
- **No back button.** This is the entry point. There is nowhere to go back to.
- **Clinic branding sets the tone.** The logo and clinic name reassure the patient this is legitimate. Important for patients who may not recognise "Coviu" as a brand.

---

## Step 1: Phone Verification (OTP)

The patient verifies ownership of their phone number via a one-time password sent by SMS. This is the identity anchor for the entire flow. No passwords, no account creation, no app download.

### Screen: Enter Phone Number

| Element | Detail |
|---------|--------|
| Input | Phone number field with country code prefix (+61 default for AU). Auto-focused on load. |
| Pre-fill | For SMS link entries, the phone number may be pre-filled from the session data (the receptionist entered it when creating the session). The patient confirms and sends the code. For on-demand entries, the field starts empty. |
| Action | "Send code" button. Fires the OTP SMS. |
| Validation | Basic format validation before sending. Invalid numbers show inline error. |

### Screen: Enter Code

| Element | Detail |
|---------|--------|
| Input | 6-digit code input. Auto-advancing between digits. Auto-submits on final digit entry. |
| Resend | "Resend code" link. Disabled for 30 seconds after sending. Shows countdown timer. |
| Wrong number | "Wrong number?" link below the input. Returns to the phone number entry screen. |
| Validation | Incorrect code shows inline error: "That code didn't match. Try again." Three failed attempts show: "Too many attempts. Tap resend for a new code." |

### Backend

- **OTP generation:** 6-digit numeric code. Valid for 5 minutes. Invalidated on use.
- **Rate limiting:** Max 3 OTP sends per phone number per 10-minute window.
- **Phone lookup:** After successful verification, the system checks if this phone number has existing patient contacts at this clinic (organisation). The result determines what Step 2 shows.
- **Custom OTP, not Supabase Auth:** Patients are not Supabase auth users. They verify phone ownership at the application level, not the auth level. OTP is managed via a `phone_verifications` table (see Data Requirements), not Supabase Auth phone OTP. This avoids creating auth sessions for patients and removes the Twilio/Supabase phone provider configuration dependency.
- **SMS delivery:** Uses a pluggable SMS provider interface (`SmsProvider`) with two methods: `sendOtp()` and `sendNotification()`. A factory function reads `SMS_PROVIDER` from env to select the implementation. For development, a stub provider logs OTP codes and notification messages to the console. For production, a Vonage implementation calls their API. The same interface covers both OTP codes (patient verification) and one-shot notification SMS (run sheet saves).
- **Prototype approach:** SMS delivery is stubbed for development. OTP codes are logged to the console. Set `SMS_PROVIDER=vonage` with credentials to enable real delivery.

---

## Step 2: Identity Confirmation

After phone verification, the patient confirms or provides their identity. This step always appears, regardless of whether the patient is new or returning. It serves dual purposes: confirming who the appointment is for, and allowing patients to add new people (children, family members) to their phone number.

### Scenario: New Patient (No Existing Contacts)

The patient has never verified at this clinic before. There are no patient contacts under this phone number. The screen shows a simple capture form.

| Element | Detail |
|---------|--------|
| Fields | First name (required), last name (required), date of birth (required). |
| Date of birth input | Day/month/year fields (or date picker). Used for identity verification. |
| Action | "Continue" button. Creates the patient contact and links it to the session. |
| Phone number | Already captured from Step 1. Not shown again. Stored against the new patient contact automatically. |

### Scenario: Returning Patient (One Existing Contact)

The patient has verified at this clinic before. One patient contact exists under this phone number.

| Element | Detail |
|---------|--------|
| Display | "Is this appointment for [First Name Last Name]?" with the patient's name prominently displayed. |
| Primary action | "Yes, that's me" button. Confirms identity and advances to Step 3. |
| Secondary action | "Someone else" link below the primary button. Opens the new patient capture form (same fields: first name, last name, date of birth). |

### Scenario: Returning Patient (Multiple Contacts)

Multiple patient contacts exist under this phone number at this clinic. Common for parents managing appointments for multiple children.

| Element | Detail |
|---------|--------|
| Display | "Who is this appointment for?" with a list of existing patient names. Each name is a tappable card. |
| Selection | Tapping a name selects it and advances to Step 3. |
| Add new | "Someone else" option at the bottom of the list. Opens the new patient capture form. |

### Backend

- **Patient contact creation:** New contacts are created within the organisation scope. The patient contact is linked to the verified phone number via `patient_phone_numbers`. No cross-clinic identity.
- **Session linking:** The selected or newly created patient contact is linked to the session via the `session_participants` junction table. The run sheet updates in real-time to show the patient name.
- **QR code appointment matching (future):** For QR code entries, after identity confirmation the system matches the patient contact + today's date + this location to find a scheduled appointment. If found, the existing session on the run sheet is activated. If no match, an on-demand session is created in the triage/on-demand room.

---

## Step 3: Card Capture

The patient stores a payment method for post-session billing. This step is skipped entirely if the clinic does not have Stripe Connect enabled. The stepper adjusts accordingly.

### Scenario: No Card on File

| Element | Detail |
|---------|--------|
| Context text | "[Clinic Name] collects payment after your appointment. Please store a card so your clinician can focus on your care." |
| Input | Stripe Elements card input (card number, expiry, CVC). Embedded inline, styled to match the flow. |
| Action | "Save card" button. Calls Stripe to tokenise and store the card via the clinic's Stripe Connect account. |
| Skip option | No skip. If the clinic has payments enabled and requires card on file, this step is mandatory. If the card capture fails, the patient can retry. The receptionist can handle payment manually post-session if needed. |

### Scenario: Card Already on File

| Element | Detail |
|---------|--------|
| Display | "Card on file: Visa ending 4242" with card brand icon and last four digits. |
| Primary action | "Continue with this card" button. Advances to Step 4. |
| Secondary action | "Use a different card" link. Expands the Stripe Elements card input below. |

### Backend

- **Stripe integration:** Card is tokenised and stored as a Stripe PaymentMethod against the clinic's Connected Account. The PaymentMethod ID is stored in the `payment_methods` table against the patient contact.
- **Returning patients:** Card details persist across visits within the same clinic. The patient does not need to re-enter their card for subsequent appointments.
- **Session update:** Once a card is stored, the session's readiness indicator on the run sheet updates from "No card" to "Ready" (or partial ready if other items remain).
- **Prototype:** Use Stripe test mode. Test card numbers (4242 4242 4242 4242) for all demos.

---

## Step 4: Outstanding Items

This step surfaces anything the patient still needs to complete before their appointment. The content varies by tier and modality. If there are no outstanding items, this step is skipped entirely and the stepper adjusts.

### Device Test (Telehealth Only)

For telehealth appointments, the patient runs a quick device readiness check.

| Check | Detail |
|-------|--------|
| Camera | Request camera permission. Show the patient's camera feed in a small preview. Green tick if working. If permission denied, show instructions for enabling it in browser settings. |
| Microphone | Request microphone permission. Show an audio level indicator (bouncing bar). Green tick if detecting input. If permission denied, show instructions. |
| Connection | Run a basic connectivity test against the video infrastructure. Green tick if latency and bandwidth are acceptable. Warning if marginal. Error if insufficient. |
| Action | "Looks good" button when all checks pass. If a check fails, show troubleshooting guidance and a "Continue anyway" fallback. The clinician is notified on the run sheet that the device test had issues. |

### Forms (Complete Tier Only) — Deferred

The workflow engine may have assigned forms to this appointment that the patient has not yet completed.

| Element | Detail |
|---------|--------|
| Display | List of outstanding forms. Each shows the form name and estimated completion time. Completed forms show a green tick. |
| Interaction | Tapping a form opens it inline within the flow. The patient completes the form and returns to the checklist. Progress is saved per field. |
| Completion | When all forms are complete, the "Continue" button becomes active. |

### Tier Behaviour

| Tier | Modality | What Shows |
|------|----------|------------|
| Core | Telehealth | Device test only. No forms. |
| Core | In-person (future) | Step skipped entirely. No device test, no forms. |
| Complete | Telehealth | Device test + any outstanding forms. |
| Complete | In-person (future) | Outstanding forms only. No device test. |

---

## Step 5: Arrive

The final step. The patient has verified their phone, confirmed their identity, stored their card, and completed any outstanding items. The experience diverges by modality.

### Telehealth: Virtual Waiting Room

The patient lands in the virtual waiting room. The stepper is replaced by a waiting state. The patient stays on this screen until the clinician admits them into the video call.

| Element | Detail |
|---------|--------|
| Header | Persistent header remains: clinic logo, clinic name, room name. |
| Status message | "You're in the waiting room. [Clinician name] will be with you shortly." Dynamic, updated in real-time via Supabase Realtime subscription on the session. |
| Running late | If the clinician sends a running-late message (quick-tap preset from the run sheet), it appears here: "Dr Smith is running about 5 minutes behind. Thank you for your patience." |
| Outstanding items | If any items were skipped or failed (e.g., device test had warnings), a small banner reminds the patient to address them while waiting. |
| Session start | When the clinician clicks Admit on the run sheet, the video call launches. The waiting room transitions to the video interface (LiveKit for prototype). |

### In-Person: Checked In Confirmation — Deferred

The patient sees a simple confirmation screen. The phone becomes passive at this point.

| Element | Detail |
|---------|--------|
| Display | "You're checked in." Large green tick. Clinic logo above. |
| Room context | "Your appointment is with [Clinician Name] in [Room Name]. Please take a seat." |
| Fallback | If no appointment match was found (walk-in), the message adjusts: "You've checked in at [Clinic Name]. A staff member will be with you shortly." |
| Run sheet update | The session transitions from Queued to Checked In. The receptionist sees the patient appear on the run sheet. |

### Session State Transitions at Arrive

| Entry Point | Modality | Session Transition |
|-------------|----------|--------------------|
| SMS link | Telehealth | Queued → Waiting. Patient enters virtual waiting room. |
| SMS link (future) | In-person | Queued → Checked In. Patient sees confirmation screen. |
| QR code (future) | In-person | Queued → Checked In (if matched). Or new session created in triage room (walk-in). |
| On-demand link | Telehealth | New session created → Waiting. Patient enters virtual waiting room. |

---

## Data Requirements

### Tables

| Table | Role in Patient Entry |
|-------|----------------------|
| `patients` | Patient contacts. Scoped to organisation via org_id. Fields: id, org_id, first_name, last_name, date_of_birth. |
| `patient_phone_numbers` | Phone numbers linked to patients. Fields: id, patient_id, phone_number, is_primary, verified_at. One phone can link to multiple patients within an org (multi-contact resolution). The `verified_at` timestamp tracks when the number was last verified via OTP. |
| `phone_verifications` | **New table.** Application-level OTP tracking. Fields: id, phone_number, code (6-digit), expires_at, verified_at, session_id (nullable, links to the session being entered), created_at. One active code per phone number at a time. |
| `sessions` | Session records. Status field updated through the flow (queued → waiting). Entry token in URL maps to a specific session. `notification_sent` tracks prep SMS. `invite_sent` (new column) tracks the 10-min invite SMS. |
| `session_participants` | Junction table linking sessions to patients. Updated at Step 2 when identity is confirmed. |
| `payment_methods` | Stored card references. Fields: id, patient_id, stripe_payment_method_id, card_brand, card_last_four, card_expiry. |
| `rooms` | Room records. The link_token on a room is used for on-demand entry URLs. |
| `locations` | Location records. The qr_token on a location is used for QR code entry URLs (future). |
| `organisations` | Organisation records. Logo and name used in persistent header. |

### Schema Changes

- **Add `verified_at` to `patient_phone_numbers`:** `ALTER TABLE patient_phone_numbers ADD COLUMN verified_at TIMESTAMPTZ`. Updated when the patient completes OTP verification. Used to determine returning patient status for multi-contact resolution.
- **Add `invite_sent` to `sessions`:** `ALTER TABLE sessions ADD COLUMN invite_sent BOOLEAN NOT NULL DEFAULT false`. Tracks whether the 10-minute invite SMS has been sent. Prevents duplicate sends.
- **Create `phone_verifications` table:** Stores OTP codes for patient phone verification. Not part of Supabase Auth — this is application-level verification since patients are not auth users.

```sql
CREATE TABLE phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_phone_verifications_phone ON phone_verifications(phone_number);
```

### SMS Provider

SMS delivery uses a pluggable provider interface supporting two methods: `sendOtp()` for patient phone verification and `sendNotification()` for one-shot run sheet notifications. A factory function reads `SMS_PROVIDER` from env to select the implementation.

| Provider | When | Behaviour |
|----------|------|-----------|
| `console` (default) | Development | Logs OTP codes and notification messages to the terminal. No SMS sent. |
| `vonage` | Production | Calls Vonage SMS API with configured credentials. |

Set `SMS_PROVIDER=vonage` with `VONAGE_API_KEY` and `VONAGE_API_SECRET` in `.env.local` to enable real delivery.

### Token Resolution

When a patient hits `/entry/{token}`, the handler resolves context by checking the token against tables in order:

| Check Order | Table | Column | Result |
|-------------|-------|--------|--------|
| 1 | `sessions` | `entry_token` | SMS link entry. Full context resolved (session → room → location → org). |
| 2 | `rooms` | `link_token` | On-demand entry. Room context resolved (room → location → org). No session yet. |
| 3 (future) | `locations` | `qr_token` | QR code entry. Location context resolved (location → org). No room, no session. |
| — | No match | — | Invalid or expired token. Show error. |

### Real-Time Updates to Run Sheet

As the patient progresses through the flow, the run sheet updates in real-time via Supabase Realtime:

| Flow Step | Run Sheet Update |
|-----------|-----------------|
| Step 1: Phone verified | No visible change. Backend: phone verification recorded. |
| Step 2: Identity confirmed | Patient name appears on the session row (replacing phone number placeholder). |
| Step 3: Card stored | Readiness indicator updates: "No card" → "Ready" (or partial if other items outstanding). |
| Step 4: Items completed | Readiness indicator updates: "Pending" → "Ready" as items are completed. |
| Step 5: Arrive (telehealth) | Session status: Queued → Waiting. Room auto-expands on the run sheet. Admit button appears for the clinician. |
| Step 5: Arrive (in-person, future) | Session status: Queued → Checked In. Room auto-expands on the run sheet. |

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Patient taps expired or invalid session link | Show message: "This link has expired or is no longer valid. Please contact [Clinic Name]." No entry into the flow. |
| Patient verifies phone but appointment has been cancelled | After phone verification, the system detects the cancellation. Show: "This appointment has been cancelled. Please contact [Clinic Name] if you have questions." |
| Two patients share a phone number | After OTP verification, Step 2 shows multi-contact resolution: "Who is this appointment for?" with a list of patient names under this phone number. |
| Patient loses connection mid-flow | Progress is saved per step. Returning to the link resumes from the last completed step. Phone verification does not need to be repeated within the OTP validity window. |
| Card capture fails (Stripe error) | Inline error message. Patient can retry with the same or a different card. If repeated failures, the patient can contact the clinic. The receptionist handles payment manually post-session. |
| Patient completed all pre-appointment items via workflow (Complete tier, future) | Steps 3 and 4 are skipped. Patient goes from identity confirmation directly to Arrive. The stepper reflects the reduced step count. |
| Patient's stored card has expired | Step 3 shows the expired card with a notice: "This card has expired." Stripe Elements input shown for a new card. Old card reference is replaced. |
| On-demand patient: no appointment type, no default fee | Card capture still occurs if payments are enabled (card is stored for future use). No fee context shown. The receptionist enters the amount manually during the Process flow. |
| Patient's phone does not support camera (telehealth device test) | Device test shows camera as unavailable. Warning message. "Continue anyway" option. The clinician is notified on the run sheet that the device test had issues. |
| Patient completes flow but clinician is not yet available | Patient sits in the virtual waiting room. Status message updates. If the clinician sends a running-late message, it appears on screen. No timeout. |
| QR code scan but no matching appointment (future) | On-demand session created in triage room. Patient sees: "You've checked in at [Clinic Name]. A staff member will be with you shortly." |

---

## Accessibility

- **Touch targets:** All buttons and interactive elements meet minimum 44x44px touch target size. Critical for patients with motor difficulties, especially elderly patients common in allied health.
- **Font sizing:** Minimum 16px body text to prevent auto-zoom on iOS. Input fields use 16px or larger to avoid the zoom-on-focus behaviour.
- **Colour contrast:** All text meets WCAG AA contrast ratio. Status indicators (green ticks, red errors) use both colour and icon to avoid reliance on colour alone.
- **Screen reader:** All form inputs have associated labels. The stepper uses aria-current for the active step. Error messages use aria-live regions for immediate announcement.
- **Auto-focus:** Each screen auto-focuses on the primary input field. The OTP code input auto-focuses on load. Auto-submit on final digit reduces taps.
- **Keyboard:** Full keyboard navigation for desktop users. Tab order follows the visual flow. Enter submits the current step.

---

## Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entry flow structure | Unified linear flow, single `/entry/[token]` route | One route, dynamic token resolution. Handler checks sessions → rooms → locations in order. One set of components regardless of entry point. |
| Phone verification | Custom OTP (not Supabase Auth phone) | Patients are not auth users. Application-level verification via `phone_verifications` table. Avoids creating Supabase auth sessions for patients. |
| SMS delivery | Pluggable provider (console stub / Vonage) | Same interface for OTP and notifications. Console logging for dev, Vonage for production. Flip via `SMS_PROVIDER` env var. |
| Identity step | Always shown, even for returning single-contact patients | Enables "Someone else" option for adding new contacts (children, family). Confirmation is fast for single contacts. |
| Card capture | Mandatory when payments enabled, no skip | Ensures card is on file for seamless post-session payment. Reduces payment chasing. |
| Device test | Telehealth only, inside Outstanding Items step | Camera/mic check prevents failed consultations. Grouped with other pre-appointment items. |
| Stepper | Dynamic step count, no labels | Adjusts to actual steps for this patient. Clean visual progress without cognitive overhead. |
| Primer screen | Before stepper, not a numbered step | Sets expectations without adding to the perceived step count. |
| One-shot SMS | Core tier only, fires on run sheet save | Core has no workflow engine. Single notification is the only patient touchpoint. Complete tier uses configurable workflow actions instead. |
| QR code | Complete tier only, deferred | In-person modality is Complete only. QR scan triggers the same unified flow with appointment matching after identity confirmation. |
| Mobile-first | 420px max-width, no responsive breakpoints | Patients are on their phones. One layout, one set of components. Desktop gets the same thing centred. |
| Virtual waiting room | Real-time status via Supabase Realtime | Patient sees live updates. Running-late messages from clinician appear immediately. Admit triggers video call launch. |
| No geolocation | QR code scan is the arrival trigger, not GPS | Geolocation requires app-level permissions and is unreliable without a native app. QR scan is simple, deliberate, and works in any mobile browser. |
