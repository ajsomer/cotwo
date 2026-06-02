# Codebase Simplification & Efficiency Plan

**Date:** 2026-06-02 (revised after code review)
**Scope:** Whole-codebase review for simplification, performance, and engineering best practices.
**Status:** Proposed — not yet implemented.

## Context

The codebase is ~36k LOC of application code (excluding generated types), Next.js 16 App Router, Supabase, Socket.IO, Zustand. The architecture is sound and well-documented. This plan does **not** propose architectural rewrites. It targets a security gap, a correctness bug, accumulated complexity, dead code, and a handful of concrete performance wins.

> **Revision note:** A review of the first draft corrected several claims, verified against the code:
> - The original "no RLS-bypass concerns" conclusion was **wrong**. Service-role config routes (`/api/forms`, `/api/appointment-types`, `/api/outcome-pathways`) accept a caller-supplied `org_id`/`id` and query with the service-role client **without a staff gate**. This is now **Tier 0** and outranks all cleanup.
> - The readiness fetcher issue is **partly a correctness bug**, not just latency: workflow-run counts aren't location-scoped (`readiness.ts:32,49`), so count badges leak other locations' runs in multi-location orgs. 3.1 is rescoped accordingly.
> - The original 3.2 ("parallelize forms fetch") was **incorrect** — `form_assignments` depends on `formIds` from the first query, so a trivial `Promise.all` is impossible. Rewritten.
> - 1.3 overstated `force-dynamic`; Next 16 Route Handlers aren't GET-cached by default. Corrected to `Cache-Control: no-store`.

Findings are ordered by **risk, then value-to-effort**. Each is independently shippable.

---

## Tier 0 — Security (do first)

### 0.1 Authenticate and org-scope the service-role API routes

**Finding (worse than the first revision stated):** `src/lib/supabase/middleware.ts:127` deliberately skips auth for `/api/*` ("API routes handle their own auth"). But several of these routes **don't authenticate at all** — they read a caller-supplied `org_id`/`id` from the query string and run a **service-role** query (RLS bypassed) with no `getUser()` and no staff check. Verified examples with **zero auth**:

- `src/app/api/forms/route.ts:7` — `GET ?org_id=` → `fetchForms(orgId)`.
- `src/app/api/appointment-types/route.ts:7` — `GET ?org_id=` → service-role batch.
- `src/app/api/outcome-pathways/route.ts:7` — `GET ?org_id=`.
- `src/app/api/forms/patients/route.ts:5` — `GET ?org_id=` → returns **patient names** for an arbitrary org.
- `src/app/api/workflows/in-flight/route.ts:7`, `src/app/api/forms/[id]/route.ts:5` — caller-supplied id, no org proof.

So the correct characterization is **unauthenticated cross-org data exposure** (not "any *authenticated* user"). `forms/patients` returning patient names for any `org_id` is the sharpest case.

**Audit posture vs. fix — don't over-gate public routes.** "Treat every service-role route as exposed until proven otherwise" is the right *audit* posture, but the *fix* differs by route class. **Do not** bolt staff gates onto intentionally public, token-gated patient routes (`/api/forms/fill/[token]`, `/api/forms/standalone/[public_token]`, `/api/patient/resolve`, `/api/patient/livekit/token`, the intake routes, etc.). Those are correct-by-design *if* the token proves access to exactly one resource and **every service-role query is scoped from that token** — that's their audit rule, not "add a staff check." The first step of the audit is therefore **classification** (see table below); only then apply the matching rule.

Accurate baseline of what already gates correctly:
- **Several location-scoped staff routes already gate** via `requireStaffLocationAccess` — `src/app/api/runsheet/route.ts:12`, `src/app/api/readiness/route.ts:23`, `src/app/api/settings/rooms/route.ts:11` (the helper exists and is proven; this audit is about applying it consistently).
- **Patient/resource routes** (`/api/patient/[id]`, form submissions) gate via `assertStaffCanAccess*`.
- **Many config/admin routes do *not* gate** — that's the gap (forms, appointment-types, outcome-pathways, forms/patients, workflows/in-flight, …).

**Scope of the audit — all methods, not just reads.** The middleware skip applies to POST/PATCH/DELETE too. An unauthenticated/cross-org *write* (create a form, delete an appointment type, configure payments for another org) is worse than a read. Audit all ~53 service-role routes across every HTTP method.

#### Route classification (do this table first, before editing any route)

Classify every service-role route into exactly one bucket, then apply its rule. This prevents PR A from becoming a blind sweep that breaks patient flows.

| Class | How to recognize | Rule |
|-------|------------------|------|
| **Org-scoped staff** | takes `org_id`; returns/mutates org config (forms, appointment-types, outcome-pathways, workflows) | `requireStaffOrgAccess(orgId)` — validate the requested `org_id` against the user's assignments |
| **Location-scoped staff** | takes `location_id`; run sheet / readiness / rooms / payments | `requireStaffLocationAccess(locationId)` — *already done* on some; finish the rest |
| **Resource-scoped staff** | takes a resource `id` (form, template, submission, patient) | `requireStaffCanAccessForm/Template/Patient(id)` — resolve resource → org → membership; 404 on miss |
| **Public token (patient)** | path param is `[token]`/`[public_token]`; no staff session expected | **No staff gate.** Verify the token resolves to exactly one resource and scope *every* query from it. Never accept a sibling `org_id`/`id` alongside the token. |
| **Internal/cron/webhook** | `/api/cron/*`, `/api/webhooks/stripe` | Verify the cron secret / Stripe signature; not user-auth. |

**Fix — centralize, don't sprinkle.** For the three staff classes, add a family of authorization helpers in `staff-access.ts` and call one at the top of the route, every method, *before* any read/write:

- `requireStaffOrgAccess(orgId)` — proves the authed user is staff at **this specific** `orgId`. The client-supplied `org_id` is *validated against the user's assignments*, never trusted on its own. 404 on miss.
- `requireStaffLocationAccess(locationId)` — already exists and proven (see above); apply to the location-scoped routes that lack it.
- `requireStaffCanAccessForm(formId)` / `requireStaffCanAccessWorkflowTemplate(templateId)` — resolve the resource's `org_id`, then check membership. 404 on miss, matching the existing `assertStaffCanAccess*` convention.

> **Do not** authorize via a "current org" helper that picks one assignment (see 2.1 note). Multi-org/multi-location users have several assignments; authorization must check membership of *the org/location named in the request*, not "the user's default org."

These mirror the already-correct `assertStaffCanAccessPatient` / `assertStaffCanAccessSubmission` — a **single, auditable authorization layer**.

**Why first:** unauthenticated cross-org access/mutation is the most severe defect in this plan. Any cleanup touching these files lands *after* the gates.

**Risk:** Medium — verify legitimate callers (the clinic UI always operates within the user's own org/location, so correctly-scoped calls keep working). Validate the clinic app end-to-end after, across roles.

### 0.2 Validate patient socket presence claims — they can delete sessions

**`server.ts:175`** — `presence:track` accepts `{ locationId, sessionId }` from **anonymous** patient sockets and tracks the claim after only **type-checking** the strings; it never verifies the session exists or belongs to that location.

**This is destructive, not just cosmetic.** On disconnect, `server.ts:252` calls `cleanUpOnDemandSession(sessionId, locationId)` with the **client-supplied** `sessionId`. That function (`server.ts:263`) deletes the session and its participants if it's on-demand (`appointment_id === null`) and still `waiting`. So a forged `presence:track` for *another patient's* on-demand waiting session causes that session to be **deleted** when the attacker disconnects, and a forged presence event broadcast to an arbitrary location. (Scheduled sessions are protected by the `appointment_id`/`status` guards, so the blast radius is on-demand waiting sessions — but deletion of someone else's live session is a real integrity/abuse bug.)

**Fix — bind the socket to a token-resolved claim, don't loosely validate each emit.** Per-emit validation still lets a *later* forged emit overwrite `socketReverseMap`. The robust shape is to establish the authorized claim once and reuse it:

1. The waiting room already has the token but doesn't send it: `src/components/patient/waiting-room.tsx:50` emits `presence:track` with `{ locationId, sessionId }` (and `:65` emits `join:session` with a bare `sessionId`). Change both to emit `{ entryToken }`.
2. On the server, resolve `entryToken → { sessionId, locationId }` **server-side**, and **store the resolved claim on `socket.data`** (e.g. `socket.data.session = { sessionId, locationId }`). Reject the emit if the token doesn't resolve.
3. `presence:track` / `join:session` use the stored `socket.data` claim, not anything in the payload. A subsequent forged emit can't change the claim because the payload is no longer trusted.
4. `cleanUpOnDemandSession` reads the **stored** claim on disconnect, so it can only ever act on the session this socket legitimately owns.

This makes the per-socket claim immutable after the first authenticated resolution, closing the overwrite path entirely (not just narrowing it).

**Why:** prevents an unauthenticated client from deleting live sessions and forging presence. Correctness *and* abuse hardening.

**Risk:** Low-medium — adds one token lookup at first `presence:track`/`join:session` per socket (then cached on `socket.data`); touches the waiting-room emit signature, so verify the waiting room still shows connected/admitted correctly.

---

### 0.3 (separate PR, after 0.1/0.2) — Make workflow block saves atomic

**Sequence this as its own PR.** It's a genuine data-integrity issue, but the fix (Postgres RPC + migration) is materially larger than route gates, and bundling it would delay the urgent auth hardening. Keep it in Tier 0 for priority, ship it after 0.1/0.2.

**`src/app/api/workflows/[id]/blocks/route.ts:121`** carries a `// --- BEGIN TRANSACTION ---` comment, but the body is a **sequence of separate Supabase calls** (delete removed blocks → update retimed → insert new → recalculate in-flight actions). There is no real transaction; a failure partway leaves blocks/actions partially updated, with no rollback.

**Fix:** move the mutation into a Postgres function (RPC) so it's a genuine single transaction; **or**, as a lesser step, split "save the block definitions" from "recalculate in-flight actions" and make the recalculation idempotent with explicit reconciliation/retry, so a partial failure is self-healing on the next save.

**Why:** workflow definitions drive patient-facing automation; a half-applied save is a hard-to-diagnose data-integrity bug.

**Risk:** Medium-high — touches the workflow write path. RPC is the clean fix but is a schema change (migration). Verify with a forced mid-sequence failure that state is all-or-nothing.

---

## Tier 1 — Quick wins (low risk, high signal)

### 1.1 Remove dead realtime code

Three sizeable pieces of code are defined but never called:

- **`src/hooks/useRealtimeRunsheet.ts`** — not imported anywhere. The run-sheet realtime path now lives in `clinic-data-provider.tsx`. Delete the file.
- **`src/hooks/useRealtimeWaiting.ts`** — not imported anywhere (the waiting room uses the socket directly). Confirm against `waiting-room.tsx`, then delete.
- **`mergeSessionUpdate` in `src/stores/clinic-store.ts:433-484`** — a ~50-line partial-merge handler for granular Realtime session updates. Never invoked; the data provider does full `refreshSessions()` instead. Delete the action and its interface declaration (`clinic-store.ts:124-128`).
- **`refreshLocationData` in `src/stores/clinic-store.ts:110`** — declared and implemented, **zero callers** (the provider's switch handler inlines the same `Promise.all` instead). Either delete it, or refactor the provider to call it (DRY). Note: 3.6 wants to *change* the rooms-fetch behavior, so if you keep it, fix it there once rather than in two inlined copies.
- **`fetchPaymentRooms` in `src/lib/clinic/fetchers/payments.ts:46`** — exported (and re-exported from `fetchers/index.ts:8`) but never consumed. Delete both, unless 3.6 adopts it as part of a consolidated rooms+payments bootstrap.

**Why:** removes misleading code that implies a realtime-merge strategy the app doesn't use, plus two more unused exports. The bulk is `mergeSessionUpdate` (~50 lines) and the two unused hooks; `refreshLocationData` and `fetchPaymentRooms` add a few dozen more. Net effect: the actual data flow (full refetch on `session_changed`) becomes obvious, with no behavior change.

**Risk:** Very low — verified zero external references. Run `npm run typecheck` after.

### 1.2 Strip leftover debug logging

- **`src/components/clinic/shared/clinic-data-provider.tsx:66-78`** — a verbose `console.log("[onConnect]", {...})` dumping store internals on every socket reconnect. Remove it. This fires in production for every clinic user on every reconnect.
- Sweep the other **73 `console.log` occurrences** across `src`. Keep intentional `console.error` in catch blocks (that's the documented error-handling convention). Remove development trace logs, especially in patient-facing components (`intake-journey.tsx`, `phone-verification.tsx`, `intake-card-capture.tsx`) and API routes.

**Recommendation:** Add a lint guard so this doesn't regress — `no-console` with `{ allow: ["warn", "error"] }` in `eslint.config.mjs`. This makes the convention enforceable rather than aspirational.

**Why:** Console noise in production, and some logs dump internal state to the browser console on patient devices.

### 1.3 Replace `_t=${Date.now()}` cache-busting with an explicit no-store header

`clinic-store.ts:238` (and the now-dead `useRealtimeRunsheet.ts:36`) append `&_t=${Date.now()}` to the runsheet fetch to defeat caching. This is a workaround for *browser/CDN* caching of the GET response.

Note: in Next.js 16, Route Handlers are **not** cached by default — `force-dynamic` would be redundant here, and `force-static` is the opt-in that *enables* GET caching. So the right lever is an explicit response header, not a route segment config:

```ts
// src/app/api/runsheet/route.ts (and other volatile GET routes)
return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
```

Then drop the `_t` query param from the `fetch` call. (`useRealtimeRunsheet.ts` is being deleted in 1.1, so only the store call needs updating.)

**Why:** The query param leaks an implementation detail into every URL and bloats logs/metrics with infinite distinct paths. `Cache-Control: no-store` states the intent explicitly for the browser and any CDN. Source: https://nextjs.org/docs/app/getting-started/route-handlers#caching

---

## Tier 2 — Simplification

### 2.1 Consolidate the staff-assignment lookup — but NOT as "current org"

The pattern below appears in ~9–12 API routes (`grep 'locations!inner' src/app/api`):

```ts
const { data: assignment } = await service
  .from("staff_assignments")
  .select("location_id, locations!inner(org_id)")
  .eq("user_id", user.id)
  .limit(1)        // ⚠️ "first assignment wins"
  .single();
```

**Critical semantics correction (from review):** this app supports **multiple assignments**, and the real current org is derived from the **selected location** in the client (`src/components/clinic/shared/providers.tsx:49`), not from "the first row." A shared `resolveStaffOrg(userId) → { orgId, locationId }` built on `.limit(1)` would authorize or *write to the wrong org* for multi-org / multi-location users. **Do not** use it for authorization.

So this is two different things, kept separate:

- **Authorization** (Tier 0): use `requireStaffOrgAccess(orgId)` / `requireStaffLocationAccess(locationId)` / resource-scoped helpers, which check membership of the **org/location named in the request**. These are the only helpers Tier 0's gates should use.
- **Default-org resolution** (this item): a `resolveDefaultStaffOrg(userId)` helper is fine **only** for genuinely default/setup flows where no scope is supplied (onboarding, "land somewhere sensible on first login"). Name it so it can't be mistaken for an authorization primitive, and keep its `.limit(1)` ambiguity out of any write path.

**Why:** DRY for the legitimate default-resolution call sites, *and* a guardrail comment so nobody reaches for the single-org helper when they need a scope check.

**Risk:** Low for the refactor itself; the value is mostly in preventing the mis-use the review caught.

### 2.2 Factor out clinician-assignment mutations in settings/rooms

**`src/app/api/settings/rooms/route.ts`** inlines `clinician_room_assignments` insert/update/delete logic across POST (lines ~159-165) and PATCH (lines ~205-225), with a delete-then-reinsert pattern duplicated. Extract `updateClinicianAssignments(service, roomId, staffAssignmentIds)` into `src/lib/clinic/fetchers/rooms.ts` (or a sibling `rooms-mutations.ts`).

**Why:** The reads already live in the fetcher; the writes should too. Removes duplicated diff logic.

### 2.3 Decompose the largest components

These exceed a reasonable single-file size and mix concerns. Decompose into a parent + focused child components/hooks, matching the pattern already established in `patient-contact-card/` and `process-flow/`:

| File | LOC | Note |
|------|-----|------|
| `src/components/patient/intake-journey.tsx` | 918 | 5 `useEffect`s; largest component in the app. Split step logic into a hook + per-step children. |
| `src/components/clinic/settings/appointment-type-editor.tsx` | 651 | |
| `src/components/clinic/workflows/outcome-pathway-editor.tsx` | 649 | |
| `src/components/clinic/process-flow/process-flow-outcome.tsx` | 627 | |
| `src/stores/clinic-store.ts` | 599 | See 2.4 — split by slice. |
| `src/components/clinic/settings/payments-settings-shell.tsx` | 581 | |
| `src/components/clinic/runsheet/add-session-panel.tsx` | 571 | |

**Why:** Maintainability and reviewability. These are the files most likely to accrue bugs.

**Risk:** Medium — these are interactive components. Decompose one at a time, behind manual verification (`/verify` against the running app). Prioritise `intake-journey.tsx` (patient-facing, most complex).

**Note:** This is the highest-effort item in the plan. It is optional polish, not a correctness fix — sequence it after Tiers 1 and the perf wins.

### 2.4 Split the Zustand store by domain slice

`clinic-store.ts` (599 lines) holds runsheet, readiness, workflows, forms, files, payments, and onboarding state in one object. Zustand supports the [slices pattern](https://github.com/pmndrs/zustand/blob/main/docs/guides/slices-pattern.md). Split into `createRunsheetSlice`, `createReadinessSlice`, `createWorkflowsSlice`, etc., combined in one `create()`.

**Why:** Each page touches one slice; the monolith forces every contributor to read all of it. Slices also make the per-slice `*Loaded` / `*FetchedAt` bookkeeping local to its domain.

**Risk:** Low-medium — public hook API (`useClinicStore`) stays identical, so consumers don't change. Pure internal reorganisation. Do after 1.1 (dead `mergeSessionUpdate` removed first).

---

## Tier 3 — Performance

### 3.1 Fix readiness count scoping (correctness) + collapse the query waterfall

**This is a correctness bug first, a performance item second.**

**Correctness:** In `src/lib/clinic/fetchers/readiness.ts`, the `runs` query (line ~32) and `oppositeCount` query (line ~49) filter only on `status` and `direction` — **not on `locationId`**. The returned `counts` (lines ~55-58) are computed from those unscoped results (`runsByAppointment.size` and `oppositeCount`). Location filtering happens later (line ~69, `appointments ... .eq("location_id", locationId)`) and feeds only the appointment *list*, not the counts. **Result:** in a multi-location org, the readiness count badges include other locations' workflow runs. Fix by scoping runs to the location — join/filter through `appointments` for the target location *before* counting, so both the list and the counts derive from the same location-scoped set.

**Performance (after correctness):** the fetcher still runs up to ~5 sequential round-trips. Once runs are location-scoped:

1. The two `appointment_workflow_runs` queries (active+direction, active+opposite) can be **combined into one** location-scoped query pulling both directions, partitioned in memory.
2. The conditional outcome-pathways top-up (lines ~143-155) — **fold into the sessions select** as a join, or pre-fetch org pathways in the initial parallel batch.
3. The conditional "missing forms" top-up (lines ~183-197) — **widen the initial forms query** so it never fires.

The 9-query parallel batch (lines ~103-131) is already good; leave it.

**Why:** Wrong counts mislead reception staff in multi-location orgs (the badge is a primary signal). Latency is the secondary win: ~5 sequential phases → ~3.

**Risk:** Medium — most complex fetcher, and the count change alters output. Verify against seeded **multi-location** data: confirm counts now exclude other locations, and the appointment list is unchanged.

### 3.2 Reshape the forms fetcher's assignment-count query

**Correction to the first draft:** `src/lib/clinic/fetchers/forms.ts` cannot be parallelized with a naive `Promise.all` — the `form_assignments` query (line ~24) filters `.in("form_id", formIds)`, where `formIds` is derived from the forms query (line ~20). The second query genuinely depends on the first.

To remove the second round-trip, change the *shape* instead:
- Fetch `form_assignments` by `org_id` directly (if the column exists or is reachable via a join) in parallel with forms, then aggregate counts in memory — removing the `formIds` dependency; **or**
- Push the aggregation into the database (a view or an RPC returning per-form `total`/`completed` counts) so it's one round-trip.

If neither is clean, **drop this item** — it's a single extra round-trip on a non-hot slice and not worth a contortion.

**Why:** Honest framing — there's no free parallelization here. Only do it if the query reshape is genuinely simpler; otherwise it's not worth it.

### 3.3 Consider SSR hydration for the first clinic page paint

Currently every clinic page is an empty shell that, on cold load, runs: hydrate → `useEffect` → `fetch('/api/...')` → render. The data the run sheet needs (rooms, sessions, clinician room IDs) is fetchable server-side via the existing `lib` fetchers.

**Option A (recommended, incremental):** In `src/app/(clinic)/runsheet/page.tsx`, fetch the run-sheet slices server-side (reuse `fetchRunsheetSessions`, `fetchRoomsWithClinicians`) and pass them to `RunsheetShell` as `initialSessions` / `initialRooms` props. The shell seeds the store from props on first render and skips the cold-load fetch (its `*Loaded` flags start `true`). Socket.IO + refetch behaviour is unchanged.

**Option B:** Leave as-is. The skeleton UX is acceptable and the client-fetch model keeps real-time simple.

**Why:** Removes a full client round-trip from first paint of the most-used page. The `_t` cache-bust (1.3) and the freshness-window logic in `clinic-data-provider.tsx` already exist precisely to manage the SSR-vs-client-fetch race — the infrastructure anticipates this.

**Risk:** Medium. The freshness-window gate (`FRESH_WINDOW_MS`) in the data provider must correctly suppress the post-hydration refetch. Do `runsheet` only first; validate, then decide on readiness/workflows.

**Recommendation:** Do this for `runsheet` only. It's the page that benefits most and the pattern is reusable if it proves out.

### 3.4 Collapse the workflows cold-load from two requests to one

**`src/stores/clinic-store.ts:353`** (`refreshWorkflows`) calls `/api/workflows/init` **twice** — once with `direction=pre_appointment`, once with `post_appointment`. But the route (`src/app/api/workflows/init/route.ts:16`) runs `fetchWorkflowsInit(orgId)` on every call — and that fetcher computes **both** directions every time (pre at `workflows.ts:~40-75`, post at `~77-106`) — *and the route itself re-queries `forms` in parallel on each call* (`init/route.ts:16-24`; the fetcher does not touch forms). So the cold load runs the full workflows batch twice and the forms query twice, discarding half each time. (React's `cache()` on the fetcher dedupes within one render, not across two HTTP requests.)

**Fix:** make `/api/workflows/init` return pre + post + forms in **one** payload, and have `refreshWorkflows` call it once. The store already has separate `pre*`/`post*` slots to populate.

**Why:** Halves the workflow cold-load work outright — the second request is pure waste today. High value-to-effort.

**Risk:** Low — the fetcher already produces both directions; this just stops throwing one away. Verify the workflows page renders both pre and post.

### 3.5 Scope workflow blocks/runs/links queries to the org

**`src/lib/clinic/fetchers/workflows.ts`** pulls three things globally and filters in memory: all `workflow_action_blocks` (`:34`), all active `appointment_workflow_runs` (`:36`), **and** all `pre_appointment` `type_workflow_links` (`:33`).

**Fix:** fetch the org's appointment types and templates first (already queried at `:32`/`:35`), derive `typeIds` and `templateIds`, then scope the dependent queries:
- `type_workflow_links` → `.in("appointment_type_id", typeIds)`
- `workflow_action_blocks` → `.in("template_id", templateIds)`
- `appointment_workflow_runs` → `.in("workflow_template_id", templateIds)`

Turns three unbounded table scans into bounded, org-scoped queries.

**Why:** scale (memory + transfer grow with *total* platform data, not this org's) and a mild data-isolation improvement. Pairs naturally with 3.4 since both touch this fetcher.

**Risk:** Low — pure narrowing of existing filters; output identical. Sequencing note: this adds one dependent round-trip (templates → blocks/runs), so do it *with* 3.4's consolidation, not as a separate regression on cold-load latency.

### 3.6 Eliminate the duplicate room fetch on location refresh

**`src/stores/clinic-store.ts:387`** — `refreshPaymentConfig` fetches `/api/settings/rooms` to derive `paymentRooms`, but `refreshRooms` already fetched the same endpoint moments earlier in the same location bootstrap (`refreshLocationData` / the provider's switch handler fire both in one `Promise.all`). Two identical requests per location load.

**Fix:** derive `paymentRooms` from the `rooms` already in the store (it's a subset projection), or have one location-bootstrap endpoint return rooms + payment config together.

**Why:** removes a redundant round-trip on every location load/switch.

**Risk:** Low.

### 3.7 Fix runsheet "today" filtering (correctness)

**`src/lib/runsheet/queries.ts:82-83`** — the comment says it fetches "today's sessions," but it filters `sessions.created_at` between start/end of the target day. If a session is ever created **before** its appointment day (e.g. "Plan tomorrow", or any pre-spawned session), it will be **missing** from the day it's actually scheduled for, and wrongly appear on its creation day.

**Fix:** filter by the session's *scheduled* date — i.e. the linked appointment's `scheduled_at` (and handle on-demand sessions with no appointment, which legitimately key off `created_at`). Confirm the morning-scan/seed behavior so the two stay consistent.

**Why:** silent missing rows on the run sheet is a serious operational bug if pre-day session creation is ever used. **Verify whether it bites today** — if sessions are only ever spawned same-day (morning scan), the current filter is incidentally correct and this drops to low priority. Worth confirming against `src/lib/runsheet/seed.ts` and the daily-scan cron before acting.

**Risk:** Medium — changes which rows appear. Verify against seeded data spanning a "planned tomorrow" session.

### 3.8 Bound unbounded list queries — without silently dropping records

`/api/appointment-types`, `/api/outcome-pathways`, `/api/forms/assignments` list without limits — a data-heavy org could degrade a page.

**Caveat (from review):** a bare `.limit(200)` on a config page is **silent data loss** — records simply vanish with no indication. Config lists must not hide rows. Options, in order of preference:

1. **Pagination or search** on the page (correct long-term answer for config lists).
2. A **high explicit cap** *with* detection — if the row count hits the cap, surface it in the UI (or return a flag the page renders as "showing first N, refine your search"), never a silent truncation.

A blind cap is only acceptable on genuinely bounded sets (e.g. rooms per location). For open-ended config lists, prefer option 1.

**Why:** guardrail against pathological loads without trading it for a correctness footgun. Low urgency.

### 3.9 Narrow `select("*")` in hot/config paths

Several paths pull full rows where only a subset renders: `src/lib/clinic/fetchers/workflows.ts:32` (and the `*` on blocks/templates at 34-35), `src/app/api/outcome-pathways/route.ts:18`, `src/app/api/forms/[id]/route.ts:14`. Small today; compounds as workflow/forms data grows.

**Why:** bounded payloads, and it forces a deliberate column list (which catches accidental over-fetching). Low urgency — do it opportunistically when already editing these files (e.g. alongside 3.4/3.5).

**Caveat:** `forms.schema` is JSONB the builder genuinely needs — don't strip columns that are actually consumed. Narrow only verified-unused fields.

---

## Explicitly NOT recommended

- **No TanStack Query / SWR migration.** The Zustand + Socket.IO model is intentional and documented (see `project_nav_perf_plan` memory). Don't churn it.
- **No Supabase Realtime adoption.** Socket.IO is the chosen path; the CLAUDE.md is clear.
- **No type-layer changes.** `database.generated.ts` / `custom-types.ts` / `types.ts` separation is correct — generated rows vs. hand-authored domain views, zero duplication.
- **No wholesale service-role removal.** Service role is the right tool here (patients aren't auth users; staff routes resolve org server-side). The fix is **adding staff gates** to the routes that lack them (Tier 0), *not* swapping clients or migrating to RLS-scoped clients everywhere. ~~First draft wrongly concluded "no RLS-bypass concerns" — see Tier 0.~~

---

## Suggested sequencing

Ordered by **risk first** (security/correctness before polish), per the review:

1. **Tier 0, PR A — auth + presence** (the urgent pass): 0.1 (authenticate + org-scope all service-role routes, all methods, via `requireStaffOrgAccess` / `requireStaffLocationAccess` / resource-scoped helpers) and 0.2 (presence validation — recall this prevents **session deletion**, not just dot pollution). These are the most severe defects; ship together with end-to-end clinic-app verification across roles.
   **Tier 0, PR B — atomic block saves** (0.3): separate, *after* PR A, because the RPC/migration is larger and must not delay the auth fix.
   Note: 2.1 is *not* a prerequisite — Tier 0 must use the scope-checking helpers, never a single-org `resolveStaffOrg`.
2. **3.4 + 3.5** — workflows cold-load: one request instead of two, and org-scoped blocks/runs. High value-to-effort, output-identical, touches one fetcher. Verify the workflows page.
3. **Correctness fixes** — **3.1** (readiness count scoping, verify multi-location) and **3.7** (runsheet "today" filter — *first confirm it actually bites* given same-day spawning; may drop to low priority).
4. **Tier 1** (1.1–1.3) — dead code (now incl. `refreshLocationData`, `fetchPaymentRooms`), debug logging, no-store header. Pure cleanup. 3.6 (duplicate room fetch) folds in if `refreshLocationData` is reworked here.
5. **2.2 + 3.2** — mutation-helper extraction; forms-fetcher reshape *only if genuinely simpler* (else drop).
6. **3.3** (runsheet SSR), then **3.8 / 3.9** (limits, `select` narrowing) opportunistically.
7. **2.4** (store slices) then **2.3** (component decomposition) — separate PRs, one component at a time, each manually verified.

**Only 1.1 (dead code) and the targeted debug-log removal in 1.2 are purely mechanical.** Everything else — the Tier 0 gates, the workflows consolidation, the readiness/runsheet correctness fixes, the forms reshape, the SSR change, and the refactors — alters behavior or output and must ship behind verification against the running app (`/verify`), not just `typecheck`.
