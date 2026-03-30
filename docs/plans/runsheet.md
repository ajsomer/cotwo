# Plan: Run Sheet Implementation

## Context

The run sheet is the operational heart of the Coviu platform — a real-time dashboard displaying today's sessions by room, colour-coded by time-aware status, with priority-driven auto-collapse. It's the first feature to build because everything else (patient entry, payments, workflows) feeds into or out of it. The full spec lives at `docs/specs/runsheet.md`.

The database schema is deployed. The project skeleton is in place. We need to go from empty components to a fully functional, real-time run sheet.

## Architecture

- **Server component** (`page.tsx`) fetches initial data via Supabase server client
- **Client orchestrator** (`runsheet-shell.tsx`) receives data as props, manages real-time state, room expansion, action dispatch, and slide-over panels
- **Derived display states** (late, upcoming, running_over, etc.) are calculated client-side from stored status + current time, recalculated every 30 seconds
- **Clinician view** is the same component tree with a `role` prop and `roomIds` filter — not a separate build
- **Real-time** via Supabase channel `runsheet:{location_id}`, with 30-second polling fallback

## Phases

### Phase 1: Data Layer
Pure TypeScript, no UI. Types, queries, derived state logic, grouping, formatting.

| # | File | New/Modify |
|---|------|-----------|
| 1 | `src/lib/supabase/types.ts` | Modify — generate DB types + hand-written app types (RunsheetSession, DerivedDisplayState, RoomGroup, RunsheetSummary) |
| 2 | `src/lib/runsheet/queries.ts` | New — `fetchRunsheetSessions(locationId, date)`, `fetchLocationRooms(locationId)`, `fetchClinicianRoomIds(userId, locationId)` |
| 3 | `src/lib/runsheet/derived-state.ts` | New — `getDerivedState()`, `isRunningOver()`, `isLate()`, `isUpcoming()`, `getRowBackground()`, `getStatusBadgeConfig()`, `getActionConfig()` |
| 4 | `src/lib/runsheet/grouping.ts` | New — `groupSessionsByRoom()`, `calculateSummary()`, `getRoomExpansionState()`, `getAttentionSessions()`, `PRIORITY_ORDER` |
| 5 | `src/lib/runsheet/format.ts` | New — `formatSessionTime()`, `formatCurrency()`, `formatPatientName()` |

### Phase 2: Seed Data
SQL script with realistic data covering every derived state. Uses relative timestamps (`now() - interval '30 minutes'`) so data is always fresh.

| # | File | New/Modify |
|---|------|-----------|
| 6 | `supabase/seed.sql` | Modify — 1 org, 1 location, 4 rooms, 2 users, 4 appointment types, 6 patients, 12-15 sessions across all statuses |

### Phase 3: Context Providers
Wire up location/org/role hooks. For prototype, these read from Supabase based on a hardcoded or cookie-stored user.

| # | File | New/Modify |
|---|------|-----------|
| 7 | `src/hooks/useLocation.ts` | Modify — React context, stores selectedLocationId, reads assigned locations |
| 8 | `src/hooks/useOrg.ts` | Modify — reads org from selected location |
| 9 | `src/hooks/useRole.ts` | Modify — queries staff_assignments for role |
| 10 | `src/components/clinic/providers.tsx` | New — `ClinicProviders` wrapping Location, Org, Role contexts |
| 11 | `src/app/(clinic)/layout.tsx` | Modify — wrap children in `<ClinicProviders>`, add location switcher |

### Phase 4: UI Primitives
Leaf components, visually testable in isolation.

| # | File | New/Modify |
|---|------|-----------|
| 12 | `src/components/ui/badge.tsx` | New — generic pill badge (variant: red/amber/teal/blue/gray/faded) |
| 13 | `src/components/ui/skeleton.tsx` | New — SkeletonLine, SkeletonBadge, SkeletonRow |
| 14 | `src/components/ui/button.tsx` | New — primary/secondary/danger/accent variants |
| 15 | `src/components/ui/live-clock.tsx` | New — client component, updates every second, timezone-aware |
| 16 | `src/components/clinic/status-badge.tsx` | New — wraps Badge with DerivedDisplayState mapping |
| 17 | `src/components/clinic/modality-badge.tsx` | New — TH (teal) or IP (gray) pill |
| 18 | `src/components/clinic/action-button.tsx` | New — client component, contextual action per state |

### Phase 5: Session Row + Room Container
The two core structural components.

| # | File | New/Modify |
|---|------|-----------|
| 19 | `src/components/clinic/session-row.tsx` | New — 6-column layout (time, patient, status, modality, readiness, action), row background tinting |
| 20 | `src/components/clinic/session-row-skeleton.tsx` | New — loading skeleton for session row |
| 21 | `src/components/clinic/room-container.tsx` | New — client component, 3 expansion states, chevron toggle, status badge counts, "Show all" and "N completed" toggles |
| 22 | `src/components/clinic/room-container-skeleton.tsx` | New — loading skeleton for room |

### Phase 6: Page Assembly
Wire everything together. After this phase: **working static run sheet with seed data**.

| # | File | New/Modify |
|---|------|-----------|
| 23 | `src/components/clinic/runsheet-header.tsx` | New — title, date, location, LiveClock, "+ Add session" button |
| 24 | `src/components/clinic/summary-bar.tsx` | New — client component, counts + bulk action buttons |
| 25 | `src/components/clinic/runsheet-shell.tsx` | New — client orchestrator, owns sessions state, ticks `now` every 30s, computes groups + summary, handles onAction, renders header/summary/rooms |
| 26 | `src/app/(clinic)/runsheet/page.tsx` | Modify — server component, fetches data, passes to RunsheetShell |
| 27 | `src/app/(clinic)/runsheet/loading.tsx` | New — Next.js loading file with skeleton layout |

### Phase 7: Real-Time
Makes the run sheet live.

| # | File | New/Modify |
|---|------|-----------|
| 28 | `src/hooks/useRealtimeRunsheet.ts` | Modify — subscribe to sessions changes, merge into local state, polling fallback |
| 29 | `src/components/clinic/connection-indicator.tsx` | New — green/amber/red dot for connection status |
| 25 | `src/components/clinic/runsheet-shell.tsx` | Modify — integrate useRealtimeRunsheet |

### Phase 8: Session Actions
Action buttons do something. Server actions with optimistic UI updates.

| # | File | New/Modify |
|---|------|-----------|
| 30 | `src/lib/runsheet/actions.ts` | New — server actions: callPatient, nudgePatient, admitPatient, markSessionComplete, markSessionDone |
| 30a | `src/components/clinic/call-dropdown.tsx` | New — small dropdown for late patients: "Call patient" (tel: link) + "Send reminder SMS" |
| 25 | `src/components/clinic/runsheet-shell.tsx` | Modify — wire onAction to server actions with optimistic updates |

### Phase 9: Process Flow Slide-Over
The 3-step payment/outcome/done panel.

| # | File | New/Modify |
|---|------|-----------|
| 31 | `src/components/ui/slide-over.tsx` | New — generic right-side panel, 360px, backdrop, focus trap |
| 32 | `src/components/clinic/process-flow.tsx` | New — step orchestrator with indicator |
| 33 | `src/components/clinic/process-flow-payment.tsx` | New — Step 1: amount, card on file, charge/skip |
| 34 | `src/components/clinic/process-flow-outcome.tsx` | New — Step 2: outcome pathway selection (Complete tier only) |
| 35 | `src/components/clinic/process-flow-done.tsx` | New — Step 3: confirmation, auto-close or advance |
| 25 | `src/components/clinic/runsheet-shell.tsx` | Modify — add processingSessionId state, bulkProcessQueue |

### Phase 10: Add Session Panel
The "+ Add session" and "Plan tomorrow" slide-over. Same panel handles both create and edit modes. Clicking a session row opens the panel pre-populated with existing data for inline editing.

| # | File | New/Modify |
|---|------|-----------|
| 36 | `src/components/clinic/add-session-panel.tsx` | New — room checkboxes, phone + time rows, save action. Accepts optional `editingDate` and `initialData` props for pre-population. Handles both create and update mutations. |
| 37 | `src/lib/runsheet/mutations.ts` | New — server actions: `createSessions`, `updateSession`, `deleteSession`, `markNoShow` |
| 25 | `src/components/clinic/runsheet-shell.tsx` | Modify — add `addSessionOpen` state + `editingSessionId: string | null`. Session row click sets `editingSessionId` and opens panel in edit mode (receptionist/PM only). Clinician row click scrolls to session in context instead. |

### Phase 11: Clinician View
No new files. Just prop configuration on existing components.

- `runsheet-shell.tsx`: filter rooms by clinicianRoomIds, hide summary bar
- `room-container.tsx`: singleRoom=true hides header, always expanded
- `runsheet-header.tsx`: hide "+ Add session" for clinician role
- `runsheet/page.tsx`: server component detects role from staff_assignments query, passes `clinicianRoomIds` to shell when role is clinician. This is the branching point — the shell receives different props based on role.

### Phase 12: Background Notifications
Tab title flashing and favicon badge.

| # | File | New/Modify |
|---|------|-----------|
| 38 | `src/hooks/useTabNotifications.ts` | New — alternates document.title when attention states exist |
| 39 | `src/hooks/useFaviconBadge.ts` | New — swaps favicon to red-dot variant |
| 25 | `src/components/clinic/runsheet-shell.tsx` | Modify — call both hooks |

## Dependency Graph

```
Phase 1 (Data)  ──┐
Phase 2 (Seed)    │── Phase 3 (Context) ── Phase 4 (Primitives) ── Phase 5 (Row+Room) ── Phase 6 (Page) ──┐
                  │                                                                                        ├── Phase 7 (Realtime) ── Phase 8 (Actions) ── Phase 9 (Process Flow)
                  │                                                                                        ├── Phase 10 (Add Session)
                  │                                                                                        ├── Phase 11 (Clinician View)
                  │                                                                                        └── Phase 12 (Notifications)
```

Phases 9-12 are independent of each other.

## Key Design Decisions

- **`runsheet-shell.tsx` as client boundary**: page.tsx stays server for initial fetch, shell takes over for real-time + interactivity
- **Derived state recalculated, not stored**: `now` ticks every 30s — sessions transition from "upcoming" to "late" purely client-side. 30s granularity is fine for prototype; production could schedule the next tick based on the nearest upcoming transition time.
- **Room expansion state is local**: each RoomContainer owns its state, auto-expansion resets on session state changes
- **Flat query → grouping in pure functions**: makes real-time merge simple (replace row by ID in flat array, regroup)
- **Shell state management**: By Phase 12, `runsheet-shell.tsx` owns significant state (sessions, real-time, room expansion, actions, process flow, add session, bulk queue, notifications). State is delegated to hooks (`useRealtimeRunsheet`, `useTabNotifications`, `useFaviconBadge`) and child components (RoomContainer owns expansion, ProcessFlow owns step state). If the shell becomes unwieldy, extract a `useRunsheetState` reducer hook to consolidate. Watch for this during Phase 8-10.

## Verification

After each phase:
- **Phase 2**: Run seed, verify data in Supabase dashboard
- **Phase 6**: `npm run dev`, navigate to `/runsheet` — should render rooms with sessions, colour-coded, auto-collapsed
- **Phase 7**: Change a session status in Supabase dashboard → run sheet updates without refresh
- **Phase 8**: Click action buttons → session status changes, UI updates
- **Phase 9**: Click Process → slide-over opens, step through payment/outcome/done
- **Phase 12**: Cause a "late" state → tab title starts flashing

## Total New Files: ~35
## Total Modified Files: ~8
