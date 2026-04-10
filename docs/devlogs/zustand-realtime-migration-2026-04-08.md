# Instant Sidebar Navigation: Zustand + Realtime

**Date:** 2026-04-08

## What changed

### Global State Management (Zustand)
Replaced the localized data fetching pattern (`useRealtimeRunsheet`, `useEffect` polling loops, etc.) with a single centralized layout-level `useClinicStore` using Zustand. This fixes the issues with stale data during client-side navigation.

**Clinic Store:** A monolithic in-memory store representing the full operational state of a clinic (sessions, rooms, readiness appointments, workflow configuration, payment settings, and forms). Exposes `refresh` actions, explicit data setters, and realtime merge helpers.
 
### Layout-Level Hydration 
To eliminate initial loading spinners per page render, the `ClinicLayout` (Server Component) now issues parallel pre-fetches of all required core datasets (`fetchRunsheetSessions`, `fetchLocationRooms`, readiness, forms, etc.) during its render phase. The results are injected directly into `<ClinicDataProvider>`, which synchronously hydrates the Zustand store prior to rendering `<Sidebar>` and its `{children}`.

### Realtime Subscription Consolidation
Consolidated Realtime management into 7 unified Supabase channels within the `ClinicDataProvider` to cover all live data slices globally:
- `runsheet` (Session changes via REST or mutations)
- `runsheet-participants` (Patient identity linkages)
- `presence:location` (Live patient connections) 
- `config-rooms`
- `config-appt-types`
- `config-forms`

When these tables update globally via PostgREST, `Zustand` natively updates all active interface points. We included explicit connection closure + setup boundary resets on Sidebar Location switches to assure strict data isolation. Additionally integrated a resilient 30-second background polling fallback over `sessions`/`readiness` upon loss of any real-time sockets.

## Files added/modified

### New files
- `src/stores/clinic-store.ts` — Zustand store definition, component typing, and DevTools integration
- `src/components/clinic/clinic-data-provider.tsx` — Layout hydration wrapper and global Realtime manager
- `src/app/api/runsheet/clinician-rooms/route.ts` — API endpoint exposing user assigned rooms

### Modified files
- `src/app/(clinic)/layout.tsx` — Re-architected to perform synchronous parallel initial data-fetching
- `src/components/clinic/providers.tsx` — Wraps the app in `<ClinicDataProvider>`
- `src/app/(clinic)/runsheet/page.tsx` — Refactored into a thin presentation wrapper without redundant server fetching
- `src/components/clinic/runsheet-shell.tsx` — Hooked directly into Zustand store
- `src/components/clinic/readiness-shell.tsx` — Hooked directly into Zustand store (removed heavy manual local polling logic)
- `src/components/clinic/forms-shell.tsx` — Hooked directly into Zustand store
- `src/components/clinic/workflows-shell.tsx` — Hooked directly into Zustand store Maps
- `src/components/clinic/rooms-settings-shell.tsx` — Hooked directly into Zustand store
- `src/components/clinic/payments-settings-shell.tsx` — Hooked directly into Zustand store
- `src/components/clinic/connection-indicator.tsx` — Removed archaic component hooking
- `docs/plans/navigation-performance-tanstack-query.md` — Marked superseded 

## Notes
- Sidebar lateral navigations are now instantaneous (zero-loading-states) since React pages act uniquely as thin render layers above the in-memory Zustand representation.
- The dev-only hooks `useRealtimeRunsheet` and `usePatientPresence` were entirely deprecated and removed based on the move to `useClinicStore`.
