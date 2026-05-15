# App Loading and Navigation Performance

**Status:** Proposed
**Goal:** Make cold load feel fast and make in-app navigation feel instant, without adding infrastructure or a new data framework before the app needs it.

## Context

This app is a clinic operations tool. Staff use it repeatedly during the day, often moving between the run sheet, readiness, forms, workflows, and settings. The right performance model is:

1. Load the visible screen quickly.
2. Preserve already-loaded clinic data in memory for same-tab navigation.
3. Refresh volatile data through Socket.IO invalidation.
4. Defer heavy editors, panels, and secondary data until the user shows intent.

That is already the broad shape of the app. The main risk now is accidentally making first paint wait for data that is not required to draw the first useful frame.

## Current Pattern

The app already has several good conventions:

- The clinic layout is persistent across clinic routes.
- Data is centralised in `src/stores/clinic-store.ts`.
- Pages use fetch-if-empty instead of unconditional refetching.
- Socket.IO events refresh volatile slices such as sessions, readiness, and standalone submissions.
- Heavy panels are code-split with `next/dynamic`.
- Route-level loading UI exists for some pages.

Keep these conventions. Do not introduce Redis, service workers, localStorage persistence for clinical data, or a wholesale data-fetching library until there is a measured reason.

## Recommendation Summary

### 1. Split cold-load rendering into "structure first, data second"

The run sheet should not need to wait 3-5 seconds before showing anything. It can render the room structure first, then populate each room with sessions when the session fetch completes.

Target behaviour:

- The shell, sidebar, top bar, and selected location render immediately.
- Room containers render as soon as the room list and clinician-room scope are known.
- Each room shows an inline loading state while its session rows are still loading.
- When sessions arrive, rows fill in without replacing the whole page.

This is a good trade. Rooms are comparatively stable and small. Sessions are volatile and query-heavy. Showing rooms first gives the user orientation immediately without pretending session data is ready.

Important constraint: for clinicians, do not render all rooms while clinician room IDs are still unknown. The app must know the clinician's room scope before showing room containers. Otherwise there is a privacy and correctness flash.

Suggested gate:

- Need `roomsLoaded === true`.
- Need `clinicianRoomIdsLoaded === true`.
- Do not need `sessionsLoaded === true` to render room containers.
- Pass `sessionsLoading={!sessionsLoaded}` into `RoomContainer`.
- Inside each room, show existing `SessionRowSkeleton` rows until `sessionsLoaded === true`; it already wraps the shared `SkeletonRow` primitive.
- Suppress room empty-state copy while sessions are loading.
- While sessions are loading, render rooms in the fully-expanded visual state so skeleton rows are visible. When sessions transition from loading to loaded, recompute the room's natural expansion state once. If the user manually changed expansion during the loading window, their manual override wins.
- The single-room clinician case already fits this model: `RoomContainer` forces a single room to fully-expanded, so that user sees one room with skeleton rows and then populated rows.

### 2. Keep first-screen critical data small

For `/runsheet`, the critical cold-load set should be:

- selected location and role context from the clinic layout
- rooms
- clinician room IDs
- sessions

Everything else should be deferred or backgrounded:

- workflows
- forms
- files
- payment config
- onboarding state, unless the overlay actually needs to appear
- process-flow dependencies
- video-call panel bundle and LiveKit token work

The current run sheet background-loads workflows/forms/files because process flow may need them later. That is acceptable if the network is not blocked, but it should not block room rendering or the first useful frame.

Default decision: move workflows/forms/files prewarm out of `RunsheetShell` and into the Process flow's own mount path, because that is the run sheet consumer. Keep the run sheet first frame focused on rooms, clinician scope, and sessions.

This is new code, not just a relocation. `ProcessFlowOutcome` currently reads `forms`, `files`, and `outcomePathways` from the store but does not fetch missing slices. Add a fetch-if-empty effect in `ProcessFlowOutcome` or a small wrapper around `ProcessFlowDynamic` before removing the run sheet prewarm.

Onboarding state is already non-blocking in a separate effect. Keep it that way.

### 3. Use memory cache per tab as the default cache

Keep using Zustand as the main cache for same-tab navigation.

Rules:

- If a slice is loaded for the current location/org, render from memory immediately.
- If it is missing, fetch it.
- If a Socket.IO event says it changed, refresh it.
- If the user switches location, reset only location-scoped slices.
- Avoid browser storage persistence for clinical data until refresh performance is proven to be a problem.

This keeps the system simple and avoids stale patient data surviving longer than the tab.

### 4. Add intent preloading only where it pays

Use Next's built-in `<Link>` prefetch as the baseline. Add explicit intent preloading only for expensive, common paths.

Good candidates:

- Sidebar hover/focus on `/readiness`: prefetch route and optionally refresh readiness if stale.
- Sidebar hover/focus on `/runsheet`: prefetch route and warm rooms/sessions if missing.
- Hover/focus on "Process": preload the process-flow bundle.
- Hover/focus on "Add session" or "Add patient": preload the slide-over bundle.
- Hover/focus on "Join/Rejoin": preload the video panel bundle.

Avoid:

- Creating LiveKit tokens on hover.
- Creating payment intents on hover.
- Running mutations on hover.
- Prefetching every settings/editor dataset from sidebar hover.

### 5. Prefer background refresh over blocking navigation

Warm navigation should paint cached data immediately, then refresh in the background if the data is stale enough.

Suggested convention:

- Volatile live slices: sessions/readiness can refresh on socket events and reconnect.
- Stable config slices: rooms/forms/workflows/settings can refresh on first use, on mutation success, or after location/org switch.
- Do not block route transitions on stable config refreshes if cached data exists.

### 6. Add stale-response guards consistently

The store already guards location-scoped responses so old fetches do not paint over a newer location. Keep this as a convention.

Any fetch that depends on `locationId` or `orgId` should check that the current store scope still matches before applying results.

Also remove or explicitly mark dead hydration paths in `clinic-store.ts`: `hydrateFromInitialData` and `hydrateRunsheetSlices` are remnants of the old SSR hydration approach and are not called anywhere. Leaving them in place makes it easier for future changes to accidentally reintroduce the old model.

### 7. Measure before adding new infrastructure

Add lightweight timing logs or performance marks around the critical paths before doing larger work.

Useful timings:

- layout auth/assignment time
- rooms API time
- clinician rooms API time
- sessions API time
- readiness API time
- time to first shell paint
- time to rooms visible
- time to sessions visible

The key metric for the run sheet should be split:

- **Rooms visible:** should be fast.
- **Sessions populated:** can take longer, but should not block orientation.

## Implementation Plan

### Phase 1: Make run sheet render rooms before sessions

Modify `RunsheetShell` so the full-page skeleton only waits for room structure and clinician scope.

Current effective gate:

```ts
storeLocationId !== locationId ||
!sessionsLoaded ||
!roomsLoaded ||
!clinicianRoomIdsLoaded
```

Target gate:

```ts
storeLocationId !== locationId ||
!roomsLoaded ||
!clinicianRoomIdsLoaded
```

Then pass a loading state into the room list while `!sessionsLoaded`.

Required touch points:

- Add a `sessionsLoading` prop to `RoomContainer`.
- Reuse `SessionRowSkeleton` from `src/components/clinic/session-row-skeleton.tsx`; it already wraps `SkeletonRow` from `src/components/ui/skeleton.tsx`.
- While `sessionsLoading`, render skeleton rows inside each visible room.
- While `sessionsLoading`, suppress the `No sessions today` empty state in `RoomContainer`.
- While `sessionsLoading`, render every room as fully-expanded so skeleton rows are visible. Do not derive expansion from `group.sessions` while it is intentionally empty.
- Implementation hint: compute an `effectiveAutoState = sessionsLoading ? "fully-expanded" : autoState`, then thread that through the initial expansion state and the sync effect. Avoid sprinkling one-off `sessionsLoading` branches through the render path.
- On `sessionsLoading: true -> false`, recompute the natural expansion state once. Preserve `manualOverride` if the user clicked a room header during loading, so user interaction wins over auto-expansion.
- Preserve the existing single-room behaviour: when `totalRooms === 1`, the room remains fully-expanded. This is the happy path for a clinician assigned to one room.
- Accept that `RunsheetHeader` summary-driven bulk buttons will be absent while sessions are loading and may appear after sessions load. That is preferable to blocking room structure. If the pop-in feels rough, add a subtle header loading state later.
- Replace the current full-page session fetch failure UX with an inline sessions failure state. If rooms and clinician scope loaded but sessions failed, keep room containers visible and show an inline retry banner or retry row for session data.
- Keep `src/app/(clinic)/runsheet/loading.tsx` as a route-module/hard-reload fallback for now. Do not rely on it for data loading after the shell mounts. If it becomes visually inconsistent after Phase 1, simplify it to a shell-level fallback rather than trying to make it data-aware.
- Align loading and loaded container widths. `RunsheetSkeleton` currently uses a wider container than the populated run sheet; after Phase 1 the app will transition from full-page skeleton to room cards with skeleton rows, so mismatched widths will look like a snap. Match the in-shell fallback, route `loading.tsx`, and empty-rooms state to the populated shell width unless there is a deliberate layout reason not to.

### Phase 2: Decouple non-critical run sheet background fetches

Audit both the run sheet mount effect and the location-switch effect in `ClinicDataProvider`. Align them around the same principle: critical room/session fetches start immediately; non-critical data never blocks room rendering.

Critical:

- `refreshRooms(locationId)`
- `refreshClinicianRoomIds(locationId)`
- `refreshSessions(locationId)`

Background:

- `refreshWorkflows(orgId)`
- `refreshForms(orgId)`
- `refreshFiles(orgId)`
- onboarding state

Background fetches should never affect whether rooms render.

Today, cold load starts workflows/forms/files from `RunsheetShell`, while location switch does not. Align both paths by removing that prewarm from `RunsheetShell`; the Process flow should fetch those slices on mount if they are missing. The important rule is that neither path blocks room rendering.

Acceptance criteria:

- Opening Process flow on a cold run sheet where workflows/forms/files have not loaded still shows correct outcome pathways, form names, and file names before the user confirms an outcome.
- `ProcessFlowOutcome` fetches missing `forms`, `files`, and workflow/outcome data via existing store refresh actions.
- Implementation note: call `refreshWorkflows(orgId)`, `refreshForms(orgId)`, and `refreshFiles(orgId)` when `workflowsLoaded`, `formsLoaded`, or `filesLoaded` are false. `refreshWorkflows` backs both `outcomePathways` and workflow template/block data.
- Readiness can keep its own `refreshWorkflows` call; it has independent workflow UI dependencies and should not depend on Process flow prewarming.

### Phase 3: Add route and bundle intent preloading

Start with the smallest useful set:

- Add `onMouseEnter` / `onFocus` prefetch behaviour to sidebar nav items, using `router.prefetch(href)`.
- Add bundle preload hooks for heavy dynamic panels only if they are noticeably delayed on first open.

Acceptance bar:

- If first-open panel paint is under 200ms after click in local testing, do not add custom bundle preloading.
- If first-open panel paint is over 200ms for a common path, add a targeted preload for that panel only.

Do not add data prefetch everywhere. Add data prefetch only for high-confidence paths after measuring.

### Phase 4: Standardise loaded/error/empty states

Each page should distinguish:

- loading: data not loaded yet
- error: load failed and retry is available
- empty: loaded successfully but there are no records

This prevents "empty" screens from flashing while fetches are still pending.

For the run sheet, prefer the inline sessions retry pattern from Phase 1 once rooms have loaded. Full-page retry is still appropriate only when the structural data required to draw rooms cannot load.

### Phase 5: Add low-noise performance marks

Add temporary instrumentation around the run sheet cold path using `performance.mark` / `performance.measure`:

- start run sheet mount
- rooms loaded
- clinician room IDs loaded
- sessions loaded
- first room render

Gate all marks behind `if (process.env.NODE_ENV !== "production")`. Remove the temporary marks in the same PR that validates and ships the behaviour, unless the team deliberately chooses to keep a tiny permanent measurement helper.

When interpreting the numbers, account for the Socket.IO connect handler's freshness-windowed resync. A cold load may include a socket-triggered `refreshSessions` or `refreshReadiness` if connect lands before the fresh slice timestamp is set. Measure that before treating duplicate fetches as a new regression.

### Phase 6: Remove dead hydration code

This can ship independently before the performance work.

Remove the unused SSR hydration actions from `clinic-store.ts` unless a near-term change will use them:

- `hydrateFromInitialData`
- `hydrateRunsheetSlices`

The current direction is a thin-client run sheet with fetch-if-empty slices. Dead hydration methods point contributors back toward the previous SSR hydration model.

Before deleting, do one explicit check against in-flight local docs/branches or recent work notes to confirm nothing is about to reintroduce `RunsheetHydrator` or SSR slice hydration.

Concrete check:

- `rg "hydrateFromInitialData|hydrateRunsheetSlices|RunsheetHydrator" src docs`
- skim relevant `docs/devlogs/` notes
- check any active WIP branch notes before deleting

## Non-Goals

- No Redis cache.
- No service worker cache.
- No IndexedDB/localStorage/sessionStorage cache for patient or clinic data yet.
- No full migration to React Query/SWR/TanStack Query.
- No server-side rendering rewrite for every clinic page.
- No preload-all-data strategy.

## Risks

- Rendering rooms before sessions can create a misleading "empty room" flash if the UI is not explicit. Use loading rows, not empty-state copy, until sessions are loaded.
- Expansion state can visibly jump if it is calculated from an intentionally empty sessions array. Handle loading as a separate state rather than as an empty room.
- The header can gain bulk-action buttons after sessions load. This is acceptable if the layout remains stable.
- Clinician room filtering must wait for `clinicianRoomIdsLoaded`. Showing all rooms temporarily is not acceptable.
- Too much hover prefetch can compete with the current page's critical requests. Keep it scoped.
- Background fetches still consume bandwidth. They should be low priority and should not block the first useful frame.

## Verification

- Cold load `/runsheet`: shell appears quickly, rooms appear before session data if sessions are slow, then rows populate.
- Cold load as clinician: never shows rooms outside clinician scope.
- Warm navigation `/readiness -> /runsheet`: existing store data paints immediately.
- Location switch: old location data does not flash under the new selected location.
- Location switch: no worse double-flash than today. Expected sequence is old location disappears, room skeleton appears briefly if needed, new location rooms appear, then sessions populate.
- Slow sessions API simulation: room containers remain visible with loading rows.
- Failed sessions API: room containers remain visible and the user gets an inline retry affordance for sessions, not a full-page retry if rooms loaded successfully.
- Process flow first open: if still slow, bundle preload is added specifically for that path.
- Dead hydration methods are deleted or clearly marked as intentionally unused.
