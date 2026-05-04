# 02: Architecture

How the system is put together. Stack, layout, state, auth, real-time. Stops short of API specifics; those live in feature docs and the codebase.

---

## Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS, Zustand for client state.
- **Database and auth**: Supabase (Postgres + Auth + Realtime).
- **Custom server**: `server.ts` runs Next.js plus Socket.io on a single port. Socket.io is the real-time transport for the whole app (clinic and patient).
- **Video**: LiveKit, used as a stand-in for Coviu's proprietary video platform. The interface is pluggable.
- **Payments**: Stripe Connect (Custom Connect, controller properties model).
- **Forms**: SurveyJS (`survey-core`, `survey-react-ui`, `survey-creator-react`).
- **Deployment target**: currently runs locally via `npm run dev` and `npm start`, both of which boot Next.js plus Socket.io through the custom `server.ts`. There is no deployed environment yet. Vercel was the original target but its serverless model does not support a long-lived custom server, so deployment is an open question that lands at engineering handoff. See `conventions-prototype-vs-production.md`.
- **Font**: Inter for everything except scheduled times on the run sheet (JetBrains Mono).

Everything stack-related is in `package.json`. Don't add a new top-level dependency without checking whether an existing one already covers the use case; the prototype is deliberately conservative about footprint.

## App Router layout

The Next.js App Router structure encodes the clinic-side / patient-side / setup split via route groups:

```
src/app/
  (auth)/          login, signup, password reset (pre-setup auth)
  (setup)/         clinic creation, room creation (gated post-signup)
  (clinic)/        run sheet, readiness, workflows, forms, settings
  (patient)/       entry flow, virtual waiting room
  intake/[token]/  intake package journey (separate from patient entry)
  api/             route handlers
```

Each route group has its own `layout.tsx`. The `(clinic)` layout is the desktop-primary sidebar shell. The `(patient)` layout is the mobile-first 420px-max-width centred container. The `(setup)` layout is a centred card with a step indicator. Patient-side and clinic-side never share a layout; they look different on purpose.

Route groups are Next.js parentheses syntax: the segment doesn't appear in the URL but it scopes the layout. `/runsheet` resolves through `(clinic)/layout.tsx`, `/entry/[token]` through `(patient)/layout.tsx`.

The `intake/[token]` route is deliberately not inside `(patient)`. The intake package journey is its own surface with its own layout; see `feature-intake-package.md`.

## The clinic / patient split

The single most important architectural fact: **clinic-side and patient-side are different applications that share a database**. They have:

- **Different layouts.** Clinic = sidebar shell. Patient = mobile-first stepper.
- **Different state stores.** Clinic = Zustand `clinic-store` keyed by location. Patient = component-local state, no global store.
- **Different real-time channels.** Clinic = location-scoped Socket.io rooms (`location:{id}`) carrying named events. Patient = same Socket.io server, presence-tracked per session.
- **Different auth.** Clinic = Supabase Auth (email/password) with RLS enforcement. Patient = no account, phone OTP per visit, API routes use the service-role client to bypass RLS.

When a doc says "the X flow," it is almost always one or the other, not both. Be explicit when crossing the line.

## Auth model

Auth is the foundation everything else sits on. Get it wrong and every clinic-side query either fails or leaks data.

**Identity chain.** `auth.users` (Supabase) → `users` (where `users.id = auth.users.id`, the same UUID, no separate `auth_id` column) → `staff_assignments` (carries role, location, employment type, Stripe account) → `clinician_room_assignments` (junction controlling which rooms a clinician sees on the run sheet).

`auth.uid()` in RLS policies matches `users.id` directly. This is a deliberate design choice; see `reference-decisions.md`.

**User record creation.** A database trigger on `auth.users` automatically creates the `users` record on sign-up. The `signUp()` call passes `full_name` in `options.data` (which Supabase stores as `raw_user_meta_data`). The trigger reads it from there.

**Org resolution.** `staff_assignments` has no `org_id` column. The org is always derived through `staff_assignments.location_id → locations.org_id`. Queries that need org context join through locations. This is a frequent gotcha for new contributors.

**Session validation.** Supabase Auth sessions are managed via cookies (`@supabase/ssr`). The Next.js middleware calls `supabase.auth.getUser()` on every request to validate the JWT server-side and refresh tokens. **Always use `getUser()` (not `getSession()`)** for server-side validation. `getSession()` reads from the cookie without revalidating, which means a tampered cookie passes.

**The progressive setup gate.** Middleware enforces setup prerequisites and abandoned setup resumes on next login. The full flow is documented in `feature-auth-and-clinic-setup.md`. The summary:

- No auth session → redirect to `/login` (patient routes are exempt)
- Authenticated, no org → redirect to `/setup/clinic`
- Authenticated, has org, no rooms → redirect to `/setup/rooms`
- Authenticated, complete setup → allow clinic routes
- Authenticated, visiting `/login` or `/signup` → redirect to the appropriate destination

**RLS philosophy.** RLS is mandatory and never stubbed. The full framing is in `conventions-prototype-vs-production.md`; this doc references it but does not own it. The two-line summary: clinic-side queries enforce RLS at the database level via `auth.uid()`, and patient-facing API routes use the service-role client (which bypasses RLS) because patients authenticate via phone OTP tokens, not staff accounts.

## State management

Three layers, in order of preference: server components and server actions, then the Zustand clinic store (`src/stores/clinic-store.ts`), then component-local state. Prefer the simplest layer that covers the case. Patient-side has no global store; component state plus Socket.io listeners is the pattern.

The full framing — store slices, optimistic update pattern, conflict resolution, polling fallback, when each layer is the right reach — lives in `conventions-realtime-and-state.md`. That doc owns state-management guidance for the codebase; this section exists only to place state management on the architecture map.

The reasoning behind choosing Zustand over TanStack Query is in `reference-decisions.md`.

## Real-time

Socket.io is the real-time transport for both clinic-side and patient-side. The custom `server.ts` runs Socket.io alongside Next.js; broadcasts are emitted into per-location rooms (`location:{id}`) and patient surfaces connect to the same server. Application-level event names (`session_changed`, `readiness_changed`, `presence:update`, `status_changed`) dispatch what each subscriber refetches.

Supabase Realtime is available but not wired up. Two vestigial hooks (`useRealtimeRunsheet`, `useRealtimeWaiting`) survive from an earlier design but are unused. Default to Socket.io for new live surfaces.

Room/event topology, the selected-vs-assigned location subscription model, the polling fallback, and the gaps between intent and current build live in `conventions-realtime-and-state.md`. Real-time is the easiest thing to get wrong silently; start there before adding a new feed.

## Patient-side specifics

Patient flows are mobile-first. The container is a 420px max-width column centred on desktop, no responsive breakpoints. One layout, scaled to fit a phone, scaled up unchanged on a desktop.

The persistent header (clinic logo, clinic name, room name, dynamic step indicator) is rendered on every patient-side screen. The step indicator's denominator changes based on what's actually configured for this clinic (e.g. card capture is skipped if payments are off), so the stepper is dynamic, not fixed.

Patient-facing API routes use the service-role client because patients authenticate via phone OTP tokens, not Supabase Auth sessions. There is no `auth.uid()` for a patient. Instead, the entry token (`sessions.entry_token`, `rooms.link_token`, `locations.qr_token`, or `intake_package_journeys.journey_token`) is the authorisation primitive. Lookup is by token, not by user.

This means patient-side endpoints carry the responsibility of token validation themselves. They cannot lean on RLS. Be careful in `src/app/api/patient/*` and `src/app/api/intake/*`; those routes are the boundary.

## Custom server

`server.ts` runs Next.js and Socket.io together on the same port. The Next.js app is created via `next({ dev })` and bound to the Socket.io server. Connection handling, room joining/leaving, and broadcast emission are all in this file or its direct dependencies.

The reason for a custom server: real-time broadcasts need application-layer semantics (named events on a shared per-location room) and presence tracking for the waiting-room "connected" dot, neither of which a row-change feed gives you. The custom server is small, targeted, and not a precedent for arbitrary backend logic. Feature work belongs in route handlers, not in `server.ts`.

The custom server is incompatible with Vercel's serverless model, which is why the prototype currently runs locally rather than on Vercel. Resolving this (either by hosting elsewhere, by separating the Socket.io broadcast layer from the Next.js process, or by replacing Socket.io with a managed real-time service) is part of the engineering handoff. See `conventions-prototype-vs-production.md`.

## Where the bodies are buried

A short list of things that surprise new contributors:

- **`staff_assignments` has no `org_id`.** Org context is always derived through the location.
- **`users.id` IS `auth.users.id`.** No separate auth_id column. `auth.uid()` in RLS matches `users.id`.
- **Derived display states are not persisted.** `late`, `upcoming`, `running_over` are calculated at render time. You cannot query them in SQL.
- **Patient-facing routes bypass RLS.** Service-role client. The entry token is the authorisation primitive, not a Supabase session.
- **`clinic_owner` is both practice manager AND clinician.** Role checks must include all three when the intent is "any admin" or "any clinician."
- **Two parallel intake paths exist.** `intake_package` (bundled) and `deliver_form` (individual). See `feature-intake-package.md` and `03-data-model.md`.
- **The custom server is load-bearing.** Removing or restructuring `server.ts` will break Socket.io broadcasts.

---

## Where to look next

- `03-data-model.md` for the schema as a narrative.
- `conventions-realtime-and-state.md` for channel naming and subscription patterns.
- `conventions-prototype-vs-production.md` for what's stubbed and what's real, including the RLS framing this doc references.
- `feature-auth-and-clinic-setup.md` for the full progressive setup gate.
