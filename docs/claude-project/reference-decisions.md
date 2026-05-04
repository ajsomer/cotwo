# Reference: Decisions

Short architecture decision records (ADRs) for the non-obvious choices that future contributors might be tempted to undo. Three to five sentences each. Append-only; if a decision changes, add a new entry rather than rewriting.

The format for each entry: the decision, the alternative considered, and the reason. Skip rationale for "obvious" choices that nobody would push back on; this doc is for the choices that look wrong at first glance and are right anyway.

---

## Phone-as-identity for patients (no email, no patient accounts)

**Decision.** Patients are identified per-visit by phone OTP, not by email or by an account. There is no patient-facing login.

**Alternative considered.** Patient accounts with email and password (like a typical SaaS product), or email-based OTP.

**Reason.** Allied health patients don't want another account to manage. Phones are universal in the target demographic; emails are forgotten. Per-visit OTP also handles the case where one phone serves multiple patients (a parent's phone with several children) cleanly via the multi-contact picker. Building accounts would create privacy expectations Coviu doesn't want to take on (cross-clinic identity, password management, account recovery).

## `users.id = auth.users.id` (no separate auth_id column)

**Decision.** The `users` table's primary key is the same UUID as `auth.users.id`. RLS policies use `auth.uid()` against `users.id` directly.

**Alternative considered.** A separate `auth_id` column on `users` referencing `auth.users.id`, with `users.id` as a different primary key.

**Reason.** Eliminates a join in every RLS policy. `auth.uid() = users.id` is the simplest possible policy expression. The cost is that bulk-reassigning a `users` row to a different `auth.users` row (which we'd never want anyway) is impossible. The benefit is that RLS policies are short and fast, and there's no class of bug where a stale `auth_id` mapping points to the wrong user.

## Zustand over TanStack Query

**Decision.** The clinic-side data layer is Zustand plus Socket.io broadcasts plus initial server fetches. Not TanStack Query.

**Alternative considered.** TanStack Query for cache management, with Socket.io invalidating queries on broadcast.

**Reason.** The clinic-side data is heavily real-time and heavily location-scoped. TanStack Query's cache model (key-based, query-shaped) doesn't map well to "this is the live state of the run sheet for the selected location, refreshed by named events." Zustand gives explicit slices, explicit setters, and a clear ownership model where the store is the single source of truth and Socket.io is its update channel. TanStack Query was tried briefly during early prototyping and the cache invalidation logic ended up fighting the broadcast logic.

## `staff_assignments` has no `org_id`

**Decision.** The `staff_assignments` table doesn't carry an `org_id` column. Org context is always derived through `staff_assignments.location_id → locations.org_id`.

**Alternative considered.** Denormalise `org_id` onto `staff_assignments` for query convenience.

**Reason.** A staff member's location is the source of truth for which org they belong to. Denormalising would create a class of bug where the `org_id` and the `location_id` disagree (e.g. if a location is moved between orgs, which is rare but possible). The cost of the join is negligible; the cost of the consistency bug isn't. New contributors trip over this constantly, but the right fix is documentation, not denormalisation.

## Two parallel intake paths (`intake_package` and `deliver_form`)

**Decision.** Both `intake_package` (newer, bundled) and `deliver_form` (older, individual) action types exist and are supported. New workflows should use `intake_package`.

**Alternative considered.** Migrate all `deliver_form` workflows to `intake_package` and drop the `deliver_form` action type.

**Reason.** `deliver_form` predates `intake_package`. Some legacy seed data and templates use it. The two mechanisms have different patient-facing implications (one SMS per form vs one SMS per package), and migrating would require updating templates, journeys, and the readiness dashboard's transcription priority logic. The cost-benefit favours leaving both paths until engineering handoff, where a more careful migration plan can land.

## Service-role client for patient-facing routes

**Decision.** Patient-facing API routes (`src/app/api/patient/*`, `src/app/api/intake/*`) use the Supabase service-role client to bypass RLS. The entry token (session, room, location, or journey token) is the authorisation primitive.

**Alternative considered.** Anonymous Supabase Auth users for patients, with RLS scoping on patient-token-derived columns.

**Reason.** Patients don't have Supabase Auth accounts; creating ephemeral anonymous sessions per visit would multiply the auth surface and create cleanup work. The token-as-authz model is simpler and matches the way patient-facing flows actually work (the URL is the credential). The cost is that each patient-facing route must validate the token itself before doing anything; RLS doesn't help. This is documented in `02-architecture.md` and `feature-patient-entry-flow.md` and is not a leak of clinic-side patterns into patient-side; it's a deliberate split.

## Session-spawning at morning scan, not at appointment creation

**Decision.** Sessions are spawned from appointments by the morning scan job at run sheet build time. They are not created when the appointment is created.

**Alternative considered.** Create the session when the appointment is created (months in advance, perhaps).

**Reason.** Sessions are a "today" entity. Their lifecycle (queued → waiting → in_session → done) only meaningfully starts on the day of the visit. Creating the session in advance would mean carrying around a `queued` session for months that has no operational meaning, and cancellations or reschedules would need to manage both the appointment and the session. The morning scan creates the session at the right moment and lets the appointment lifecycle (which is independent and longer-running) evolve separately.

## Derived session states are not persisted

**Decision.** `late`, `upcoming`, and `running_over` are computed at render time from the stored session status plus the current clock. They are not stored.

**Alternative considered.** Persist these states as flags on the session row, updated by a background job.

**Reason.** Storing time-dependent flags requires a job to flip them every minute, which is fragile (job lag, missed updates). Computing them at render is cheap and always correct. The cost is that you can't query for "all late sessions" in SQL; you fetch and filter in code. This trade is correct because the queries that need the filter are render-time queries (the run sheet is computing the same thing the SQL would have).

## No margin on Stripe transaction fees

**Decision.** Coviu does not take a percentage of patient payments. The Stripe Connect transaction is pure pass-through: Stripe's fees come off the gross, the rest lands in the clinic's account. Coviu's revenue is the subscription.

**Alternative considered.** Take a small per-transaction margin on top of Stripe fees as additional revenue.

**Reason.** Margin-on-transaction creates pricing complexity and procurement objections from clinics, who already pay Stripe fees and don't want a second line item. Subscription pricing is cleaner and aligns Coviu's incentives with the clinic's (we want them to use the product more, not to drive transaction volume specifically). The decision is a product positioning choice, not an engineering one, but it shows up in code as the absence of any application fee in the payment intent creation.

## Next.js custom server (not Vercel-shaped)

**Decision.** A custom `server.ts` runs Next.js plus Socket.io on the same port. Vercel is not the deployment target in the prototype.

**Alternative considered.** Vercel deployment with a separate WebSocket service (Pusher, Ably, or self-hosted) for clinic-side broadcasts.

**Reason.** Socket.io plus Next.js in one process is significantly simpler for the prototype: one repo, one runtime, one auth flow, one place to deploy. The cost is that Vercel doesn't support long-lived custom servers, so deployment is deferred to engineering handoff. At handoff, the broadcast layer can either be lifted out (Pusher / Ably) or hosted on a different platform (Railway, Render, a VPS). The prototype cost of solving deployment now would have eaten weeks of feature work.

## Run sheet is the same component for receptionist and clinician

**Decision.** Clinicians hit `/runsheet`, the same URL and the same component as receptionists. Filtering and action availability are determined by role and assignment data, not by route.

**Alternative considered.** Separate `/runsheet` and `/clinician/runsheet` (or similar) routes for the two views.

**Reason.** The two views are 95% the same. Filtering the data and gating actions is a small concession on top of the shared component; maintaining two routes would mean double the surface area for every run sheet feature change. The shared component also makes the "clinic owner is both" case clean: they see a receptionist-shaped run sheet with clinician actions where applicable.

## Tasks renamed in the sidebar but not in code

**Decision.** The sidebar label was changed from "Readiness" to "Tasks." The URL (`/readiness`) and all internal code (Zustand store slice, types, components, API routes, broadcast channels) still say `readiness`.

**Alternative considered.** Rename everything to `tasks` for consistency.

**Reason.** A repo-wide rename would touch hundreds of files (route, store slices, broadcast channel names, fetcher names, type names) for a UI label change. The cost-benefit doesn't favour the rename. The user-facing label is what matters; the code can be renamed later if it ever becomes worth the migration cost. Documented in `feature-readiness-dashboard.md` so contributors aren't confused.

## Patient-side has no global store

**Decision.** Patient-side flows use component-local state. There is no Zustand store on the patient side. The exception is the virtual waiting room, which connects to the same Socket.io server the clinic uses, tracks presence per session, and listens for `status_changed` to navigate to the call.

**Alternative considered.** A patient-side Zustand store mirroring the clinic-side architecture.

**Reason.** Patient flows are short, linear, and per-visit. There's nothing to cache between visits, and the multi-step state machine benefits from explicit local state over a global container. Adding a store would invite cross-step state leaks and complicate the mental model. The clinic-side store exists because the clinic-side has shared state across surfaces; the patient-side doesn't.
