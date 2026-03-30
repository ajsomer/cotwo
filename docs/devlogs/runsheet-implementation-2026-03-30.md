# Run Sheet Implementation - 2026-03-30

## What was done

Implemented the complete run sheet feature across all 12 phases from the plan. Starting from empty stubs and a deployed schema, the run sheet is now a fully functional real-time dashboard with session management, process flow, and background notifications. ~35 new files created, ~8 modified. Build passes cleanly.

## Phase 1: Data Layer (5 new files)

Pure TypeScript, no UI. The foundation everything else builds on.

- **`src/lib/supabase/types.ts`** — Extended with hand-written app types: `RunsheetSession` (flat row with all joins resolved), `EnrichedSession` (with derived state), `RoomGroup`, `RoomCounts`, `RunsheetSummary`, `StatusBadgeConfig`, `ActionConfig`. The `Database` placeholder from Supabase CLI is preserved at the top.
- **`src/lib/runsheet/queries.ts`** — `fetchRunsheetSessions()` does a single Supabase query with nested selects (sessions → appointments → appointment_types/users, sessions → session_participants → patients → payment_methods, sessions → rooms) and flattens the result into `RunsheetSession` rows. Also: `fetchLocationRooms()`, `fetchClinicianRoomIds()`, `fetchUserStaffAssignments()`.
- **`src/lib/runsheet/derived-state.ts`** — The core state machine. `getDerivedState()` maps 6 stored statuses to 9 display states using current time. Also exports `isLate()`, `isRunningOver()`, `isUpcoming()`, `isAttentionState()`, `getRowBackground()`, `getStatusBadgeConfig()`, `getActionConfig()`.
- **`src/lib/runsheet/grouping.ts`** — `groupSessionsByRoom()` distributes enriched sessions into `RoomGroup` arrays sorted by priority. `calculateSummary()` aggregates counts. `getRoomExpansionState()` and `getAttentionSessions()` drive auto-collapse logic. `PRIORITY_ORDER` constant defines the sort hierarchy.
- **`src/lib/runsheet/format.ts`** — `formatSessionTime()`, `formatCurrency()`, `formatPatientName()`, `formatRelativeTime()`, `formatRunsheetDate()`. All use en-AU locale.

**Decision: flat query + client-side grouping.** The Supabase query returns a flat array. Grouping and derived state calculation happen in pure functions. This makes real-time merge simple — replace a row by ID in the flat array, regroup. No need to track nested state.

## Phase 2: Seed Data

- **`supabase/seed.sql`** — 1 org (Sunrise Allied Health, Complete tier), 1 location (Bondi Junction), 4 rooms (Dr Smith's, Dr Nguyen's, Nurse Room, On-Demand), 3 staff users, 4 appointment types, 6 patients, 12 sessions covering every derived state (late, upcoming, waiting, checked_in, in_session, running_over, complete, done, queued). Uses `now() - interval` for relative timestamps so data is always fresh.

**Note:** The seed SQL inserts users directly, bypassing the auth.users FK. The `ALTER TABLE users DISABLE TRIGGER ALL` trick handles this for dev. A separate server action (`seed.ts`) was later added for seeding via the UI.

## Phase 3: Context Providers (4 files modified, 2 new)

- **`src/hooks/useLocation.ts`**, **`useOrg.ts`**, **`useRole.ts`** — Rewritten from stubs to React Context consumers. Each exports a context object and a `use*()` hook.
- **`src/components/clinic/providers.tsx`** — `ClinicProviders` wrapper that accepts `assignments` (location + org + role + userId per location) and wires up all three contexts. Selected location is tracked in state with a setter exposed via `LocationContext`.
- **`src/components/clinic/location-switcher.tsx`** — Dropdown for multi-location users, plain text for single-location.
- **`src/app/(clinic)/layout.tsx`** — Server component that fetches staff assignments via Supabase, transforms the nested response into the `assignments` prop shape, and wraps children in `<ClinicProviders>`. Falls back to hardcoded seed data when there's no authenticated user (prototype mode). Added a top nav bar with Coviu branding and location switcher.

**Decision: prototype fallback.** The layout detects when there's no auth user and provides hardcoded seed assignment data so the run sheet works without login.

## Phase 4: UI Primitives (7 new files)

- **`src/components/ui/badge.tsx`** — Generic pill badge with 6 variants (red, amber, teal, blue, gray, faded), optional colour dot.
- **`src/components/ui/skeleton.tsx`** — `SkeletonLine`, `SkeletonBadge`, `SkeletonRow` with pulse animation.
- **`src/components/ui/button.tsx`** — 5 variants (primary, secondary, danger, accent, ghost), 3 sizes (sm, md, lg), focus ring, disabled state.
- **`src/components/ui/live-clock.tsx`** — Client component, updates every second, timezone-aware via `toLocaleTimeString()`. Renders in mono font.
- **`src/components/clinic/status-badge.tsx`** — Wraps `Badge` with `getStatusBadgeConfig()` mapping.
- **`src/components/clinic/modality-badge.tsx`** — "TH" (teal) or "IP" (gray) pill.
- **`src/components/clinic/action-button.tsx`** — Client component, renders contextual button based on `getActionConfig()`. Maps action variants to button variants. Stops click propagation (so row click doesn't fire).

## Phase 5: Session Row + Room Container (4 new files)

- **`src/components/clinic/session-row.tsx`** — 6-column CSS grid layout (time, patient+type, status badge, modality badge, readiness indicator, action button). Row background tinting via `getRowBackground()`. Keyboard accessible (Enter/Space triggers click). Readiness shows "Ready" (green) or issues like "No card" (amber).
- **`src/components/clinic/room-container.tsx`** — The most complex component. Three expansion states: collapsed (header only), auto-expanded (attention sessions only), fully expanded (all). Room header has chevron, room name, clinician name, status badge counts, total count. "Show all" toggle in auto-expanded mode. Done sessions toggle in fully expanded mode. Manual override flag prevents auto-expansion from fighting user intent. `singleRoom` prop for clinician view (no header, always expanded).
- **Skeleton variants** for both.

**Decision: expansion state is local to each RoomContainer.** Auto-expansion is recalculated from session derived states on every update, but a `manualOverride` flag prevents it from resetting after the user manually collapses/expands.

## Phase 6: Page Assembly (5 new files, 1 modified)

- **`src/components/clinic/runsheet-header.tsx`** — Title, date, location name, live clock, "+ Add session" button.
- **`src/components/clinic/summary-bar.tsx`** — Left: informational counts (Total, Late, Waiting, Active, Process) with clickable scroll-to. Right: bulk action buttons (Call now, Nudge, Bulk process) that appear only when counts > 0. Uses `aria-live` for screen readers.
- **`src/components/clinic/runsheet-shell.tsx`** — The client orchestrator. Owns the session state array. Ticks `now` every 30s for derived state recalculation. Computes enriched sessions → groups → summary on every render. Delegates to hooks for real-time and notifications. Manages state for add session panel, process flow, and bulk queue. Lazy-loads `ProcessFlow` and `AddSessionPanel` via `require()` to keep the initial bundle small.
- **`src/app/(clinic)/runsheet/page.tsx`** — Server component. Fetches sessions and rooms in parallel via `Promise.all()`. Detects role from staff_assignments (or falls back to prototype defaults). Passes everything to `RunsheetShell`. Clinician role triggers `fetchClinicianRoomIds()`.
- **`src/app/(clinic)/runsheet/loading.tsx`** — Next.js loading file with skeleton layout.
- **`src/components/clinic/connection-indicator.tsx`** — Green/amber/red dot for real-time connection status.

## Phase 7: Real-Time (1 modified, 1 new)

- **`src/hooks/useRealtimeRunsheet.ts`** — Subscribes to `postgres_changes` on the sessions table filtered by `location_id`. On UPDATE, merges changed fields (status, notification_sent, patient_arrived, timestamps) into the local sessions array. On INSERT, currently a no-op (full refetch on next poll). Polling fallback: if connection drops, starts a 30-second interval hitting `/api/runsheet?locationId=...`. Cleans up channel on unmount or location change. Exports `ConnectionStatus` type.
- **`src/app/api/runsheet/route.ts`** — Simple GET endpoint that calls `fetchRunsheetSessions()` for the polling fallback.

## Phase 8: Session Actions (2 new files)

- **`src/lib/runsheet/actions.ts`** — Server actions: `callPatient()` (logs phone number, stub), `nudgePatient()` (logs SMS, updates notification_sent_at), `admitPatient()` (transitions waiting → in_session, sets video_call_id stub), `markSessionComplete()` (in_session → complete), `markSessionDone()` (→ done), `chargePayment()` (creates payment record, stub Stripe), `selectOutcomePathway()` (logs selection, stub workflow trigger).
- **`src/components/clinic/call-dropdown.tsx`** — Small dropdown for late patients with "Call patient" (`tel:` link) and "Send reminder SMS" options. Click-outside-to-close behaviour.

## Phase 9: Process Flow (5 new files)

- **`src/components/ui/slide-over.tsx`** — Generic right-side panel. Fixed position, configurable width (default 360px), backdrop with click-to-close, Escape to close, focus on open.
- **`src/components/clinic/process-flow.tsx`** — Step orchestrator. Determines steps based on org tier (Core: payment → done, Complete: payment → outcome → done). Renders numbered step indicator with green check for completed steps, teal for active.
- **`src/components/clinic/process-flow-payment.tsx`** — Step 1. Shows patient context, editable amount (pre-populated from appointment type default_fee_cents), card on file display, "Charge" button, "Send payment request" fallback, "Skip payment" link.
- **`src/components/clinic/process-flow-outcome.tsx`** — Step 2 (Complete only). Fetches outcome pathways from Supabase on mount. Selectable cards with name/description. Confirm button.
- **`src/components/clinic/process-flow-done.tsx`** — Step 3. Marks session as done on mount. Shows confirmation with green check. Auto-closes after 2s for single sessions. Shows "Next session" button for bulk processing.

**Bulk processing works by:** Summary bar "Bulk process" button collects all complete session IDs, puts them in a queue, opens the process flow on the first one. After each completion, the flow advances to the next session in the queue.

## Phase 10: Add Session Panel (2 new files)

- **`src/lib/runsheet/mutations.ts`** — Server actions: `createSessions()` (creates appointment + session for each input, logs SMS stub), `updateSession()` (updates appointment time/phone), `deleteSession()` (deletes session, logs cancellation SMS), `markNoShow()` (session → done, appointment → no_show).
- **`src/components/clinic/add-session-panel.tsx`** — Slide-over (420px) with room checkboxes, phone+time rows per room, "+ Add patient" to add rows, delete button per row. Today/tomorrow toggle in header. Edit mode: pre-populates from existing sessions when opened via row click. Save creates all sessions and closes. Deletion of existing sessions triggers confirmation dialog.

## Phase 11: Clinician View (0 new files)

No new files — purely prop-driven configuration on existing components:
- `page.tsx` detects clinician role and passes `clinicianRoomIds`
- `runsheet-shell.tsx` filters rooms, hides summary bar, disables session row click for editing
- `room-container.tsx` uses `singleRoom=true` to hide header and always expand
- `runsheet-header.tsx` hides "+ Add session" button

## Phase 12: Background Notifications (2 new files)

- **`src/hooks/useTabNotifications.ts`** — Alternates `document.title` between "Coviu" and alert text (e.g. "(!) 1 Late") every 2s when attention states exist. Respects `prefers-reduced-motion`.
- **`src/hooks/useFaviconBadge.ts`** — Draws a red notification dot on the favicon using a canvas element. Falls back to generating a teal "C" favicon if the original can't be loaded. Reverts when attention states clear.

Both hooks are called from `runsheet-shell.tsx`.

## Seed Button

Added a "Seed demo data" button accessible from the run sheet UI:
- **`src/lib/runsheet/seed.ts`** — Server action using `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. Seeds all reference data + 12 sessions with relative timestamps. Cleans existing data before re-seeding so it's idempotent.
- Button appears prominently in the empty state, and as a subtle "Seed data" link in the header area for quick re-seeding during development.

## Build verification

`npm run build` passes cleanly. `/runsheet` renders as a dynamic server-rendered page. All 21 routes compile successfully.

## Type casting pattern

Supabase's generated types from `.select()` with nested joins return arrays for related tables. These don't cast cleanly to `Record<string, unknown>`. Resolved by using `as unknown as Record<string, unknown>` or `as any` for the mapping layer in queries.ts, actions.ts, mutations.ts, and layout.tsx. This is isolated to the Supabase response transformation boundary — all downstream code uses strongly-typed interfaces.

## File count

| Category | Count |
|----------|-------|
| New files | ~38 |
| Modified files | ~8 |
| Lines of code (approx) | ~3,200 |
