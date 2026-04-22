# ~~Navigation Performance: TanStack Query + Next.js App Router~~

> **SUPERSEDED** — This plan has been replaced by the Zustand + Supabase Realtime architecture. See the implementation in `src/stores/clinic-store.ts` and `src/components/clinic/clinic-data-provider.tsx`. The Zustand store provides a centralized cache with Realtime subscriptions in the layout, eliminating the need for TanStack Query.

## Goal (Original)

Make every sidebar navigation feel instant. No spinners, no blank screens, no re-fetching data the user already saw 30 seconds ago. Navigating between Run Sheet → Readiness → Workflows → Forms → Settings should feel like switching tabs in a native app.

## Current state

- Sidebar uses `<Link>` from `next/link` — **already correct**, JS bundles are prefetched
- Clinic layout (`(clinic)/layout.tsx`) persists across navigation — **already correct**
- `loading.tsx` exists for Workflows only — **needs adding to other pages**
- Data fetching uses `useState` + `useEffect` + `fetch` in every shell component — **no caching, refetches on every mount**
- Run Sheet is a server component — data fetches server-side but re-runs on every navigation
- Workflows page has a custom prefetch-all via `/api/workflows/init` — works but is a one-off pattern

## Architecture

```
(clinic)/layout.tsx
  └── QueryClientProvider (TanStack Query — cache lives here, never unmounts)
      └── ClinicProviders (existing — org, location, role context)
          └── Sidebar + page content
```

The `QueryClient` is created once in the layout. Because the layout never unmounts during sidebar navigation, the cache persists across all page visits. This is the core of the architecture.

## Implementation plan

### Phase 1: Foundation (loading skeletons + TanStack Query setup)

**1. Install TanStack Query + DevTools**
```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

DevTools is a dev-only dependency (stripped from production builds). Install it from the start — it shows every cache entry, its staleness, and when refetches fire. It's the difference between debugging blind and debugging with a clear picture.

**2. Create `src/lib/query/client.ts`**
```typescript
import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,        // 30s — cached data served instantly
        gcTime: 5 * 60 * 1000,       // 5m — evicted after this
        refetchOnWindowFocus: false,  // OFF by default — enable per-query where needed
        retry: 1,                    // retry once on failure
      },
    },
  });
}
```

> **Why `refetchOnWindowFocus: false` globally?** The Run Sheet uses Supabase Realtime to stay fresh. Refetching on focus would fire a network round-trip that immediately gets overwritten by realtime data — wasted bandwidth and a tiny visual flicker. For pages without realtime (Forms, Settings, Workflows), focus refetch can be enabled per-query: `useQuery({ ..., refetchOnWindowFocus: true })`.

**3. Create `src/components/clinic/query-provider.tsx`**
```typescript
"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { makeQueryClient } from "@/lib/query/client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

**4. Wrap in `(clinic)/layout.tsx`**
Add `<QueryProvider>` as the outermost wrapper around `<ClinicProviders>`. The query cache now persists across all clinic page navigations.

**5. Add `loading.tsx` to every page that doesn't have one**
- `src/app/(clinic)/runsheet/loading.tsx` — skeleton matching room containers + session rows
- `src/app/(clinic)/readiness/loading.tsx` — skeleton matching date sections + appointment rows
- `src/app/(clinic)/forms/loading.tsx` — skeleton matching forms table
- `src/app/(clinic)/settings/loading.tsx` — skeleton matching settings layout
- `src/app/(clinic)/workflows/loading.tsx` — already exists

Each skeleton must match the final page layout precisely. Same widths, same heights, same spacing. No layout shift when real data arrives. **Budget half a day for skeleton design** — this is the part that determines whether the app feels right and tends to get rushed.

### Phase 2: Migrate shell components to useQuery

Convert each shell component from `useState` + `useEffect` + `fetch` to `useQuery`. The API routes stay unchanged — only the client-side fetching code changes.

**Order of migration** (most-visited pages first):

#### 2a. Run Sheet (`runsheet-shell.tsx`) + Realtime → Cache bridge

Current: Server component fetches in `page.tsx`, passes `initialSessions` as props. Client component manages real-time updates separately.

Change:
- `page.tsx` becomes a thin wrapper (no server-side fetch)
- Shell uses `useQuery` with key `["runsheet", locationId]`
- `initialSessions` prop removed
- **Critical: Real-time subscription (`useRealtimeRunsheet`) updates the query cache directly via `queryClient.setQueryData`** — this prevents TanStack Query and Supabase Realtime from having different versions of the truth

```typescript
const { data: sessions } = useQuery({
  queryKey: ["runsheet", locationId],
  queryFn: () => fetch(`/api/runsheet?location_id=${locationId}`).then(r => r.json()),
  // No refetchOnWindowFocus — realtime keeps this fresh
});
```

Realtime → cache bridge (build this in 2a, not later):
```typescript
// In the real-time subscription handler:
const queryClient = useQueryClient();

// When a session update arrives via Supabase Realtime:
queryClient.setQueryData(["runsheet", locationId], (old) => {
  // Merge the real-time update into the cached data
  return updateSessionInList(old, updatedSession);
});
```

> **Why build the realtime bridge now, not in Phase 4?** Without it, you get a category of bugs where the cache has stale data and realtime has fresh data. Which one renders depends on timing. The bridge must be designed in alongside the Run Sheet's useQuery setup — it's not a polish step.

Note: Run Sheet currently fetches via direct Supabase queries in `queries.ts`, not an API route. Create `/api/runsheet` route that wraps the existing query functions for consistency with the rest of the app. (In a greenfield Supabase app you'd skip the API route and call Supabase directly in the queryFn — RLS handles auth at the database level. The reason to build the route here is consistency with the existing codebase.)

#### 2b. Readiness Dashboard (`readiness-shell.tsx`)

Current: `useEffect` + `fetch` to `/api/readiness`, polls every 30s.

Change:
```typescript
const { data } = useQuery({
  queryKey: ["readiness", locationId],
  queryFn: () => fetch(`/api/readiness?location_id=${locationId}`).then(r => r.json()),
  refetchInterval: 30_000,          // replaces the manual polling setInterval
  refetchOnWindowFocus: true,       // readiness should refresh on tab focus
});
```

Remove: `useState` for appointments/loading/error, `useEffect` for fetching, `setInterval` for polling. TanStack Query handles all of it.

#### 2c. Forms (`forms-shell.tsx`)

Current: `useEffect` + `fetch` to `/api/forms`.

Change:
```typescript
const { data, refetch } = useQuery({
  queryKey: ["forms", orgId],
  queryFn: () => fetch(`/api/forms?org_id=${orgId}`).then(r => r.json()),
  refetchOnWindowFocus: true,
});
```

For mutations (create/delete form):
```typescript
const queryClient = useQueryClient();

// After successful create/delete:
queryClient.invalidateQueries({ queryKey: ["forms", orgId] });
```

#### 2d. Settings pages (`payments-settings-shell.tsx`, `rooms-settings-shell.tsx`)

Same pattern as Forms. Replace useEffect fetch with useQuery, invalidate on mutations. Settings data changes rarely — `staleTime: 5 * 60 * 1000` (5 min) is appropriate here.

#### 2e. Workflows (`workflows-shell.tsx`)

Current: Custom `fetchInit` endpoint with prefetch-all maps.

Change: Replace with useQuery using the init endpoint:
```typescript
const { data } = useQuery({
  queryKey: ["workflows", orgId, direction],
  queryFn: () => fetch(`/api/workflows/init?org_id=${orgId}&direction=${direction}`).then(r => r.json()),
  refetchOnWindowFocus: true,
});
```

The prefetch-all pattern (templates + blocks maps) stays — it's returned by the init endpoint. The only change is that TanStack Query caches the response, so toggling pre/post and back is instant from cache.

After save mutations:
```typescript
queryClient.invalidateQueries({ queryKey: ["workflows", orgId] });
```

### Phase 3: Prefetch on hover

Add prefetch to sidebar links for the most common destinations:

```typescript
// sidebar.tsx
import { useQueryClient } from "@tanstack/react-query";

const queryClient = useQueryClient();

<Link
  href="/runsheet"
  onMouseEnter={() => {
    queryClient.prefetchQuery({
      queryKey: ["runsheet", selectedLocationId],
      queryFn: () => fetch(`/api/runsheet?location_id=${selectedLocationId}`).then(r => r.json()),
    });
  }}
>
  Run Sheet
</Link>
```

Do this for: Run Sheet, Readiness, Workflows, Forms. Settings is lower-traffic and doesn't need it.

The prefetch fires on hover (~200ms before click). Combined with Next.js JS bundle prefetching, both code and data are warm by click time.

## Mutation → Invalidation map

When a mutation succeeds, these query caches must be invalidated:

| Mutation | Invalidate these query keys |
|---|---|
| Session created/updated/deleted | `["runsheet", locationId]`, `["readiness", locationId]` |
| Appointment status changed | `["runsheet", locationId]`, `["readiness", locationId]` |
| Workflow template saved | `["workflows", orgId]` |
| Workflow template created/deleted | `["workflows", orgId]` |
| Form created/updated/deleted | `["forms", orgId]` |
| Form assignment sent | `["readiness", locationId]` |
| Room config changed | `["runsheet", locationId]`, `["rooms-settings", locationId]` |
| Payment settings changed | `["payments-settings", locationId]` |
| Appointment type created/updated/deleted | `["workflows", orgId]` |
| Outcome pathway created/updated/deleted | `["workflows", orgId]` |

Getting these wrong is the most common bug after a query layer migration — mutations succeed but the UI doesn't update because the cache wasn't invalidated. It looks like a bug in the mutation when it's actually a bug in the cache strategy.

## Files to create/modify

### New files
| File | Purpose |
|---|---|
| `src/lib/query/client.ts` | QueryClient factory with defaults |
| `src/components/clinic/query-provider.tsx` | Client component wrapping QueryClientProvider + DevTools |
| `src/app/api/runsheet/route.ts` | API route wrapping existing runsheet queries |
| `src/app/(clinic)/runsheet/loading.tsx` | Skeleton for run sheet |
| `src/app/(clinic)/readiness/loading.tsx` | Skeleton for readiness |
| `src/app/(clinic)/forms/loading.tsx` | Skeleton for forms |
| `src/app/(clinic)/settings/loading.tsx` | Skeleton for settings |

### Modified files
| File | Change |
|---|---|
| `src/app/(clinic)/layout.tsx` | Wrap in QueryProvider |
| `src/app/(clinic)/runsheet/page.tsx` | Remove server-side fetch, render shell directly |
| `src/components/clinic/runsheet-shell.tsx` | useQuery instead of props, realtime → cache bridge |
| `src/components/clinic/readiness-shell.tsx` | useQuery with refetchInterval, remove manual polling |
| `src/components/clinic/forms-shell.tsx` | useQuery, invalidate on mutations |
| `src/components/clinic/workflows-shell.tsx` | useQuery wrapping fetchInit, invalidate on save |
| `src/components/clinic/payments-settings-shell.tsx` | useQuery |
| `src/components/clinic/rooms-settings-shell.tsx` | useQuery |
| `src/components/clinic/sidebar.tsx` | Add prefetchQuery on hover |
| `src/hooks/useRealtimeRunsheet.ts` | setQueryData on realtime events |

## Estimated effort

| Phase | Time | Impact |
|---|---|---|
| Phase 1: Foundation | 1-2 hours (+ half day for skeleton design) | Loading skeletons prevent blank screens |
| Phase 2a: Run Sheet + realtime bridge | 1-2 hours | Most-visited page cached + realtime bridge |
| Phase 2b-e: Remaining shells | 2-3 hours | All pages cached |
| Phase 3: Prefetch on hover | 30 min | Forward-navigation instant |

Total: ~1.5 days of focused work (including skeleton design).

## Verification

After each phase, test this flow:
1. Navigate to Run Sheet → see data
2. Click Readiness → see data
3. Click back to Run Sheet → **should be instant, no skeleton**
4. Click Workflows → see data
5. Click back to Readiness → **should be instant with cached data**
6. Wait 30s, click Run Sheet → should show cached data, then quietly update

**If step 3 still shows a skeleton after Phase 2, something's wrong with the cache key or the staleTime.** Debug before moving on — the DevTools panel will show you exactly what's in the cache.

## Notes

- `staleTime` tuning per query: Run Sheet 30s (changes frequently via realtime), Settings 5min (rarely changes), everything else 30s default.
- The query cache is in-memory only. Page refresh clears it. That's fine — loading skeletons cover the first load.
- Use the DevTools panel (`@tanstack/react-query-devtools`) constantly during migration. It shows cache entries, staleness, and refetch timing. Don't debug cache behaviour without it.
