# Feature: Auth and Clinic Setup

Load-bearing for everything else. Sign-up, the progressive setup gate that turns an authenticated stranger into a clinic with rooms, and the auth model that every clinic-side query depends on. This doc summarises behaviour and points at the spec for full detail.

---

## Why this is its own doc

Auth is invisible when it works and catastrophic when it doesn't. The progressive setup gate is one of the few pieces of infrastructure that runs on every clinic-side request, and breaking it produces silent redirect loops or RLS-scoped queries that return empty rows for reasons that look like data bugs.

The patient-side has its own auth story (phone OTP, no Supabase session, service-role at the API boundary). That's covered in `feature-patient-entry-flow.md`. This doc is staff-side only.

## The identity chain

`auth.users` (Supabase Auth) → `users` (where `users.id = auth.users.id`) → `staff_assignments` (role and location) → `clinician_room_assignments` (room visibility for clinicians).

The two facts that catch contributors out:

1. **`users.id` is the same UUID as `auth.users.id`.** No separate `auth_id` column. RLS policies use `auth.uid()` and match it directly against `users.id`.
2. **`staff_assignments` has no `org_id`.** The org is derived through `staff_assignments.location_id → locations.org_id`. Filter staff by org through the join, not a missing column.

The `users` row is created automatically by a database trigger on `auth.users`. The `signUp()` call passes `full_name` in `options.data` (which Supabase stores as `raw_user_meta_data`), and the trigger reads it from there to populate the `users` row.

## Sign-up flow

1. **`/signup`** form: full name, email, password.
2. **`supabase.auth.signUp()`** with `options.data: { full_name }`.
3. Trigger creates the `users` row.
4. User is redirected to `/setup/clinic` (next gate).

Email confirmation is **disabled** in the prototype (Supabase Dashboard configuration). New users are immediately authenticated. See `conventions-prototype-vs-production.md` for the swap at handoff.

There is no separate "invite a user" flow built yet. The first user to sign up becomes the clinic owner. Adding additional staff members happens later, through the team management page (covered in `feature-admin-and-config.md`).

## Login and session validation

**`/login`** is a standard email/password form against `supabase.auth.signInWithPassword()`. On success the user lands at `/runsheet` (or wherever the progressive gate sends them, depending on setup state).

Sessions are managed via cookies through `@supabase/ssr`. The Next.js middleware validates the session on **every** request:

- **Always use `supabase.auth.getUser()`**, not `getSession()`. `getUser()` validates the JWT against Supabase's auth server (refreshing if needed). `getSession()` reads the cookie without revalidating, which means a tampered cookie would pass.
- The middleware refreshes tokens transparently when needed.
- Failed validation results in a redirect to `/login`.

Forgetting `getUser()` and reaching for `getSession()` in a server component is the most common auth bug. If you see `getSession()` in clinic-side server code, fix it.

## The progressive setup gate

The middleware enforces a setup chain. New users land in `/setup/clinic`; if they bail halfway through and come back later, they resume where they left off. This logic lives in `src/lib/supabase/middleware.ts` (and is exercised on every clinic-side route).

The chain, in order:

1. **No auth session** → redirect to `/login`. Public routes are exempt — the current `PUBLIC_ROUTES` list in `src/lib/supabase/middleware.ts` covers `/entry`, `/waiting`, `/auth/callback`. Note that `/intake/[token]` is *not* currently in that list despite being a patient-side flow; it serves the intake journey via API routes that authorise on the journey token, but the page itself goes through the gate. If a non-authenticated patient hits `/intake/[token]` directly, the middleware will redirect them to `/login` — almost certainly a bug, fix by adding `/intake` to `PUBLIC_ROUTES`.
2. **Authenticated, no `users` row** → effectively impossible (the trigger creates one), but treated as an error state.
3. **Authenticated, no organisation** → redirect to `/setup/clinic`. This is the "create your clinic" step: name, location, and the org-level choices that aren't deferrable.
4. **Authenticated, has org, no rooms** → redirect to `/setup/rooms`. At least one room must exist before the run sheet is meaningful.
5. **Authenticated, complete setup** → allow access to clinic routes.
6. **Authenticated and visiting `/login` or `/signup`** → redirect away. Already-logged-in users don't see the auth pages.

The gate is enforced server-side, not just client-side. Skipping the gate by directly navigating to a clinic route fails because the middleware redirects before any clinic-side code runs.

The gate state is computed fresh on every request (no caching). This is acceptable because the queries are small and the alternative (cached state going stale during setup) is worse than the cost.

## Setup flows

### `/setup/clinic`

Creates the organisation and the first location. Form fields the user fills in:

- Clinic name
- Address

What the API route fills in for them:

- Tier is hardcoded to `complete` (the prototype demos Complete-tier flows, so every new org goes there).
- The first location's name is derived from the clinic name.
- No branding upload at this stage; `organisations.logo_url` exists but is not captured here.

On submit, the route handler creates the organisation row, creates the first location row (linked to the organisation), creates a `staff_assignments` row linking the current user to the new location with role `clinic_owner`, and seeds default data appropriate to the tier.

The user is redirected to `/setup/rooms`.

### `/setup/rooms`

Creates the rooms for the first location. The form supports adding multiple rooms in one submit. Each room captures:

- Name

That's it for the prototype. The schema supports `room_type` (`clinical`, `reception`, `shared`, `triage`) and per-room `payments_enabled`, but neither is exposed in the setup form today; rooms are created with default values for both, and any further configuration happens later via the team/rooms settings.

On submit, the rooms are created and a `link_token` is auto-generated for each room (used in on-demand entry URLs; see `feature-patient-entry-flow.md`).

The user is redirected to `/runsheet`. Setup is complete.

## Service-role usage during setup

Setup operations frequently need to bypass RLS, because the user is authenticated but not yet assigned to anything (the assignment is what RLS uses to scope reads). The setup routes use the **service-role** Supabase client for creating the org, the location, the staff assignment, and the rooms.

This is acceptable because:

- The service-role client is only used in server-side API routes, never on the client.
- The setup routes are tightly scoped to setup operations; they don't expose generic mutation endpoints.
- The user's auth session is still validated before the service-role operation runs (you can't hit setup routes without being logged in).

This pattern (service-role for narrowly-scoped admin operations) is also used in patient-facing routes (where there's no `auth.uid()` at all). See `02-architecture.md` and `conventions-prototype-vs-production.md` for the wider framing.

## What can go wrong

The most common failure modes, and what they look like:

1. **`getSession()` instead of `getUser()`** in a server component. RLS-scoped queries return empty results because the unrevalidated session has a stale `auth.uid()`. Fix by switching to `getUser()`.

2. **Forgetting that `staff_assignments` has no `org_id`.** A query trying to filter by org with a `where org_id = ...` clause silently returns nothing because the column doesn't exist. Fix by joining through `locations`.

3. **Skipping the progressive gate by accident.** A new clinic-side route added without protection ends up bypassing the setup gate. Fix by ensuring the middleware matcher covers the route, or by adding an explicit check at the top of the route handler.

4. **Email confirmation re-enabled by accident** at the Supabase dashboard level. New signups land in a pending state and the prototype demo flow breaks. Fix by toggling it back off (or, post-handoff, by handling the confirmation case in the signup flow).

5. **Trigger fails to create the `users` row.** Usually a schema drift (column added without a default). Inspect the trigger function and the `users` table.

## Where to look

- **Middleware logic:** `src/lib/supabase/middleware.ts` and `middleware.ts` at the project root.
- **Server client:** `src/lib/supabase/server.ts` (uses cookie-bound auth).
- **Browser client:** `src/lib/supabase/client.ts` (for real-time subscriptions on the clinic side).
- **Service-role client:** `src/lib/supabase/service.ts` (setup, patient routes, admin operations).
- **Setup pages:** `src/app/setup/clinic/page.tsx`, `src/app/setup/rooms/page.tsx` (no `(setup)` route group; the layout lives at `src/app/setup/layout.tsx`).
- **Spec file:** the auth and clinic setup feature spec (uploaded separately to the Claude project).

## Related docs

- `02-architecture.md` for the wider auth-and-state picture.
- `03-data-model.md` for the schema chain.
- `conventions-prototype-vs-production.md` for what's stubbed and what's not.
- `feature-tiers-and-roles.md` for the role-by-tier visibility matrix that depends on the auth chain working.
- `feature-admin-and-config.md` for adding additional staff post-setup.
