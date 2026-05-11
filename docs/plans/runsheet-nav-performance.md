# Run Sheet Navigation Performance

## Problem

Navigating to `/runsheet` feels slower than sibling clinic pages (readiness, forms, workflows, settings). Those pages are thin client wrappers; `/runsheet` is the only one that does meaningful SSR data fetching, which blocks paint on every navigation.

### Why it happens today

`src/app/(clinic)/runsheet/page.tsx` runs on every request:

1. `supabase.auth.getUser()` — duplicates the auth check the `(clinic)` layout already performs.
2. `getOnboardingState(user.id)` — three sequential service-role queries (`users`, `staff_assignments`, `sessions`).
3. `fetchUserClinicAssignments(user.id, fullName)` — duplicates the layout's assignment fetch.
4. `Promise.all([fetchRunsheetSessions, fetchRoomsWithClinicians, fetchClinicianRoomIds])` — the heavy joined sessions query plus two more.

Because `auth.getUser()` and `cookies()` are called, the route is force-dynamic. There is no cache. The persistent Zustand store (`src/stores/clinic-store.ts`) already holds warm data across same-tab navigations, but the SSR fetch runs anyway and `RunsheetHydrator` overwrites the store on every nav.

The original motivation for SSR (avoid empty-state flicker on warm soft-nav) is already solved by the Zustand store. SSR-on-every-nav is now overkill.

### Pre-existing bugs

**Two API routes are unauthenticated:**

- `src/app/api/runsheet/route.ts` accepts a `locationId` and returns sessions with no auth check.
- `src/app/api/settings/rooms/route.ts` `GET` accepts a `location_id` and returns rooms/clinicians with no auth check. `RunsheetShell` cold-loads rooms through this route, so securing only `/api/runsheet` still leaks room data.

Moving fetches client-side amplifies both — the API routes become the only access path, and anyone who can guess or enumerate location IDs can read sessions and room data. Both must be fixed before the thin-client change.

**Clinician zero-room filter falls through to "show all rooms."** `runsheet-shell.tsx:90-95` currently filters with `if (clinicianRoomIds.length > 0 && role === "clinician")`. A clinician with zero assigned rooms (legitimately, after load) sees *all* rooms — the loaded flag now gives us a clean way to fix this.

## Goal

- Warm soft-nav into `/runsheet`: no SSR data work. The Zustand store renders immediately from memory.
- True cold load (new tab, never visited): in-shell skeleton → fetch → render. No empty-state flash, no clinician "all rooms" flash, no first-run onboarding modal flash.
- `/api/runsheet` and `/api/settings/rooms` `GET` properly auth-gated via a shared helper.
- Clinician with zero assigned rooms sees zero rooms once loaded (correctness fix exposed by the same gate).

Out of scope: sessionStorage persistence across same-tab refresh. Defer until measured.

## Approach

Two units of work. Ship in this order.

### Unit A: Authorization (independent, ship first)

#### A1. Add a shared `requireStaffLocationAccess` helper

Beside `requireAuthenticatedUser()` in `src/lib/auth/staff-access.ts`. Authenticates the caller, then verifies they have a `staff_assignment` to the requested `locationId`. Returns either the user + assignment or a `NextResponse` to short-circuit. Used by all location-scoped API routes.

Approximate shape:

```ts
// src/lib/auth/staff-access.ts
export type StaffLocationAccess = {
  user: { id: string; email: string | null };
  // any other useful fields, e.g. assignment.role
};

export async function requireStaffLocationAccess(
  locationId: string
): Promise<StaffLocationAccess | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: assignment } = await service
    .from("staff_assignments")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("location_id", locationId)
    .maybeSingle();

  if (!assignment) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return { user: { id: user.id, email: user.email ?? null } };
}
```

#### A2. Auth-gate `/api/runsheet/route.ts`

```ts
export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 });
  }

  const access = await requireStaffLocationAccess(locationId);
  if (access instanceof NextResponse) return access;

  const sessions = await fetchRunsheetSessions(locationId);
  return NextResponse.json({ sessions });
}
```

#### A3. Auth-gate `/api/settings/rooms/route.ts` `GET`

Apply the helper at the top of the `GET` handler. Both the default rooms branch and the `?type=clinicians` branch route through it. Other verbs (`POST`/`PATCH`/`DELETE`) take an `id` not a `location_id`; tightening them is a separate concern — flag but don't fix here.

#### A4. Quick audit, same change

Grep for other route handlers that read `location_id` / `locationId` from the request and run service-role queries without an auth gate. Fix any obvious peers (e.g. `/api/readiness`, payments-related routes) in the same PR. Note any non-trivial ones for follow-up rather than expanding scope.

Ship Unit A. Verify the existing SSR-backed runsheet keeps working (today's SSR path doesn't hit these routes; only the client refresh path does, plus a couple of settings views).

### Unit B: Thin-client `/runsheet` (single shippable bundle)

These steps must ship together. Landing the thin `page.tsx` before the gates land produces exactly the flashes the plan exists to avoid.

#### B1. Extract `RunsheetSkeleton`

From `src/app/(clinic)/runsheet/loading.tsx` into `src/components/clinic/runsheet-skeleton.tsx`. The existing `loading.tsx` either imports the new component for the page-module-load window, or is deleted (Next.js falls back to the parent layout's loading state).

#### B2. Store changes (`src/stores/clinic-store.ts`)

- Add `onboardingLoaded: boolean` (default `false`). `setOnboarding(...)` flips it to `true`.
- Add a `resetOnboarding()` action that resets `onboarding` to default and sets `onboardingLoaded: false`. The logout handler and any in-tab user-change path should call this; without it, Zustand memory survives client-side auth transitions inside the tab and the next user can briefly see the previous user's onboarding stage. Wire `resetOnboarding()` into the existing sidebar `signOut()` handler in this PR.

#### B3. New `GET /api/onboarding/state` route

Auth-gates via `supabase.auth.getUser()` first (no `locationId` here, so the new helper isn't applicable — use the existing auth pattern), then service-role lookups for the same `OnboardingState` shape `getOnboardingState` produces today.

#### B4. Gate onboarding UI on `onboardingLoaded`

Update `OnboardingOverlay` and `OnboardingCoachMark` to render `null` while `!onboardingLoaded`. Without this, every user — including those who completed onboarding months ago — sees the first-run modal flash until the fetch lands.

#### B5. Onboarding fetch effect

In `RunsheetShell`, on mount: if `!onboardingLoaded`, fetch `/api/onboarding/state` and call `setOnboarding(response)`.

#### B6. Loaded-state skeleton gate in `RunsheetShell`

At the top of `RunsheetShell`'s render, before any other logic:

```tsx
const sessionsLoaded = useClinicStore((s) => s.sessionsLoaded);
const roomsLoaded = useClinicStore((s) => s.roomsLoaded);
const clinicianRoomIdsLoaded = useClinicStore((s) => s.clinicianRoomIdsLoaded);
if (!sessionsLoaded || !roomsLoaded || !clinicianRoomIdsLoaded) {
  return <RunsheetSkeleton />;
}
```

All three flags are required. Without `clinicianRoomIdsLoaded`, the clinician "all rooms" flash returns.

#### B7. Fix the clinician zero-room filter

Change `visibleRooms` in `runsheet-shell.tsx:90-95` from:

```tsx
if (clinicianRoomIds.length > 0 && role === "clinician") {
  return rooms.filter((r) => clinicianRoomIds.includes(r.id));
}
return rooms;
```

to:

```tsx
if (role === "clinician") {
  return rooms.filter((r) => clinicianRoomIds.includes(r.id));
}
return rooms;
```

The gate guarantees `clinicianRoomIdsLoaded === true` by the time this runs, so an empty array now correctly means "zero assigned rooms" → empty filter result, not "not loaded yet" → fall through to all rooms. This is a correctness fix the gate makes safe.

#### B8. Make `runsheet/page.tsx` a thin client wrapper

Replace the file with:

```tsx
import { RunsheetShell } from "@/components/clinic/runsheet-shell";

export default function RunSheetPage() {
  return <RunsheetShell />;
}
```

Delete:

- `src/components/clinic/runsheet-hydrator.tsx`
- `src/components/clinic/onboarding-hydrator.tsx` (verify no other callers first)
- The `getOnboardingState` server helper inline in the old `page.tsx`

`RunsheetShell` already fetches sessions/rooms/clinicianRoomIds on mount via `getClinicStore().refresh*` when the slices are unloaded (`runsheet-shell.tsx:59-80`). That becomes the cold-load path.

#### B9. Strip diagnostic `console.log`

In `runsheet-shell.tsx:62-69`.

#### B10. Measure

If `/runsheet` still feels slower than `/readiness` after this, revisit with numbers. sessionStorage persistence stays deferred until then.

## Verification

- **Cold load** (new incognito tab → login → /runsheet): `RunsheetSkeleton` renders. No "No rooms configured" flash. No first-run onboarding modal flash for users who already onboarded. No "all rooms" flash for clinicians. Data lands, content renders.
- **Warm soft nav** (/readiness → /runsheet → /readiness → /runsheet): instant paint from Zustand. No `/api/runsheet` or `/api/settings/rooms` request after the first visit in the tab. (Next's RSC payload for the route segment may still fire — expected.)
- **Same-tab F5 refresh**: full cold load. Skeleton → fetch → render.
- **Clinician with assigned rooms**: cold load shows skeleton, then only the clinician's rooms.
- **Clinician with zero assigned rooms**: cold load shows skeleton, then an empty run sheet (not all rooms). This is the new correct behavior.
- **Location switch via sidebar switcher**: existing `resetLocationData` path runs, skeleton briefly visible, fetch completes.
- **`/api/runsheet` auth**: unauthenticated → 401. Authenticated for a `locationId` the user is not assigned to → 403. Authenticated + assigned → sessions.
- **`/api/settings/rooms` `GET` auth**: same matrix as `/api/runsheet` for both the default rooms branch and `?type=clinicians`.
- **Onboarding state**: completed-onboarding user does NOT see the first-run modal flash. New user sees it once `/api/onboarding/state` resolves.
- **Logout**: after `signOut()`, `resetOnboarding()` flips `onboardingLoaded` back to `false`. Next login starts clean — no stale onboarding stage from the previous user.

## Risks and trade-offs

- **First-ever cold load shows skeleton briefly.** Acceptable; matches every other clinic page. If profiling later shows this is a real complaint, revisit with sessionStorage persistence — but only with numbers.
- **Same-tab F5 is now a full cold load.** Before this change, SSR painted the run sheet directly on F5. After, F5 shows skeleton. This is the explicit trade: every nav was paying SSR cost to make F5 (a rare action) faster. If F5-after-refresh latency becomes a complaint, that's the trigger for the sessionStorage layer.
- **`/api/onboarding/state` adds one HTTP request on cold load.** Runs in parallel with the runsheet fetches. Net cold-load time should still drop because the duplicate SSR auth/assignment work is gone.
- **In-tab user change without logout/login is unhandled.** If the app ever supports re-authenticating as a different user without a hard reload, Zustand state from the previous user persists. `resetOnboarding()` handles onboarding specifically; full session reset (location data, etc.) would need a broader hook. Out of scope until the flow exists.

## Out of scope (deferred)

- **sessionStorage persistence of runsheet slices.** Custom or Zustand's built-in `persist`. Defer until measured need.
- **Per-slice stale-time checks on mount.** Without sessionStorage, the only "stale" case is socket-driven mutations to data already in the store — already covered by existing socket handlers. Mount-time stale checks only matter once data persists across reloads.
- **Cross-tab sync** via `BroadcastChannel` or storage events.
- **Migrating other clinic pages** to a different data pattern. They're already fast.
- **Tightening `/api/settings/rooms` `POST`/`PATCH`/`DELETE`** auth. Different access pattern (room `id`, not `location_id`). Separate change.

## Files touched

### Unit A
- `src/lib/auth/staff-access.ts` — add `requireStaffLocationAccess(locationId)`.
- `src/app/api/runsheet/route.ts` — use the helper.
- `src/app/api/settings/rooms/route.ts` — use the helper in `GET`.
- Other location-scoped API routes flagged by the audit.

### Unit B
- `src/app/api/onboarding/state/route.ts` — new (auth-gated via `getUser()`).
- `src/app/(clinic)/runsheet/page.tsx` — replaced with thin client wrapper.
- `src/app/(clinic)/runsheet/loading.tsx` — kept (using extracted skeleton) or deleted.
- `src/components/clinic/runsheet-hydrator.tsx` — deleted.
- `src/components/clinic/onboarding-hydrator.tsx` — deleted if unused elsewhere.
- `src/components/clinic/runsheet-skeleton.tsx` — new (extracted from `loading.tsx`).
- `src/components/clinic/runsheet-shell.tsx` — loaded-state skeleton gate; onboarding fetch effect; clinician zero-room filter fix; drop diagnostic console.log.
- `src/components/clinic/onboarding-overlay.tsx` — gate render on `onboardingLoaded`.
- `src/components/clinic/onboarding-coach-mark.tsx` — gate render on `onboardingLoaded`.
- `src/components/clinic/sidebar.tsx` (or wherever logout lives) — call `resetOnboarding()` around `signOut()`.
- `src/stores/clinic-store.ts` — add `onboardingLoaded` flag and `resetOnboarding()` action.
