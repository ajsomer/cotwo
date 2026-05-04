# Feature: Run Sheet

The real-time operational dashboard at the heart of the clinic-side experience. The run sheet is what receptionists watch all day. It is also the most architecturally consequential surface in the build because it is where derived state, real-time updates, location scoping, and role-based filtering all collide.

This doc summarises behaviour and points at the spec for full detail.

---

## What the run sheet is

A live dashboard showing today's sessions for the selected location, organised by room. Receptionists drive sessions forward (admit, process, take payment) and clinicians start their calls from this same page (filtered to their assigned rooms).

Mental model: airport departure board. Each row represents a patient's progress through their visit. The board updates in real time as patients respond to messages, arrive, are seen, complete, and leave. Late patients flash red. Patients ready for processing sit blue. Done sessions fade out.

The run sheet is **always scoped to a single location**, determined by the location switcher in the sidebar. Multi-location users switch between locations using the app-level switcher, not within the run sheet itself.

## Layout hierarchy

Two levels of nesting:

1. **Room container** (one per room at the selected location).
2. **Session row** (within rooms).

Rooms group sessions visually. A clinician walking past sees their room's slice of the day; a receptionist sees all rooms.

There are no sub-sections inside a room. A session is in a room or it isn't. Bulk actions and summary information live at the page level (above the room containers), not inside individual rooms.

## Priority hierarchy

Six priority levels, in descending order of urgency. This determines which rooms auto-expand and which sessions surface first:

1. **Late** (red): stored status `queued`, scheduled time has passed, patient hasn't arrived.
2. **Upcoming not responded** (amber soft): stored status `queued`, the appointment is within ~10 minutes, the patient hasn't arrived. (The original spec required `notification_sent` as well; the current `isUpcoming()` in `derived-state.ts` does not check that flag. If we ever want notification-sent gating, that's a behaviour change to make explicitly.)
3. **Waiting / Checked in** (amber): patient is here. Telehealth = `waiting`, in-person = `checked_in`.
4. **In session / Running over** (teal): call active or appointment happening. Running over = `in_session` past the scheduled duration.
5. **Complete** (blue): call/visit finished, needs receptionist processing (payment, outcome).
6. **Queued** (gray): nothing to do yet. Rooms with only queued sessions auto-collapse.

The first four states, plus `complete`, are the receptionist's working set. `done` sessions are archived from the active board (still visible if you toggle full expansion).

## Derived state

`late`, `upcoming`, and `running_over` are **not stored** in the database. They are computed at render time from the stored session status and the current clock. See `01-core-concepts.md` and `03-data-model.md` for the rationale.

The implementation lives in `src/lib/runsheet/derived-state.ts`. Every session goes through `getDerivedState(session, now)` to produce the displayed status — the second argument is the current time, not the appointment, since "running over" and "late" are functions of `session.scheduled_at` (already on the session) and the clock. Action availability (Admit, Process, Nudge) flows from the same function via `getActionConfig`.

If you find yourself adding a new visual state, ask first whether it's derived or stored. Derived states are cheap, always-correct, and impossible to query in SQL. Stored states need a migration and a way to keep the column in sync with reality.

## Room expansion states

Three states per room:

1. **Collapsed**: header only, with status badges showing "3 queued, 1 late." Used when the room has nothing immediately actionable.
2. **Auto-expanded**: shows only the sessions that caused the expansion (the late one, the waiting one, etc), not all sessions. Reduces noise.
3. **Fully expanded**: everything in the room, reachable via "Show all" toggle. Used when the receptionist wants the full picture.

Auto-expansion is driven by the priority hierarchy. A room with a late session auto-expands and the late session is what shows; a room with only queued sessions stays collapsed.

The auto-expansion logic is sticky: a room that auto-expanded for a late patient stays expanded after the patient is admitted, until the receptionist collapses it manually. This is intentional; constantly re-collapsing rooms as state changes is jarring.

## Bulk actions and summary bar

The summary bar across the top of the run sheet aggregates actionable counts: "3 late," "5 to process," "2 waiting too long." Each count is clickable and triggers a bulk action.

Bulk actions:

- **Bulk nudge** for upcoming patients who haven't responded. Resends the entry SMS to the lot.
- **Bulk admit** for waiting patients (telehealth only).
- **Bulk process** is *not* offered. Processing is per-patient because outcome pathway selection is patient-specific.

The summary bar is visible on the receptionist view only. Clinicians don't see it.

## Background notifications

Three notification mechanisms, layered:

1. **Tab title flashing.** When something urgent happens (late, complete to process), the browser tab title flashes with a count. Zero-permission, works everywhere.
2. **Favicon badge.** A small dot or number on the favicon for visual alert. Also zero-permission.
3. **Browser push notifications.** Optional, requires the user to grant notification permission. Intended to fire for the top three priorities.

**Scope (current build):** all three signals fire from the **selected location's** data only. The `useTabNotifications` and `useFaviconBadge` hooks read from the runsheet summary the page already has, which is keyed on `selectedLocation`. There is no separate cross-location notifications subscription.

**Scope (intended):** the original spec calls for notifications to fire across all assigned locations, with a click that switches context to wherever the event came from. That is the design we want; it isn't implemented. Building it requires extending the Socket.io connection to join multiple `location:{id}` rooms (or a per-user room the server fans cross-location events into) and threading the originating location id through to the click handler. See the "selected location" section of `conventions-realtime-and-state.md` for the broader framing.

If you're building a feature that needs cross-location signal, you'll be the one to add the infrastructure. If you're consuming notifications, assume selected-location only.

## "+ Add session" panel

A slide-over panel, scoped to the selected location, accessed via a single button in the run sheet header. Same panel for creating, editing, and deleting sessions.

Captures only:

- Phone number
- Time

No patient name, no appointment type, no clinician assignment. The intentional minimum for run-sheet planning. The patient is identified later, through the entry flow.

The panel has a "Plan tomorrow" toggle that switches between today's run sheet and tomorrow's. SMS timing depends on this toggle:

- **Today**: SMS goes immediately on save.
- **Tomorrow saved before 6pm**: SMS queued for 6pm send.
- **Tomorrow saved after 6pm**: SMS goes immediately.

The 6pm cutoff is a UX heuristic; patients getting an "evening before" message at 11pm is bad, but at 6pm is fine.

## Clinician room view

Same component as the receptionist run sheet, filtered to the clinician's assigned rooms. Role-based filtering is applied at the data-fetch layer, not at the component layer; the component is identical.

Differences from the receptionist view:

- **Single-room clinicians** see their room always expanded, with no room header. A solo psychologist's view is essentially "your patients today."
- **Multi-room clinicians** see the standard room expansion/collapse behaviour.
- **No summary bar.**
- **No bulk actions.**
- **No "+ Add session" button.**
- **No Plan Tomorrow flow.**
- Clinicians can start and end calls from their view.
- Solo practitioners (clinic owner with no receptionist) can process their own sessions through the same Process flow.

The clinician view enforcement happens via the `staff_assignments.role` and `clinician_room_assignments` data, not via a different page. There is no `/clinician/runsheet` route; everyone hits `/runsheet`.

## Real-time updates

The clinic-side `ClinicDataProvider` joins the Socket.io room `location:{selected_location_id}` and listens for `session_changed` events. On each event, the run sheet's slice of the Zustand store calls `refreshSessions(locationId)` to re-fetch and the UI updates. When the location switches, the old room is left and the new one is joined; location-scoped slices reset and re-fetch. See `conventions-realtime-and-state.md` for the room/event model.

The same `location:{id}` room also carries `readiness_changed` (consumed by the readiness dashboard) and `presence:update` (the "connected" dot on the run sheet — patient tabs currently in the waiting room). The run sheet treats `session_changed` as its trigger for refresh; it doesn't subscribe to a separate per-feed channel.

Events that produce a `session_changed` broadcast:

- Session status changes (admit, process, complete).
- New sessions added (manual entry, on-demand arrival).
- Session deletions.
- Server-side mutations that alter session participants or display-relevant fields.

Optimistic updates: when the receptionist clicks "Admit," the local Zustand state updates immediately, the API call fires, and the resulting `session_changed` event lands back on the same client (the refresh re-fetches authoritative state, replacing the optimistic value).

If Socket.io drops, the run sheet falls back to polling. A subtle "reconnecting" indicator shows; the run sheet keeps working.

## Process flow integration

When a session is `complete` (or `checked_in` for in-person, which can be processed early), the receptionist clicks the row's primary action ("Process") to enter the process flow. This is a sequential modal:

1. Take payment (if applicable).
2. Select outcome pathway (Complete tier only).
3. Done.

The process flow is its own feature; see `feature-process-flow.md`. The run sheet's responsibility ends at "send the receptionist into Process."

## Where to look

- **Run sheet page:** `src/app/(clinic)/runsheet/page.tsx`.
- **Run sheet shell:** `src/components/clinic/runsheet-shell.tsx`.
- **Derived state:** `src/lib/runsheet/derived-state.ts`.
- **Grouping and sorting:** `src/lib/runsheet/grouping.ts`.
- **Mutations:** `src/lib/runsheet/mutations.ts` and `src/lib/runsheet/actions.ts`.
- **Real-time wiring:** `src/components/clinic/clinic-data-provider.tsx` (Socket.io listeners that drive the Zustand refresh) and `src/lib/realtime/broadcast.ts` (server-side publish helpers). Note: `src/hooks/useRealtimeRunsheet.ts` exists but is not used; ignore it.
- **Clinic store slice:** `src/stores/clinic-store.ts` (look for `runsheet*` fields).
- **Spec file:** the run sheet feature spec (uploaded separately).

## Related docs

- `01-core-concepts.md` for session lifecycle and derived states.
- `feature-tiers-and-roles.md` for the role-by-tier visibility rules that govern who sees what.
- `feature-clinician-room-view.md` for the clinician-side filtering and behaviour.
- `feature-process-flow.md` for the sequential receptionist flow that takes over from the run sheet.
- `feature-patient-entry-flow.md` for what happens on the patient side when they click their link.
- `conventions-realtime-and-state.md` for the channel naming, optimistic update pattern, and polling fallback.
