# Runsheet structure-first loading + Process flow self-fetch

**Date:** 2026-05-15

## Context

Cold load of `/runsheet` waited on session data before painting anything — 3-5s of full-page skeleton even when the room structure was already cheap to draw. Sessions are the most volatile, query-heavy slice; rooms and clinician scope are stable and fast. Same gate, different cost profiles.

Plan in `docs/plans/app-loading-performance.md` was already written and reviewed in this thread. Three review passes tightened it before any code:

- **Round 1** flagged that Phase 2 isn't a relocation — `ProcessFlowOutcome` reads `forms`/`files`/`outcomePathways` but never fetches them. Pulling the prewarm out of `RunsheetShell` without adding a fetch-on-mount in the Process flow would break the outcome step on cold load.
- **Round 2** added an `effectiveAutoState` hint for `RoomContainer` (so loading-state expansion logic doesn't get sprinkled across the render path), and noted the Socket.IO connect handler's freshness-windowed resync as a measurement caveat.
- **Round 3** caught a width-snap between `RunsheetSkeleton` (`max-w-7xl`) and the populated shell (`max-w-[860px]`), and made the Phase 6 dead-hydration cleanup check concrete (`rg "hydrateFromInitialData|hydrateRunsheetSlices|RunsheetHydrator" src docs`).

Phases 4 (standardise loading/error/empty across pages) and 5 (temporary perf marks) were dropped before implementation. Phase 4 was largely covered by Phase 1's inline sessions retry; Phase 5 was instrumentation we'd remove anyway without a measurement campaign to justify it.

## What shipped

Single commit `638241a`, merged to main as `d64c4c6`. Phases 1, 2, 3, 6.

### Phase 1 — Rooms before sessions

The full-page skeleton gate dropped one term:

```ts
// before
storeLocationId !== locationId || !sessionsLoaded || !roomsLoaded || !clinicianRoomIdsLoaded

// after
storeLocationId !== locationId || !roomsLoaded || !clinicianRoomIdsLoaded
```

`RoomContainer` gained a `sessionsLoading` prop. While true: force `autoState = "fully-expanded"` (don't derive expansion from an intentionally empty sessions array), render three `SessionRowSkeleton` rows, suppress the empty-state copy, suppress the show-all / show-less toggles. The existing `useEffect` at room-container.tsx:85 already handles the loaded→loaded recompute correctly: when `sessionsLoading` flips false, `autoState` transitions from the forced `"fully-expanded"` to the natural value, and the effect re-syncs unless the user manually overrode during loading.

Cold-load failure UX was split. If rooms or clinician scope fail, the full-page retry stays — we can't draw structure. If only sessions fail, an inline red banner appears above the rooms with a retry button. The rooms stay drawn.

`RunsheetSkeleton` width changed from `max-w-7xl` to `max-w-[860px]` to match the populated shell, so the load → loaded transition doesn't snap horizontally.

### Phase 2 — Move prewarm into Process flow

`RunsheetShell` was prewarming workflows/forms/files on cold load because `ProcessFlowOutcome` needs them later. That blocked the first frame on three org-wide API calls the user may never need this session.

Removed the prewarm from `RunsheetShell`. Added a fetch-if-empty effect to `ProcessFlowOutcome`:

```ts
useEffect(() => {
  if (!orgId) return;
  const store = getClinicStore();
  if (!store.workflowsLoaded) void store.refreshWorkflows(orgId);
  if (!store.formsLoaded) void store.refreshForms(orgId);
  if (!store.filesLoaded) void store.refreshFiles(orgId);
}, [orgId]);
```

`refreshWorkflows` backs both `outcomePathways` and workflow template/block data — one call covers two store reads in `ProcessFlowOutcome`. Readiness keeps its own `refreshWorkflows` call (independent dependency, not a Process-flow consumer).

Stale comment removed: the line above `storePathways` used to say "already hydrated on mount" — true while `RunsheetShell` prewarmed, misleading after the move.

### Phase 3 — Sidebar hover/focus prefetch

`SidebarNavItem` already used Next's `<Link>`, which auto-prefetches when items enter the viewport. For a sidebar where every item is visible immediately, that prefetches everything at once and competes with the current page's critical requests.

Added `onMouseEnter` and `onFocus` handlers calling `router.prefetch(href)`, scoped to inactive items only. Tighter signal, no data prefetch.

### Phase 6 — Delete dead hydration code

`hydrateFromInitialData`, `hydrateRunsheetSlices`, and the `ClinicInitialData` interface were dead since the thin-client switch but left in place to keep the prior diff focused (`runsheet-perf-and-auth-gate-2026-05-12.md` line 135 explicitly flagged the deferral). Grep confirmed zero callers outside the definitions themselves. Deleted both actions, their type signatures on the store interface, and the unused interface. -120 lines.

## What I did not do

- **No manual UI smoke test.** TypeScript clean, `next build` succeeded. Per CLAUDE.md I flagged this explicitly when handing off — runtime verification (slow-network cold load, single-room clinician, sessions-failure inline retry, location switch, Process flow first open) is still owed.
- **No persistence layer.** Plan's non-goals: no Redis, no service worker, no IndexedDB/localStorage/sessionStorage for clinical data.
- **No data prefetch on hover.** Phase 3 is route-bundle prefetch only. Data prefetch is a measure-first decision per the plan's Phase 4 acceptance bar.

## Surprises

- **Effect re-sync after `sessionsLoading` flips** was the part I expected to need state machinery and didn't. The existing `prevAutoStateRef` + `manualOverride` logic in `RoomContainer` already does the right thing once `autoState` is computed from `sessionsLoading`. Threading one new input was enough; no new effects.
- **`ClinicInitialData` was already orphaned** beyond the dead hydration methods. Phase 6 was supposed to be ~20 lines; it ended up closer to 120 because the whole SSR shape went with it.
- **Lint already had a pre-existing `set-state-in-effect` error** at `room-container.tsx:100` (the auto-clear of `manualOverride` on rising-edge attention). Not introduced by this change; left untouched.

## Files

- `src/components/clinic/room-container.tsx` — sessionsLoading prop, effectiveAutoState, skeleton branches
- `src/components/clinic/runsheet-shell.tsx` — gate change, inline sessions retry, removed prewarm, removed `useOrg` import
- `src/components/clinic/runsheet-skeleton.tsx` — width alignment
- `src/components/clinic/process-flow-outcome.tsx` — fetch-if-empty on mount
- `src/components/clinic/sidebar-nav-item.tsx` — hover/focus prefetch
- `src/stores/clinic-store.ts` — dead hydration removal

## Commits

- `638241a` — Runsheet structure-first loading + Process flow self-fetch (branch `perf/runsheet-structure-first`)
- `d64c4c6` — Merge into main
