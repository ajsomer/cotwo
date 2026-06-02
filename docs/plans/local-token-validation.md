# Plan: Local token validation across gated routes

## Problem

Every staff-gated API route resolves the caller's identity through
`await ssr.auth.getUser()` (in `src/lib/auth/staff-access.ts`, repeated in each
helper, and again in `src/lib/supabase/middleware.ts`). `getUser()` makes a
**network round-trip to the Supabase Auth server** to re-verify the JWT on
*every* call.

This shows up as latency on the patient contact card specifically, because the
staged-loading split means the gate now runs **twice per open** — once on
`/api/patient/:id/summary`, once on `/api/patient/:id/history` — so the DOB/card
(`/summary`) waits behind a network auth verification before its (otherwise
trivial, indexed) query can start. The same cost is paid by ~20 routes.

The middleware (`middleware.ts:126`) **explicitly skips `/api/` routes**
(`if (pathname.startsWith("/api/")) return supabaseResponse;`), so for API
routes the route's own `getUser()` is the *first and only* validation — we
cannot lean on "middleware already validated it" for API routes.

## What stays vs. what changes (the security reasoning)

Two distinct questions every gated request must answer:

1. **Authentication** — "are you a real logged-in user?" Today: network
   `getUser()`. **Change to local JWT verification.**
2. **Authorization** — "are you allowed to see *this* resource?" Today: an
   indexed org-membership query (`fetchUserOrgIds` → does the user staff the
   resource's org). **Keep**, but stop running it redundantly.

Why authorization can't be dropped to "just logged in": the patient/forms
routes use the **service-role client (RLS off)**, so the application-level org
check is the *only* wall stopping a logged-in user at Clinic A from reading
Clinic B's patient by sending an arbitrary ID to the endpoint. The dashboard UI
gatekeeps the *view*, not the *endpoint*. This matches the agreed rule —
**any staff member of the patient's org may see the patient** (org-scoped, not
room-scoped, consistent with how the run sheet and readiness already scope by
location, not room).

Why local verification is safe enough here: `getClaims()` (available in the
installed `@supabase/auth-js`) verifies the JWT signature **locally** against a
cached JWKS using the project's asymmetric signing keys — no network, and
unforgeable without the private key. The only thing it can't catch that
`getUser()` can is a token revoked server-side but not yet past its `exp`. For a
prototype with short-lived access tokens that auto-refresh, this is the same
tradeoff Clerk/Auth0 make by default (local verification + short token TTL).
Accepted explicitly.

## Approach

### Stage A — One local-validation primitive

Add a single identity resolver in `staff-access.ts` that every gate calls:

```ts
// Resolve the caller's user id from the cookie session, verified LOCALLY
// (no network round-trip to the auth server). Returns null when absent/invalid.
async function getAuthenticatedUserId(): Promise<string | null> {
  const ssr = await createServerClient();
  const { data, error } = await ssr.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub as string;   // sub === auth.users.id === users.id
}
```

- `getClaims()` with asymmetric signing keys verifies locally; the first call
  warms the JWKS cache, subsequent calls are pure-local. If the project still
  uses a legacy HS256 secret, `getClaims()` still validates locally via the
  shared secret — either way, no per-call auth-server hop.
- `sub` is the user id (`users.id = auth.users.id` per the auth model in
  CLAUDE.md), which is all the gates consume.

### Stage B — Route every helper through it

Replace the `const { data: { user } } = await ssr.auth.getUser(); if (!user)…`
block in **each** helper with `const userId = await getAuthenticatedUserId();`.
Helpers to update (all in `staff-access.ts`):

- `requireAuthenticatedUser`
- `requireStaffLocationAccess`
- `assertStaffCanAccessPatient`
- `assertStaffCanAccessSubmission`
- `requireStaffOrgAccess`
- `requireStaffCanAccessResource` (backs the whole `requireStaffCanAccess*`
  family — forms, workflows, appointment types, files, pathways, appointments,
  form assignments)
- `requireStaffCanAccessAppointment`, `requireStaffCanAccessFormAssignment`
  (if they call `getUser()` directly rather than via the resource helper)

**Behaviour must stay identical** — same 401 (no/invalid token), same 403/404
(authorized-but-out-of-scope) outcomes. Only *how the user id is obtained*
changes; every downstream org/scope query is untouched.

### Stage C — Authorize the patient card once, not twice

The split `/summary` + `/history` both call `assertStaffCanAccessPatient`. After
Stage A/B the auth half is already free (local), but the **org-membership query**
still runs on both. Cache the access decision briefly so the second route
reuses the first's result:

- A short-TTL (~30s) in-memory cache keyed on `(userId, patientId) → allowed`,
  used by `assertStaffCanAccessPatient`. The second route (and any reopen within
  the window) skips the membership query entirely.
- Server-side, per-instance, decision-only (a boolean + resolved orgId) — never
  cache the patient data itself here; that already has its own client caches.
- Mirrors the plan's own "shared lower-level cached access helper" fallback for
  the documented "auth runs twice" cost.

(Optional, low-risk add-on: within `assertStaffCanAccessPatient`, the patient-org
lookup and the user-assignments lookup can run in parallel rather than chained.)

### Stage D — Middleware (optional, separate consideration)

`middleware.ts:133` uses `getUser()` to validate page navigations and refresh
tokens. It runs on every non-API request. Switching it to `getClaims()` is the
same win, **but** the middleware also relies on `getUser()`'s token-refresh
side-effect (writing refreshed cookies via `setAll`). `getClaims()` does not
refresh. So:

- **Default: leave the middleware as-is** for now (it's page-level, runs once
  per navigation, and the refresh side-effect matters). The API-route hot path —
  the actual source of the felt latency — is fully covered by Stages A–C.
- If we later want it too, pair `getClaims()` (validate) with an explicit
  refresh path; treat as a follow-up, not part of this change.

## Out of scope / non-goals

- **No change to the authorization rules.** Org-scoped patient access stays
  exactly as today. (Separately noted: run sheet / readiness scope by *location*
  not *room*, so the spec's "clinicians see only their rooms" is not currently
  enforced — that's a product/security decision, not this performance change. Flagged, not addressed here.)
- No change to RLS, the service-role usage, or any data query.
- No change to the 401/403/404 status contracts.
- Patient OTP / entry-flow auth untouched (different mechanism).

## Verification

1. `npm run lint` + `tsc --noEmit` pass.
2. Manual: log in, click a patient on the run sheet and on Tasks — header is
   instant, DOB/card land in a beat (no longer gated behind a network auth hop).
   Confirm via devtools that `/summary` and `/history` no longer each spend
   ~network-RTT before responding.
3. Negative paths still hold: signed-out request → 401; logged-in user
   requesting a patient outside their org → 404; out-of-location run sheet → 403.
4. Reopen the same patient within 30s → second open does no membership query
   (Stage C cache hit).
5. Existing gated routes (forms, workflows, settings, readiness, runsheet,
   files) behave unchanged.

## Rollout

- One commit (or two: A+B together, then C), on a branch off `main`.
- Apply the same local-validation pattern to all ~20 callers in one pass so the
  auth path is consistent — no mix of `getUser()` and `getClaims()` left behind
  (avoids confusion about which routes still pay the network cost).
