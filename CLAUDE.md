# CLAUDE.md - Coviu Platform Redesign

## Project Overview

This is a prototype for a complete redesign of the Coviu platform. Coviu is the digital front door for allied health and specialist clinics in Australia. It owns the end-to-end digital patient experience from the moment an appointment exists through to post-consultation follow-up, for both telehealth and in-person appointments.

This prototype demonstrates the full platform vision. It is not a production deployment but is built to production standards. The output will be handed to an engineering team for production implementation.

## Tech Stack

- **Frontend**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS with custom Coviu brand tokens
- **Database**: Supabase (Postgres)
- **Auth**: Supabase Auth (email/password for staff, phone OTP for patients)
- **Real-time**: Supabase Realtime (session state changes, run sheet updates)
- **Video**: LiveKit (stand-in for Coviu's proprietary video platform)
- **Payments**: Stripe Connect (Custom Connect, controller properties model)
- **Deployment**: Vercel
- **Font**: Inter (Google Fonts)

## Core Architectural Concepts

### Three Entities: Appointments, Sessions, Rooms

**Appointments** are the planning entity. Created days, weeks, or months in advance by PMS sync (Complete tier) or manual entry (Core tier). The workflow engine acts on appointments. They carry scheduling context: patient, clinician, appointment type, scheduled time.

**Sessions** are the doing entity. Spawned from appointments when the run sheet is built (morning scan). They track the patient's live visit lifecycle: arrival, consultation, payment, outcome selection. On-demand sessions (no pre-existing appointment) are created directly at point of entry. Video calls are ephemeral within sessions.

**Rooms** are organisational containers. They group sessions on the run sheet. A room belongs to a location. Room types: single clinician (Dr Smith's Room), shared clinician (Nurse Room), triage (On-Demand Room), group (Group Therapy Room). Rooms do not hold persistent video connections.

### Session Lifecycle

**Telehealth**: Queued → Waiting → In Session → Complete → Done
**In-person**: Queued → Checked In → Complete → Done

Stored statuses: `queued`, `waiting`, `checked_in`, `in_session`, `complete`, `done`

Derived display states (calculated in real-time, not stored):
- `upcoming`: stored status is `queued`, notification sent, patient hasn't arrived, appointment approaching
- `late`: stored status is `queued`, past appointment time, patient hasn't arrived
- `running_over`: stored status is `in_session`, session exceeded scheduled duration

### Four Entry Points

1. **On-demand link** (Core and Complete, telehealth only): Clinic sends a link. Patient clicks, verifies, session created immediately. No appointment required.
2. **Run sheet manual** (Core and Complete, telehealth only for Core): Receptionist enters appointments night before or morning of. Sessions spawned at run sheet build time.
3. **Run sheet integrated** (Complete only, telehealth and in-person): PMS sync pulls appointments. Workflow engine fires pre-appointment actions. Sessions spawned on the morning of.
4. **QR code** (Complete only, in-person only): Patient scans QR in waiting room, verifies phone, matched to appointment, session activated.

### Core vs Complete Tiers

**Core**: Telehealth and day-of operations. No PMS integration required. Telehealth only (no in-person modality, no QR code check-in).
- On-demand links (telehealth)
- Manual run sheet entry
- Full run sheet (priority hierarchy, auto-collapse, bulk actions, background notifications)
- Telehealth sessions (video via LiveKit)
- One-shot pre-appointment SMS (verify phone, device test, store card) - fires on run sheet save
- Payment processing (Stripe Connect)
- No workflow engine, no forms, no readiness dashboard, no post-appointment automation
- No QR code check-in (Complete only)

**Complete**: Full digital front door. PMS integration required as prerequisite. Telehealth and in-person.
- Everything in Core
- In-person modality support (QR code check-in)
- PMS integration (appointment sync, arrival write-back, payment reconciliation)
- Bidirectional workflow engine (pre and post appointment) - replaces the one-shot SMS
- Form builder
- Intake automation (timed delivery, automated nudges)
- Readiness dashboard
- Post-appointment outcome pathways
- Follow-up automation (PROMs, rebooking nudges, resources)
- AI scribe routing

### Patient Entry Flows

Three entry points, one flow. Regardless of how the patient arrives (SMS link, QR code, or on-demand link), they move through the same linear sequence. Steps are conditionally included based on tier, configuration, and what the patient has already completed.

**Persistent header** (shown on every screen): Clinic logo, clinic name, room name (telehealth always; in-person only on final confirmation screen), dynamic stepper.

**The flow**:
1. **Primer screen** (before stepper): Clinic branding, explain what's coming, set expectations around card capture. "Get started" button. Not a numbered step.
2. **Phone OTP**: Verify phone number ownership via SMS code. Phone may be pre-filled for SMS link entries.
3. **Identity confirmation** (always shown): New patient = capture form (first name, last name, date of birth). Returning patient with one contact = confirm name. Returning patient with multiple contacts = select from list. "Someone else" option always available to add new contacts.
4. **Card capture**: Confirm stored card or capture new one via Stripe Elements. Skipped if clinic has no payments enabled.
5. **Outstanding items**: Device test for telehealth (camera, mic, connection). Outstanding forms for Complete tier. Core telehealth = device test only. Skipped if nothing outstanding.
6. **Arrive**: Telehealth = virtual waiting room (status messages, running-late updates, clinician admits). In-person = "You're checked in" confirmation with room/clinician name.

**Viewport**: Mobile-first, 420px max-width container centred on desktop. One layout, no responsive breakpoints.

**One-shot SMS (Core only)**: When the receptionist saves the run sheet, each patient with a telehealth appointment receives a single SMS: "You have an appointment at [Clinic Name] [tomorrow at Time / today at Time]. Tap here to get ready: [link]". Complete tier replaces this with configurable workflow engine actions sent over days/weeks.

### The Run Sheet

The run sheet is a real-time operational dashboard, not a static schedule. It operates like an airport departure board.

**Location scoping**: The run sheet is always scoped to a single location, determined by the app-level location switcher in the sidebar/top nav. Receptionists and clinicians select which location they are working at. The run sheet shows rooms and sessions for that location only. Multi-location users switch between locations using the app-level switcher, not within the run sheet itself. All clinic-side views (run sheet, readiness dashboard, payments) are scoped to the selected location.

**Layout hierarchy** (two levels):
1. Room container (one per room at the selected location)
2. Session row (within rooms)

**Priority hierarchy** (determines room expansion/collapse):
1. Late (red) - past appointment time, patient hasn't arrived
2. Upcoming not responded (amber soft) - notification sent, patient hasn't acted
3. Waiting / Checked In (amber) - patient is here
4. In Session / Running Over (teal) - call active or appointment happening
5. Complete (blue) - needs processing
6. Queued (gray) - nothing to do yet, room auto-collapses

**Room expansion states**: Three states per room: collapsed (header with status badges only), auto-expanded (shows only sessions causing the expansion), fully expanded (all sessions via "Show all" toggle).

**Bulk actions**: Summary bar shows actionable counts ("3 late", "5 to process"). Receptionist clicks to batch process. Bulk nudge for upcoming patients who haven't responded.

**Background notifications**: Tab title flashing and favicon badge (zero-permission). Optional browser push notifications for top 3 priorities. Notifications fire across ALL assigned locations regardless of which location is currently selected. Clicking a notification switches the location context and scrolls to the relevant session.

**Run sheet management**: One button on the header: "+ Add session." Opens the slide-over panel scoped to the selected location. "Plan tomorrow" toggle lives inside the panel. Same panel for creating, editing, and deleting sessions. Phone number and time only (no patient name, no appointment type). SMS timing: today = immediate, tomorrow saved before 6pm = queued for 6pm, tomorrow saved after 6pm = immediate.

### Clinician Room View

The clinician view is the same run sheet component, filtered to the clinician's assigned rooms at the selected location. Same app-level location switcher if they are assigned to multiple locations.

- Single-room clinicians see their room always expanded with no room header.
- Multi-room clinicians see the standard room expansion/collapse behaviour.
- No summary bar, no bulk actions, no "+ Add session" button, no Plan Tomorrow flow.
- Clinicians can start/end video sessions from their view.
- Solo practitioners without a receptionist can process their own sessions using the same Process flow.

### The Process Flow

Sequential, receptionist-driven:
1. Take payment (card on file, confirm amount, charge)
2. Select outcome pathway (Complete only)
3. Done (session moves to Done, workflow engine takes over for Complete)

Available from `complete` status (both modalities) and from `checked_in` status (in-person only, for early processing).

### Roles

- **Practice Manager / Owner**: Full admin. Org and location config. Workflow templates, form builder, user management, payment settings.
- **Receptionist**: Day-to-day operations. Run sheet, payments, outcome pathway selection. Cannot modify platform config.
- **Clinician**: Session-level access. Starts telehealth calls from run sheet. Preference-level settings only.

### Cascading Configuration

Organisation → Location → Clinician. Org sets defaults. Location can override. Clinician gets preferences within guardrails. Certain categories (payment routing, branding) are locked at org/location level.

### Patient Identity

- Clinic-scoped (no cross-clinic identity)
- Phone number as identity key (OTP verification)
- No patient-facing accounts
- Multi-contact resolution (one phone number → multiple patients within same org)
- Identity capture for new patients: first name, last name, date of birth
- Identity confirmation screen always shown (enables adding new contacts)
- session_participants junction table (supports multi-participant sessions in future, MVP assumes single patient)

### Payments

- Stripe Connect (Custom Connect, controller properties)
- Location-level routing (simple, one bank account per location) or clinician-level routing (granular, independent contractor model)
- Coviu is the EFTPOS machine, PMS is the ledger
- Transaction data pushed back to PMS for reconciliation
- Pure Stripe pass-through, no Coviu margin on transaction fees

## Data Model

### Org Hierarchy
- `organisations` → `locations` → `rooms`
- `users` linked to locations via `staff_assignments` (carries role, employment_type, stripe_account_id)

### Patient
- `patients` (scoped to org via org_id, fields: first_name, last_name, date_of_birth)
- `patient_phone_numbers` (phone numbers linked to patients, supports multi-contact resolution)
- `payment_methods` (patient_id, stripe_payment_method_id, card_last_four, card_brand, card_expiry)

### Scheduling
- `appointment_types` (org-scoped, carries modality, default_fee_cents, pms_external_id)
- `appointments` (the planning entity: patient, clinician, appointment_type, scheduled_at, room_id)

### Sessions
- `sessions` (the doing entity: appointment_id nullable, room_id, status, video_call_id)
- `session_participants` (junction table: session_id, patient_id, role. MVP: one patient per session)

### Workflow Engine (Complete only)
- `workflow_templates` (direction: pre_appointment or post_appointment)
- `workflow_action_blocks` (action_type, offset_minutes, offset_direction, modality_filter, form_id, config)
- `type_workflow_links` (maps appointment_types to workflow_templates, phase: pre or post)
- `outcome_pathways` (linked to post-appointment workflow_templates)
- `appointment_actions` (runtime instances: appointment_id, action_block_id, status, scheduled_for, result)

### Forms (Complete only)
- `forms` (org-scoped, name, description)
- `form_fields` (field_type, label, is_required, options, sort_order)
- `form_submissions` (form_id, patient_id, appointment_id, responses jsonb)

### Payments
- `payments` (appointment_id, patient_id, amount_cents, status, stripe_payment_intent_id, stripe_account_id)

## Key Enums

```sql
user_role: practice_manager, receptionist, clinician
employment_type: full_time, part_time
room_type: clinical, reception, shared, triage
appointment_modality: telehealth, in_person
appointment_status: scheduled, arrived, in_progress, completed, cancelled, no_show
session_status: queued, waiting, checked_in, in_session, complete, done
workflow_direction: pre_appointment, post_appointment
action_type: send_sms, deliver_form, capture_card, send_reminder, send_nudge, send_session_link, send_resource, send_proms, send_rebooking_nudge
action_status: pending, sent, completed, failed, skipped
payment_status: pending, processing, completed, failed, refunded
stripe_routing: location, clinician
```

## Brand System

### Colours (Tailwind config)

```javascript
colors: {
  teal: {
    50: '#E6F9F9',
    500: '#2ABFBF',  // primary
    600: '#1FA8A8',  // primary hover
    700: '#178F8F',  // primary pressed
  },
  amber: {
    500: '#D4882B',  // accent / CTA
    600: '#B8741F',  // accent hover
  },
  gray: {
    50: '#F8F8F6',   // page bg
    100: '#F0EFED',  // card bg
    200: '#E2E1DE',  // borders
    500: '#8A8985',  // secondary text
    800: '#2C2C2A',  // primary text
  },
  red: {
    500: '#E24B4A',  // error / late status
  },
  green: {
    500: '#1D9E75',  // success / ready status
  },
  blue: {
    500: '#3B8BD4',  // complete status
  },
}
```

### Typography

- Font: Inter (Google Fonts)
- Headings: Inter 600, sizes 24px (h1), 20px (h2), 16px (h3)
- Body: Inter 400, 14px, line-height 1.5
- Small/labels: Inter 500, 12px
- Monospace: JetBrains Mono (scheduled times on run sheet)

### Component Patterns

- Cards: white bg, 1px gray-200 border, rounded-xl, subtle shadow on hover
- Primary buttons: teal-500 bg, white text, rounded-lg, hover teal-600
- Secondary buttons: white bg, gray-200 border, gray-800 text
- CTA buttons: amber-500 bg, white text (used sparingly)
- Status badges: rounded-full pills (gray=queued, amber=waiting, teal=in_session, blue=complete, red=late, faded=done)
- Form inputs: white bg, gray-200 border, rounded-lg, focus ring teal-500

## Project Structure

```
src/
  app/
    (auth)/
      login/page.tsx
      signup/page.tsx
    (clinic)/
      dashboard/page.tsx
      runsheet/page.tsx
      readiness/page.tsx
      payments/page.tsx
      layout.tsx
    (patient)/
      entry/[token]/page.tsx
      form/[token]/page.tsx
      waiting/[token]/page.tsx
      pay/[token]/page.tsx
      layout.tsx
    (admin)/
      settings/page.tsx
      workflows/page.tsx
      workflows/[id]/page.tsx
      forms/page.tsx
      forms/[id]/page.tsx
      team/page.tsx
      rooms/page.tsx
      appointment-types/page.tsx
      payments/settings/page.tsx
      layout.tsx
    api/
      webhooks/stripe/route.ts
      cron/daily-scan/route.ts
      pms/sync/route.ts
  components/
    ui/          # Shared primitives
    clinic/      # Clinic-specific components
    patient/     # Patient-facing components
    admin/       # Admin components
  lib/
    supabase/
      client.ts
      server.ts
      middleware.ts
      types.ts   # Generated DB types
    stripe/
      client.ts
      connect.ts
    workflows/
      engine.ts
      scanner.ts
    livekit/
      client.ts
      tokens.ts
  hooks/
    useRealtimeRunsheet.ts
    useRealtimeWaiting.ts
    useLocation.ts
    useOrg.ts
    useRole.ts
  styles/
    globals.css
supabase/
  migrations/
    001_initial_schema.sql
  seed.sql
```

## Conventions

### Naming
- Database tables: snake_case, plural (e.g., `appointments`, `session_participants`)
- Database columns: snake_case (e.g., `scheduled_at`, `org_id`)
- TypeScript types: PascalCase (e.g., `Appointment`, `SessionStatus`)
- React components: PascalCase (e.g., `RunSheet`, `SessionRow`, `ProcessFlow`)
- Hooks: camelCase with `use` prefix (e.g., `useRealtimeRunsheet`, `useRole`)
- API routes: kebab-case (e.g., `/api/daily-scan`, `/api/pms/sync`)
- File names: kebab-case for utilities, PascalCase for components

### Patterns
- Server components by default. Client components only when interactivity is needed (real-time subscriptions, form inputs, interactive elements).
- Supabase server client for data fetching in server components and API routes.
- Supabase browser client for real-time subscriptions in client components.
- Row-Level Security enforced at the database level. Application code should not rely on client-side filtering for security.
- All timestamps in UTC. Display in location timezone.
- All money values in cents (integer). Display formatted with currency symbol.
- Phone numbers in E.164 format.

### Real-Time Subscriptions
- Run sheet updates: subscribe to `runsheet:{selected_location_id}`. When the user switches location via the app-level switcher, unsubscribe from the old channel and subscribe to the new one.
- Background notifications: subscribe to `notifications:{location_id}` for ALL assigned locations (not just the selected one). This ensures tab title flashing and favicon badges fire even when viewing a different location.
- Channel per session for waiting area updates: `waiting:{session_id}`
- Channel per location for payment updates: `payments:{selected_location_id}`
- Subscribe on mount, clean up on unmount. Optimistic local state updates.
- Fallback to 30-second polling if real-time connection drops.

### Error Handling
- Toast notifications for user-facing errors (payment failed, SMS not sent)
- Console logging for development debugging
- Graceful degradation: if real-time drops, show "reconnecting" indicator and fall back to polling
- Loading skeletons for async data, not spinners

## Key Queries

### Run Sheet (today's sessions for a location)
```sql
SELECT s.*, a.scheduled_at, a.appointment_type_id, at.name as type_name,
       p.first_name, p.last_name, r.name as room_name
FROM sessions s
LEFT JOIN appointments a ON s.appointment_id = a.id
LEFT JOIN appointment_types at ON a.appointment_type_id = at.id
LEFT JOIN session_participants sp ON sp.session_id = s.id
LEFT JOIN patients p ON sp.patient_id = p.id
LEFT JOIN rooms r ON s.room_id = r.id
WHERE s.location_id = :location_id
AND s.created_at::date = CURRENT_DATE
ORDER BY a.scheduled_at ASC;
```

### Derived display state (calculated in application code, not SQL)
```typescript
function getDerivedState(session: Session, appointment: Appointment | null): DisplayState {
  if (session.status === 'done') return 'done';
  if (session.status === 'complete') return 'complete';
  if (session.status === 'in_session') {
    if (appointment && isRunningOver(appointment)) return 'running_over';
    return 'in_session';
  }
  if (session.status === 'waiting') return 'waiting';
  if (session.status === 'checked_in') return 'checked_in';
  if (session.status === 'queued') {
    if (appointment && isPastScheduledTime(appointment)) return 'late';
    if (session.notification_sent && !session.patient_arrived) return 'upcoming';
    return 'queued';
  }
  return 'queued';
}
```

### Morning scan (create sessions from today's appointments)
```sql
INSERT INTO sessions (appointment_id, room_id, location_id, status)
SELECT a.id, a.room_id, a.location_id, 'queued'
FROM appointments a
WHERE a.scheduled_at::date = CURRENT_DATE
AND a.location_id IN (SELECT id FROM locations WHERE org_id = :org_id)
AND NOT EXISTS (
  SELECT 1 FROM sessions s WHERE s.appointment_id = a.id
);
```

## Important Notes

- This is a PROTOTYPE. Use test mode for Stripe. Stub SMS delivery for non-auth messages. Log to console for demos.
- LiveKit is a stand-in for Coviu's proprietary video platform.
- Only one PMS integration (Cliniko) will be built. The adapter pattern should make adding others straightforward.
- Multi-participant sessions: the schema supports it via session_participants junction table, but the UI assumes single patient per session.
- The workflow engine is Complete-only. Core uses a simple one-shot SMS notification, not the workflow engine.
- Core tier is telehealth only. No in-person modality, no QR code check-in on Core.
- QR code check-in is Complete tier only.
- One-shot SMS is Core only. Complete tier uses the workflow engine for configurable timed patient communications.
- All patient-facing flows must work on mobile (phone browser). Mobile-first design with 420px max-width container centred on desktop. Clinic-side flows are desktop-primary.
