# Socket.IO live updates + Zustand client-cache fixes

**Date:** 2026-04-16

## Context

Started the day debugging a "No rooms configured for this location" flash on `/runsheet` that required a page refresh to clear. That led to uncovering two separate architectural issues that had been masking each other:

1. The Zustand hydration path was mis-wired. `hydrateFromInitialData` existed in the store but was never called — instead, `ClinicDataProvider` was running `resetLocationData()` on every mount followed by unawaited parallel refetches, so any failed fetch left its slice empty indefinitely.
2. Supabase Realtime's WebSocket was completely non-functional on this project. `UnableToConnectToProject` errors in the Realtime logs; subscribe attempts timing out silently. Pause/unpause in the dashboard did not recover it. The project's Postgres + Realtime-service bridge was effectively dead.

The fix landed as two concurrent workstreams: correcting the Zustand architecture so reads are cheap and persist across client-side navigation, then replacing Supabase Realtime entirely with a self-hosted Socket.IO server running alongside Next.js.

## What changed

### Fixed Zustand architecture — fetch-once-per-tab, not per-nav

The original pattern had the clinic layout's server component running `fetchClinicInitialData` (11 parallel Postgres queries) on every navigation — even client-side `<Link>` nav, since Next.js App Router layouts re-render on every nav. Each nav burned the connection pool for slices the destination page didn't need. Worse, the client then discarded those server-fetched values because `ClinicDataProvider` called `resetLocationData()` on mount and ran another round of client-side refetches.

**Rewritten as:**
- `layout.tsx` fetches only user identity + assignments + selected location. Nothing data-layer.
- Clinic pages are thin client wrappers again. No `async`, no `initialData` props.
- Each shell reads its slice from Zustand and — if the `xxxLoaded` flag is false — fires the store's existing `refreshXxx(...)` action once via a `useEffect`. After that the slice lives in Zustand for the tab's lifetime.
- Zustand persists across client-side navs, so repeat visits to a page are instant and fire zero network requests.
- All server-side fetchers wrapped in `react.cache()` so any duplicate calls within a single request dedupe.

`ClinicDataProvider` no longer accepts `initialData`. The `resetLocationData()` call on mount is gone. It still handles actual location switches (multi-location users) by resetting + refetching, which is the one legitimate case.

### Extracted server-side fetchers out of API route bodies

`/api/readiness`, `/api/settings/rooms`, `/api/settings/payments`, `/api/workflows/init`, `/api/forms`, `/api/files` had their DB query logic inline. Pulled each into pure async functions under `src/lib/clinic/fetchers/*` so both server components and the API route handlers can call them. The API routes became thin wrappers. This was a prerequisite for the layout's SSR fetch (before we scrapped that) and is still correct architecturally — reusable query functions are preferable to query logic embedded in route handlers.

### Replaced Supabase Realtime with Socket.IO on a custom Node server

Stopped fighting the broken Supabase Realtime WebSocket. `npm run dev` now runs `tsx server.ts` — a single Node process that serves both Next.js and Socket.IO on the same port.

**Architecture note:** Next.js App Router API routes run in isolated Webpack-bundled workers that do NOT share Node's module cache with the custom server process. An `io` instance held in any shared module would resolve to `null` when imported from an API route. The bridge is a loopback HTTP POST: API routes call `broadcastSessionChange(...)` which `fetch`es `http://127.0.0.1:${PORT}/_internal/broadcast`; the custom server intercepts that URL before forwarding to Next.js and does the `io.to(room).emit(event, payload)` in its own scope. ~1ms overhead, zero cache-trap risk.

**Event contract:**
- `join:location` (client → server) — clinic client joins its location room. Gated by staff-assignment membership check.
- `join:session` (client → server) — patient waiting room joins its own session room.
- `presence:track` (client → server) — patient emits on connect to claim presence for their session.
- `session_changed` (server → `location:X`) — clinic run sheet refreshes its sessions slice.
- `status_changed` (server → `session:X`) — patient waiting room updates its local status, flipping into `PatientVideoCall` on `in_session`, etc.
- `presence:update` (server → `location:X`) — clinic updates the connected-sessions set driving the "patient is here" indicator.

**Write paths wired:**
- `/api/patient/arrive` — fires `session_changed` on both the on-demand-create and existing-session-update branches.
- `admitPatient`, `markSessionComplete`, `markSessionDone`, `selectOutcomePathway` — each fires both `broadcastSessionStatus(sessionId, status)` (for the patient) and `broadcastSessionChange(locationId, 'status_changed', ...)` (for the clinic).

**Presence:** server keeps an in-memory `activeLocations` map (locationId → sessionId → Set<socketId>) plus a `socketReverseMap` (socketId → {locationId, sessionId}) for O(1) cleanup on disconnect. Tolerates multiple tabs per patient and brief reconnects.

**Auth:** socket middleware parses the Supabase session cookie from the handshake, validates via `supabase.auth.getUser()`, resolves `staff_assignments` and attaches `allowedLocationIds` to `socket.data`. `join:location` rejects unauthorized requests silently. Patient sockets connect anonymously (they're phone-OTP identified, not Supabase auth), which is fine — they only use `join:session` and `presence:track`, both of which are open.

**Reconnect resilience:** clinic re-emits `join:location` AND calls `refreshSessions` on every socket `connect` event, so any events missed during a network flap are caught up automatically. Patient re-emits `presence:track` and `join:session` on reconnect.

### Deployment target: Railway (not Vercel)

Socket.IO requires a long-lived process — Vercel's serverless runtime can't hold WebSockets. Railway deploys from git push, supports WebSockets natively, and injects `PORT`. Production start command is `NODE_ENV=production tsx server.ts`. Full Railway checklist in `docs/plans/socketio-migration.md`.

## Files added/modified

### New files
- `server.ts` — custom Node server. Holds the `io` instance in its closure, intercepts `/_internal/broadcast`, runs the auth middleware and presence-tracking maps.
- `src/lib/socket-client.ts` — browser Socket.IO singleton with connect/disconnect/error logging.
- `src/lib/realtime/broadcast.ts` — `broadcastSessionChange(locationId, event, payload)` and `broadcastSessionStatus(sessionId, status)` helpers. Both POST to the loopback endpoint.
- `src/lib/clinic/fetchers/rooms.ts` — `fetchRoomsWithClinicians`
- `src/lib/clinic/fetchers/payments.ts` — `fetchPaymentConfig`, `fetchPaymentRooms`
- `src/lib/clinic/fetchers/forms.ts` — `fetchForms`, `fetchFiles`
- `src/lib/clinic/fetchers/workflows.ts` — `fetchWorkflowsInit`
- `src/lib/clinic/fetchers/readiness.ts` — `fetchReadinessSlice` (the 400-line extraction that used to live inline in `/api/readiness/route.ts`)
- `src/lib/clinic/fetchers/index.ts` — barrel export
- `docs/plans/socketio-migration.md` — the execution plan followed for the Socket.IO work, including the module-cache trap explainer and Railway deployment notes.

### Modified files
- `package.json` — added `socket.io`, `socket.io-client`, `tsx`. Scripts switched to `tsx server.ts`.
- `src/app/(clinic)/layout.tsx` — reverted to identity-only fetch. No more `fetchClinicInitialData`.
- `src/components/clinic/providers.tsx` — dropped the `initialData` prop; no longer passes it through.
- `src/components/clinic/clinic-data-provider.tsx` — removed Supabase Realtime subscriptions, removed reset-on-mount. Now holds the single Socket.IO subscription for `session_changed` + `presence:update` with on-connect resync.
- `src/components/clinic/runsheet-shell.tsx` — fetch-if-empty for sessions, rooms, clinicianRoomIds.
- `src/components/clinic/forms-shell.tsx` — fetch-if-empty for forms.
- `src/components/clinic/readiness-shell.tsx` — fetch-if-empty for readiness, rooms, workflows.
- `src/components/clinic/workflows-shell.tsx` — fetch-if-empty for workflows, forms.
- `src/components/clinic/rooms-settings-shell.tsx` — fetch-if-empty for roomsWithClinicians.
- `src/components/clinic/payments-settings-shell.tsx` — fetch-if-empty for paymentConfig.
- `src/components/clinic/appointment-types-settings-shell.tsx` — fetch-if-empty for appointmentTypes.
- `src/components/patient/waiting-room.tsx` — replaced Supabase `channel.track()` + postgres_changes subscribe with Socket.IO `presence:track` emit + `status_changed` listener.
- `src/lib/runsheet/actions.ts` — `admitPatient`, `markSessionComplete`, `markSessionDone`, `selectOutcomePathway` now broadcast to both the location and session rooms after their DB write.
- `src/lib/supabase/client.ts` — removed `realtime.setAuth` wiring (we no longer use Supabase Realtime).
- `src/lib/runsheet/queries.ts` — existing fetchers wrapped in `cache()`.
- `src/app/api/patient/arrive/route.ts` — broadcast call site updated to the new helper signature.
- `src/app/api/settings/rooms/route.ts`, `src/app/api/settings/payments/route.ts`, `src/app/api/readiness/route.ts`, `src/app/api/workflows/init/route.ts`, `src/app/api/forms/route.ts`, `src/app/api/files/route.ts` — thinned down to call the extracted fetchers.

### Deleted files
- `src/hooks/usePatientPresence.ts` — dead code after presence moved to Socket.IO. Consumers already read from `useClinicStore.connectedSessions`, which is now populated by the socket handler.

## Notes

- Zero remaining `supabase.channel(...)` usages in the codebase. Supabase is now used only for DB + auth.
- The Postgres connection pool pressure we were hitting earlier in the session is resolved. Navigating the sidebar back and forth fires zero API requests after the first visit to each page.
- The custom-server pattern means `npm run dev` starts Next.js and Socket.IO in one process on one port. HMR still works for Next.js code; edits to `server.ts` itself require a manual restart.
- Known limitation: the in-memory presence maps assume a single server process. Horizontal scaling on Railway would need the Socket.IO Redis adapter. Out of scope at prototype stage.
- Supabase Realtime's `UnableToConnectToProject` issue on this project remains unresolved, but we no longer care — nothing in the app depends on it.
