# Run sheet nav performance + auth-gate location-scoped routes

**Date:** 2026-05-12

## Context

`/runsheet` felt slower than every other clinic page on soft navigation. The user wanted to know if persistence (sessionStorage) was the right first step. The original plan in `docs/plans/runsheet-nav-performance.md` proposed a 14-step Zustand+sessionStorage layer with custom versioning, identity scoping, debounce-cancel races, and dev-switcher plumbing.

I pushed back: too much surface area for a perf fix that hadn't been measured. The user agreed and proposed a simpler first pass — thin the page, move onboarding client-side, add a skeleton gate. I sharpened: skip the "halve SSR time" middle ground entirely, and drop mount-time stale checks (they only matter once persistence exists, which we weren't doing).

Final scope landed as two units shipped to main as separate commits:

- **Unit A (`d55d485`)** — Auth-gate four location-scoped API routes. Pre-existing bug; surfacing it was the only reason we caught it. Had to ship first because the thin-client path makes the API the only access path.
- **Unit B (`b14c5d3`)** — Thin-client `/runsheet`, skeleton gate, onboarding fetch effect, store changes for `onboardingLoaded`, clinician zero-room filter fix, stale-response guards, retry affordance.

Five rounds of review feedback after the initial implementation. Each round caught a different class of bug.

## Plan-first

Two plan rewrites before any code:

- **Round 1** of plan critique: the 14-step sessionStorage plan was premature without measurements. Simpler path: thin `page.tsx` + skeleton gate. Re-wrote.
- **Round 2** of plan critique: should also auth-gate `/api/settings/rooms` (cold-loaded by `RunsheetShell`); pull the auth check into a shared helper; treat the unit-B steps as one shippable bundle, not nine independent commits; fix the clinician zero-room "show all rooms" fallback while we're already changing the gate; add `resetOnboarding()` for logout. Re-wrote.

Final plan was ~250 lines, structured as Unit A (independent, ships first) + Unit B (single bundle).

## What shipped

### Unit A — Auth-gate location-scoped API routes

Four routes accepted a `location_id` and returned data with no auth check:

- `/api/runsheet` (sessions)
- `/api/settings/rooms` GET (rooms + clinicians; also POST/PATCH/DELETE — see review round 1 below)
- `/api/runsheet/clinician-rooms` (had auth but no assignment check)
- `/api/readiness` (appointments + workflow actions)

Anyone who could guess a location ID could read sessions, rooms, clinician assignments, readiness data. Pre-existing; the thin-client change amplified it (the API would become the only access path).

New helper in `src/lib/auth/staff-access.ts`:

```ts
requireStaffLocationAccess(locationId): Promise<
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; status: 401 | 403 }
>
```

SSR-bound Supabase client for the auth check + assignment lookup (RLS on `staff_assignments` already restricts users to their own rows, so service-role isn't needed). Matches the existing discriminated-union result pattern in `staff-access.ts`. Returns 403 (not 404) for location mismatches — location IDs aren't patient-sensitive, so existence leaks don't matter the way they do for `assertStaffCanAccessPatient`.

For mutation routes that take a room ID rather than a location ID, a `gateRoomMutation(roomId)` helper resolves the room's location then calls the shared helper.

### Unit B — Thin-client /runsheet

Replaced `/runsheet/page.tsx` with a three-line wrapper. Deleted `runsheet-hydrator.tsx`, `onboarding-hydrator.tsx`, and the inlined `getOnboardingState` server helper. `RunsheetShell` already had a fetch-if-empty effect that becomes the cold-load path.

**New `GET /api/onboarding/state`** returns the same `OnboardingState` shape the SSR helper used to produce. Auth-gates via `requireAuthenticatedUser()` first, then service-role lookups. `RunsheetShell` fetches it on mount if `!onboardingLoaded`.

**Store changes** (`src/stores/clinic-store.ts`):

- `onboardingLoaded: boolean`, default `false`. `setOnboarding(...)` flips it to `true`. Without this, every user including those who completed onboarding months ago would see the first-run modal flash for one frame on every cold load (default `stage === 'not_started'` matches the modal's render condition).
- `resetOnboarding()` action — resets to default and flips `onboardingLoaded` back to `false`. Wired into the sidebar sign-out handler alongside `resetLocationData()`.

**Skeleton gate at the top of `RunsheetShell`'s render:**

```tsx
if (
  storeLocationId !== locationId ||
  !sessionsLoaded ||
  !roomsLoaded ||
  !clinicianRoomIdsLoaded
) {
  return <RunsheetSkeleton />;
}
```

All four checks are load-bearing. `storeLocationId !== locationId` covers the window after the user picks a new location but before `ClinicDataProvider`'s effect has reset the store and refetched — without it, briefly renders the previous location's data under the new location's context. `clinicianRoomIdsLoaded` matters because `visibleRooms` falls through to "show all rooms" if `clinicianRoomIds` is empty.

**Clinician zero-room filter fix.** The original filter was `if (clinicianRoomIds.length > 0 && role === "clinician")`. A clinician with zero assigned rooms (legitimately, after load) saw *all* rooms. The skeleton gate now guarantees `clinicianRoomIdsLoaded === true` before `visibleRooms` runs, so the filter simplifies to `if (role === "clinician")` and an empty array correctly produces an empty filter result.

**Stale-response guards** on `refreshSessions`, `refreshRooms`, `refreshClinicianRoomIds`, `refreshReadiness`, `refreshPaymentConfig`. Before applying response data:

```ts
if (get().locationId !== locationId) return;
```

Without this, a request issued for location A that completes after the user switches to B would paint A's data over B's empty state and flip `loaded` flags true. Adding the guard for `refreshReadiness` and `refreshPaymentConfig` too — same class of bug, two-line fix per slice, even though only the three runsheet-critical slices were flagged.

**Cold-load failure detection.** If a fetch fails, the loaded flag never flips and the user stares at the skeleton forever. Tracked locally as `fetchError` state; renders an error card with a Retry button that bumps `retryKey` to re-trigger the fetch effect. Settle-then-inspect pattern: kick off the refreshes, await `Promise.all` settlement, then check whether the required flags actually flipped. Doesn't touch the store, doesn't introduce unhandled rejections in fire-and-forget callers (see review round 4).

## Review feedback rounds

Five rounds of review after the first implementation. Each caught a different category of bug.

### Round 1: write-method auth hole

`/api/settings/rooms` GET was gated, but the file also has POST/PATCH/DELETE handlers that all used the service client with no auth check. The same public route could create, mutate, or delete rooms by supplying IDs in the body. Pre-existing but in-scope: shipping "settings rooms gated" while leaving the write methods open would be misleading.

Added `gateRoomMutation(roomId)`:
- POST takes `location_id` directly → use `requireStaffLocationAccess` from the existing helper.
- PATCH/DELETE take a room `id` → look up the room's `location_id` first, then gate.

`clinician_assignment_ids` validation (ensuring those staff assignments belong to the same location) flagged as residual risk, deferred to a separate auth-integrity pass.

### Round 2: stale-response guards in refresh actions

The refresh actions could set loaded flags from stale requests after a location switch. With the thin-client cold path more in-flight fetches become possible. Added `if (get().locationId !== locationId) return` to each refresh action right before the `set()` call.

### Round 3: permanent skeleton if cold fetch fails

Skeleton gate is loaded-flag-driven, but the store only flips loaded flags on success. Any transient/network failure would leave users staring at the skeleton forever. Initial fix re-threw from the three runsheet-critical refreshes so `RunsheetShell` could `.catch` them — that broke round 4 (next).

### Round 4: skeleton can flash A's data under B's context; stale failure can poison new fetchError

Two race conditions in the new skeleton-gate code:

- Gated only on loaded flags, not on store-data-belongs-to-current-location. On location switch, can flash previous location's data until `ClinicDataProvider`'s effect resets it. Added `storeLocationId !== locationId` to the gate.
- `setFetchError` could fire from an old location's failed request after the user switched away. Added a `cancelled` cleanup flag on the fetch effect.

Also flagged: `gateRoomMutation` did the service-role room lookup *before* authenticating, which lets unauthenticated callers distinguish real vs fake room IDs (401 vs 404). Reordered to `requireAuthenticatedUser()` first, then lookup, then `requireStaffLocationAccess`. Confirmed with curl: unauthenticated PATCH/DELETE on a bogus ID now returns 401, not 404.

### Round 5: re-throw from refresh actions poisoned fire-and-forget callers

Re-throwing from `refreshSessions`/`refreshRooms`/`refreshClinicianRoomIds` (added in round 3) created unhandled-rejection risk for every fire-and-forget caller across the app: `clinic-data-provider.tsx`, `rooms-settings-shell.tsx`, `process-flow-outcome.tsx`, plus a store-internal caller. Before round 3 those callers had been swallowing failures safely; the round-3 fix poisoned them.

Reverted the re-throws. Switched `RunsheetShell`'s failure detection to a settle-then-inspect pattern: kick off the refreshes, await `Promise.all` settlement (none reject — they all swallow), then inspect whether the required loaded flags actually flipped. Preserves the store's atomic `set` boundary (each action sets `sessions + sessionsLoaded + sessionsFetchedAt` together) which a direct-fetch approach in the shell would have broken — `*FetchedAt` powers the socket-connect race-suppression gate, and dropping it would silently regress.

## What's deliberately not in this PR

- **sessionStorage persistence.** Out of scope. The same-tab F5 case is now a cold load (previously SSR painted directly). If F5 latency becomes a complaint, that's the trigger to revisit. Plan still on disk in `docs/plans/runsheet-nav-performance.md` if needed.
- **Per-slice stale-time checks on mount.** Without sessionStorage, the only "stale" case is socket-driven mutations to data already in the store, already covered by socket handlers.
- **`clinician_assignment_ids` validation on rooms POST/PATCH.** Flagged round 1.
- **Tightening API routes outside the runsheet cold-load path.** Audit listed `/api/settings/payments`, `/api/readiness/mark-*`, `/api/readiness/add-patient`, `/api/patient/arrive`, `/api/patient/[id]`, `/api/intake/*`, `/api/setup/*`, `/api/onboarding/test-session`. Separate auth-audit pass.
- **Admin-role gating on writes.** Settings UI is restricted to clinic_owner/practice_manager today, but the server doesn't enforce it. Wider hardening pass.
- **Fixing `hydrateRunsheetSlices` (now dead code).** Only `RunsheetHydrator` called it, and that's deleted. Leaving in place to keep the diff focused.

## Verification

Manual smoke tests on the running dev server (curl, not browser — browser-level verification still on the user):

- All four newly-gated routes return 401 when unauthenticated (was 200 with leaked data).
- `/api/settings/rooms` PATCH/DELETE return 401 for both real and fake room IDs (was 404 for fake IDs before round-4 reorder — existence leak).
- `/api/onboarding/state` returns 401 unauthenticated.
- `/runsheet` returns 307 to `/login` unauthenticated (middleware behavior, unchanged).
- `tsc --noEmit` clean.
- `npm run lint` clean for all touched files. Two pre-existing warnings in `runsheet-shell.tsx` (`isClinician` assigned but unused; stale eslint-disable directive) — unrelated, didn't touch them.
- No compile errors in dev-server logs.

## Lessons

Things I'd do differently:

- **Wouldn't re-throw from a store action to surface failures.** That decision in round 3 created the round-5 problem. The store had been swallowing for a reason — multiple fire-and-forget callers depended on it. Should've started with settle-then-inspect, or accepted that the cold-load gate needs its own fetch path entirely. The pattern was: re-throw seemed like the smaller diff, but the blast radius was wider than the visible callers.
- **Reorder auth-before-lookup is a real pattern worth always applying, not just an existence-leak nicety.** `gateRoomMutation` in round 4 was the second time this exact bug pattern showed up in this codebase (the first was `assertStaffCanAccessPatient` already documenting it). Worth treating as a lint-level rule: any route that takes an opaque ID and does a service-role read should auth first, always.
- **The 14-step plan was a real anti-example of premature optimization.** The user's instinct to question it was correct. The shipped fix is roughly 1/4 the surface area and addresses the actual bottleneck. Worth treating "have we measured?" as the first review question on any perf plan, not the last.

## Files touched

### Unit A (commit `d55d485`)
- `src/lib/auth/staff-access.ts` — new `requireStaffLocationAccess`.
- `src/app/api/runsheet/route.ts`
- `src/app/api/runsheet/clinician-rooms/route.ts`
- `src/app/api/readiness/route.ts`
- `src/app/api/settings/rooms/route.ts` — GET + POST + PATCH + DELETE, with new `gateRoomMutation` helper.

### Unit B (commit `b14c5d3`)
- `src/app/(clinic)/runsheet/page.tsx` — thin client wrapper.
- `src/app/(clinic)/runsheet/loading.tsx` — uses extracted skeleton.
- `src/app/api/onboarding/state/route.ts` — new, auth-gated.
- `src/components/clinic/runsheet-hydrator.tsx` — deleted.
- `src/components/clinic/onboarding-hydrator.tsx` — deleted.
- `src/components/clinic/runsheet-skeleton.tsx` — new, extracted from `loading.tsx`.
- `src/components/clinic/runsheet-shell.tsx` — skeleton gate, onboarding fetch, retry affordance, clinician filter fix, diagnostic log removed.
- `src/components/clinic/onboarding-overlay.tsx` — gated on `onboardingLoaded`.
- `src/components/clinic/onboarding-coach-mark.tsx` — gated on `onboardingLoaded`.
- `src/components/clinic/sidebar-user-section.tsx` — `resetOnboarding()` + `resetLocationData()` on sign-out.
- `src/stores/clinic-store.ts` — `onboardingLoaded`, `resetOnboarding()`, stale-response guards on five refresh actions.
- `docs/plans/runsheet-nav-performance.md` — final plan committed alongside the implementation.
