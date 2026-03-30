# Feature Spec: The Run Sheet

## Overview

| Field | Value |
|-------|-------|
| Surface | Run Sheet (receptionist's primary operational view) |
| Users | Receptionists (primary), clinicians (room-scoped view) |
| Available to | Core and Complete tiers (identical run sheet) |
| Real-time | Yes. Supabase Realtime subscriptions for session state changes. |
| Priority | Week 1-2 of build plan. Foundation feature. |

The run sheet is the operational heart of the Coviu platform. It is a real-time dashboard that displays today's sessions organised by room at the selected location, colour-coded by time-aware status, with priority-driven auto-collapse. It is not a static schedule. It dynamically surfaces what needs attention as the day unfolds.

> The receptionist opens the run sheet in the morning and it becomes their operational command centre for the day. In-person check-ins, telehealth arrivals, late patients, sessions to process: everything surfaces here.

---

## Layout Hierarchy

The run sheet is always scoped to a single location, determined by the app-level location switcher. Two-level hierarchy:

| Level | Element | Visible When | Collapsible |
|-------|---------|-------------|-------------|
| 1 | Room container | Always. One per room at the selected location. | Three states: collapsed (header only), auto-expanded (shows only sessions causing the expansion), fully expanded (shows all sessions via toggle). |
| 2 | Session row | When room is auto-expanded or fully expanded. | Auto-expand shows only actionable sessions. Queued and done sessions hidden behind toggles until fully expanded. |

The clinician's view is a filtered version of the same component. If assigned to one room, it is always expanded. If assigned to multiple rooms, the smart filtering and priority hierarchy apply.

---

## Components

### Page Header

| Element | Detail |
|---------|--------|
| Left side | "Run sheet" title. Today's date and current location name. Live clock updating every second. |
| Right side | "+ Add session" button (teal, primary). This is the only action button on the run sheet header. |
| Behaviour | The run sheet always shows today's live data for the selected location. Clicking "+ Add session" opens the slide-over panel for adding sessions at the selected location. To switch locations, the receptionist uses the app-level location switcher. |

### Summary Bar

Fixed at the top of the run sheet below the page header. Shows aggregate counts for the selected location.

**Informational Counts (Left)**

- **Total**: All sessions for today at the selected location.
- **Late**: Sessions in the late derived state. Red text.
- **Waiting**: Sessions in waiting or checked_in status. Amber text.
- **Active**: Sessions in in_session status. Teal text.
- **Process**: Sessions in complete status. Blue text.

**Bulk Action Buttons (Right)**

- **Call now (red bg)**: Count of late patients. Clicking opens the bulk call/remind flow. Only visible when count > 0.
- **Nudge (amber bg)**: Count of upcoming patients who haven't responded. Clicking bulk resends join notifications. Only visible when count > 0.
- **Bulk process (blue bg)**: Count of sessions needing processing. Clicking opens the slide-over Process panel on the first session that needs processing. Only visible when count > 0.

**Interaction**: Clicking any informational count scrolls to and highlights the first session matching that status. Clicking a bulk action button opens the appropriate bulk flow.

### Room Container

The primary grouping element. One per room. Contains a header and a list of session rows.

**Room Header**

| Element | Detail |
|---------|--------|
| Content | Chevron (expand/collapse), room name, assigned clinician name, status badges (late, waiting, active counts), total session count |
| Click action | Toggle expand/collapse of the session list |
| Badges | Only show non-zero counts. Late badge is red. Waiting badge is amber. Active badge is teal. |

**Room Expansion States**

- **Collapsed**: Room shows header only with status badges. The receptionist sees at a glance what is happening ("1 late", "2 waiting", "3 queued"). No session rows visible.
- **Auto-expanded (filtered)**: Room opens automatically when a session enters an attention state. Only the sessions causing the expansion are shown. If one patient is late, that one row is visible. A "Show all (X sessions)" toggle sits below to reveal everything else.
- **Fully expanded**: The receptionist clicks the "Show all" toggle. All sessions are visible, ordered by priority: late first, then upcoming, then waiting, then in session, then complete, then queued, then done (faded).

**Auto-Expansion Triggers**

- **All queued or done**: Room stays collapsed. Nothing needs attention.
- **Any late or upcoming (not responded)**: Room auto-expands showing only those sessions.
- **Any waiting or checked_in**: Room auto-expands showing only those sessions.
- **Any complete (needs processing)**: Room auto-expands showing only those sessions with Process button.
- **Running over**: Room auto-expands showing the running-over session.
- **Manual override**: Receptionist can click the room header to collapse or fully expand at any time. Manual state persists until a new state change triggers re-evaluation.

### Session Row

Each session is a row within its room container.

**Row Columns**

| Column | Content | Style |
|--------|---------|-------|
| Time | Scheduled appointment time | Monospace font (JetBrains Mono). 11px. Bold. |
| Patient | Patient full name (bold) + appointment type (muted below) | Name: 12px 600. Type: 10px secondary colour. |
| Status | Status badge with colour dot and label | Pill badge. Colour determined by derived display state. |
| Mode | Modality badge: TH (telehealth) or IP (in-person) | Small pill. TH = teal bg. IP = gray bg. |
| Ready | Readiness indicator | Green "Ready" if all prep items complete. Amber text if items outstanding ("No card", "Pending"). |
| Action | Contextual action button | Only appears for actionable states. |

**Row Background Tinting**

| Derived State | Background Tint |
|---------------|----------------|
| Late | Soft red (#FFF5F5) |
| Upcoming (not responded) | Soft amber (#FFFCF5) |
| Waiting / Checked In | Soft amber (#FFFCF5) |
| In Session | Soft teal (#F4FDFD) |
| Complete | Soft blue (#F5F9FE) |
| Queued | No tint (white) |
| Done | No tint, reduced opacity (0.4) |

**Action Buttons**

| State | Button | Colour | Action |
|-------|--------|--------|--------|
| Late | Call | Red (#E24B4A) | Opens call/remind options for this patient |
| Upcoming | Nudge | Amber (#D4882B) | Resends the join notification SMS to the patient |
| Waiting (telehealth) | Admit | Teal (#2ABFBF) | Starts the video session, admits patient from waiting area |
| Complete | Process | Blue (#3B8BD4) | Opens the slide-over Process panel for this session |
| Checked In (in-person) | Process | Blue (#3B8BD4) | Opens Process panel (available early, before auto-complete) |
| Queued | None | - | No action available yet |
| In Session | None | - | Session is active, no receptionist action |
| Done | None | - | Fully processed |

### Session Visibility Toggles

When a room is auto-expanded (filtered), two toggles may appear below the visible sessions:

- **"Show all (X sessions)"**: Reveals all sessions in the room. Switches the room from auto-expanded to fully expanded. Sessions are ordered by priority.
- **"X completed"**: When fully expanded, done sessions sit at the bottom behind this toggle. Clicking reveals them with reduced opacity (0.4).

---

## The Process Flow (Slide-Over Panel)

When the receptionist clicks Process on a session row, a slide-over panel appears from the right side of the screen. The run sheet remains visible behind it (dimmed).

### Panel Layout

| Element | Detail |
|---------|--------|
| Position | Fixed to the right edge. 360px wide. Full height. Border-left separator. |
| Header | "Process session" title. Close button (X) to dismiss. |
| Step indicator | Three steps shown as numbered circles: 1 Payment, 2 Outcome, 3 Done. Active step highlighted in teal. Completed steps in green. |
| Body | Content changes based on the active step. |

### Step 1: Payment

- **Patient context**: Name, appointment type, modality, scheduled time.
- **Amount**: Pre-populated from the appointment type default fee. Displayed prominently. Edit button to adjust.
- **Card on file**: Displays stored card (brand icon, last four, expiry). If no card on file, shows "No card stored."
- **Primary action**: "Charge $X.XX" button. Teal background.
- **Fallback action**: "Send payment request instead" button. Secondary style. Sends the patient a "tap to pay" SMS link.
- **Skip option**: If the clinic doesn't use Coviu payments, this step shows a "Skip payment" link that advances to Step 2.

### Step 2: Outcome Pathway (Complete Only)

- **Available pathways**: List of outcome pathways configured for this appointment type. Each shown as a selectable card with name and description.
- **Selection**: Receptionist taps one. It highlights. "Confirm" button advances to Step 3.
- **Core tier**: This step is skipped entirely. The panel advances from Step 1 directly to Step 3.

### Step 3: Done

- Confirmation screen. "Session processed" with a check mark.
- Session moves to Done on the run sheet.
- When triggered from a single session row: panel auto-closes after 2 seconds, or the receptionist clicks "Close."
- When triggered from the bulk action button: panel advances to the next session that needs processing.

### Processing Multiple Sessions

When the receptionist clicks "Bulk process" from the summary bar, the slide-over opens on the first session that needs processing. After completing the Process steps, the panel automatically loads the next session instead of closing. The receptionist works through them sequentially. They can close the panel at any time to stop.

This is the same Process flow, not a separate mode. The only difference is what happens after Step 3: single session = panel closes, bulk = panel advances to next session.

---

## Run Sheet Management

### Today vs Tomorrow

The run sheet always shows today. It never switches to a different day. The today/tomorrow toggle lives inside the add sessions slide-over panel.

| Context | Behaviour |
|---------|-----------|
| Run sheet | Always shows today's live data. Real-time updates, derived states, auto-expand, action buttons, Process flow. Does not change when the receptionist toggles between today and tomorrow in the panel. |
| Add sessions panel (default) | Opens scoped to today. Panel header shows "Add sessions" with today's date. Sessions added here appear on today's run sheet immediately. SMS fires immediately. |
| Add sessions panel (Plan tomorrow) | A "Plan tomorrow" button inside the panel header switches context to tomorrow. The date updates. If tomorrow already has sessions, a count is shown. Sessions added here are for tomorrow. SMS queues based on timing logic. |
| Switching back | A "Back to today" link in the panel header switches back to today's context. The receptionist can toggle freely without closing the panel. |

### Adding Sessions (Unified Panel)

Both "+ Add session" (today) and "Plan tomorrow" use the same slide-over panel. The only difference is the date context. The panel header shows which day sessions are being added to. The SMS timing logic adjusts based on the day (today: immediate, tomorrow: queued for 6pm or immediate if past 6pm).

The panel shows rooms at the currently selected location with checkboxes. It is bulk by default. Each active room shows patient entry rows (phone number + time). Adding a single session to today is the same flow as building tomorrow's entire schedule: same interface, different scale.

**Slide-Over: Add Sessions**

| Element | Detail |
|---------|--------|
| Room selection | Rooms at the selected location are listed with checkboxes and assigned clinician names. Tick rooms that are active for the day. Unticked rooms are hidden. Each ticked room expands to show the patient entry area. |
| Patient entry | Under each active room: rows of phone number (with country code prefix, +61 default) and time. "+ Add patient" adds more rows. Delete button removes a row. No patient name required. Name is captured when the patient verifies and creates their contact. |
| Save action | "Save sessions (N)" button at the bottom shows the total count across all rooms. Creates appointments and sessions. SMS fires based on timing logic (today: immediate, tomorrow: queued for 6pm). |

The flow is phone number and time per patient, grouped by room. Under 30 seconds per patient.

### Editing Sessions

Clicking a session row on the run sheet opens the same "Add sessions" slide-over panel, pre-populated with the current run sheet data. The receptionist sees the rooms with their existing patient entries (phone numbers and times). They edit inline: change a time, change a phone number, delete a row, add a new row. Save updates everything.

There is no separate edit view. The panel is always the same panel whether the receptionist clicked "+ Add session" in the header or clicked an existing session row. The only difference is pre-population.

**Destructive Actions**

- **Delete a row**: Removes the session from the run sheet. If the patient has been notified, a cancellation SMS is sent. Confirmation required.
- **Mark no-show**: Available for late patients. A contextual action on the row. Marks the session as no-show (a variant of done). No SMS sent. Recorded for reporting.

**Clinician Click Behaviour**: When a clinician clicks a session row from their room view, it navigates them to the full run sheet for today, scrolled to that session in context. It does not open the slide-over panel. Clinicians cannot edit session details, change rooms, or cancel sessions.

### Planning Tomorrow

Inside the add sessions slide-over, the receptionist clicks "Plan tomorrow." The panel context switches to tomorrow. The date updates. If tomorrow already has sessions at the selected location, the panel shows a count and lists the existing entries. The receptionist can add more, edit, or delete.

Once tomorrow's sessions are saved, the receptionist can re-open the panel, click "Plan tomorrow," and see what they have prepared. Changes do not re-trigger SMS unless the receptionist explicitly clicks "Resend notification."

### Room Access Permissions

| Role | Room Visibility | Can Add/Edit Sessions |
|------|----------------|----------------------|
| Receptionist | All rooms at their assigned location(s) | Yes, for any room they can see |
| Clinician | Only their assigned room(s) | Yes, for their assigned room(s) only |
| Practice Manager | All rooms across all locations in the org | Yes, for any room |

The app-level location switcher determines which location's rooms are visible. Within that location, room checkboxes in the add sessions panel are filtered by role permissions.

### SMS Notification Logic

| Scenario | When SMS Fires |
|----------|---------------|
| Session added to today | Immediately. Patient needs to prepare now. |
| Session edited today (time change) | Immediately. Patient receives updated time notification. |
| Tomorrow's run sheet saved before 6pm | Queued to send at 6pm. Patients have the evening to prepare. |
| Tomorrow's run sheet saved after 6pm | Immediately. Late preparation, patients need notification now. |
| Tomorrow's session edited after initial save | No automatic re-notification. Receptionist can manually click "Resend notification" if needed. |
| Session cancelled | Immediately. Cancellation SMS sent to patient. |

---

## Background Notifications

### Zero-Permission (Always Active)

- **Tab title flashing**: When a high-priority event occurs (late, upcoming not responded, waiting), the browser tab title alternates between "Coviu" and a contextual alert like "(!) 1 Late" every 2 seconds.
- **Favicon badge**: Dynamic favicon updates to show a red dot when attention is required. Reverts when all attention states are resolved.

### Permission-Based (Optional)

- **Browser push notifications**: If permission is granted during onboarding, native desktop notifications fire for: patient late, upcoming not responded, patient waiting/checked in.
- **Click action**: Clicking the notification brings the user to the run sheet with the relevant session highlighted.

---

## Data Requirements

### Primary Query

The run sheet loads today's sessions for the selected location.

| Element | Detail |
|---------|--------|
| Tables | sessions, appointments, appointment_types, session_participants, patients, rooms |
| Filter | sessions.location_id = :selected_location_id AND sessions.created_at::date = CURRENT_DATE |
| Order | appointments.scheduled_at ASC within each room |
| Joins | Session -> appointment -> appointment_type (for type name and default fee). Session -> session_participants -> patient (for patient name). Session -> room (for room name and grouping). |

### Derived State Calculation

Derived display states are calculated in the frontend, not stored in the database. The calculation runs on every render and every real-time update.

| Stored Status | Condition | Derived State |
|---------------|-----------|---------------|
| queued | Appointment time > 30 min from now | queued |
| queued | Notification sent AND patient not arrived AND appointment within 30 min | upcoming |
| queued | Current time > appointment scheduled time | late |
| waiting | - | waiting |
| checked_in | - | checked_in |
| in_session | Current time < scheduled_at + duration | in_session |
| in_session | Current time > scheduled_at + duration | running_over |
| complete | - | complete |
| done | - | done |

### Real-Time Subscription

| Element | Detail |
|---------|--------|
| Channel | runsheet:{location_id} |
| Events | INSERT, UPDATE on sessions table WHERE location_id = subscribed location |
| Triggered by | Patient arrival (queued -> waiting/checked_in), session start (waiting -> in_session), session end (in_session -> complete), Process flow (complete -> done) |
| Client handling | Optimistic local state update. Full re-fetch on reconnect. |

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Patient arrives before the morning scan has run | On-demand session created. Appears in triage/on-demand room. Receptionist can transfer to a clinician room. |
| Patient arrives for an appointment not in Coviu | QR scan creates an on-demand session. No appointment matched. Patient appears as walk-in in triage room. |
| Two patients share a phone number | After OTP verification, contact resolution step asks "Which patient?" Session is associated with the selected patient. |
| Clinician is running over and the next patient is waiting | Running over state shows on the current session. Cascading wait time adjustment shown for waiting patient. Receptionist sees both. |
| Receptionist processes payment but it fails | Session stays in complete. Payment status shows "failed." Receptionist can retry or send a payment request link. |
| Ad hoc appointment added after morning scan | Receptionist creates manually via "+ Add session" button. Session created immediately in the selected room. One-shot SMS fires. |
| Real-time connection drops | "Reconnecting" indicator shown. Fallback to 30-second polling. Full re-fetch on reconnection. |
| 100+ sessions across 10 rooms | Auto-collapse ensures only 2-3 rooms are expanded. Summary bar provides aggregate view. Bulk actions prevent click-by-click processing. |
| Receptionist clicks Process on a checked-in in-person patient | Process flow opens. Early processing path. Session skips the complete state and moves directly to done. |
| No card on file when processing payment | Step 1 shows "No card stored." Receptionist can send a payment request SMS ("tap to pay" link) or skip payment. |

---

## Accessibility

- **Keyboard navigation**: Tab through room headers and session rows. Enter to expand/collapse rooms. Enter on action buttons to trigger.
- **Screen reader**: Room containers use aria-expanded. Status badges use aria-label with full state name. Summary bar counts use aria-live for real-time updates.
- **Colour contrast**: All status colours meet WCAG AA contrast ratio against their background tints. Text on coloured badges uses the darkest shade from the same colour family.
- **Motion**: Auto-collapse transitions respect prefers-reduced-motion. Tab title flashing stops if the user has reduced motion preference.
