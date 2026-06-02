# Supabase → Neon Migration (in progress)

Permanent prototype. Goal: kill ~245ms/query latency (Supabase DB was in a far
region). Neon `cotwo` project is in **Sydney** (`royal-voice-41077434`).
Direct pooled `pg` + Drizzle gives **~18ms warm queries** (verified).

## Decisions
- **Data layer:** direct pooled `pg` + Drizzle ORM (NOT Supabase Data API/PostgREST — that keeps the per-call HTTP model).
- **Auth:** staff → Neon Auth (`@neondatabase/auth`, `createNeonAuth`). Patient OTP → custom (Neon Auth has no phone OTP).
- **RLS:** DROPPED. Authz lives in app code (`src/lib/auth/staff-access.ts` gates). 73 of 78 call sites already used the service (RLS-bypass) client.
- **Storage:** Supabase Storage (`org-logos`, `clinic-files` buckets) has NO Neon equivalent. `files.storage_path` column kept. Needs a provider or stub — OPEN.

## Done
- Schema live on Neon (30 tables, 19 enums, 5 fns) — `supabase/neon/consolidated_schema.sql`.
- Drizzle: `src/lib/db/schema.ts` (introspected), `relations.ts`, `index.ts` (pooled pg, `db` export).
- `.env.local` has `DATABASE_URL` (pooled `-pooler` host, Sydney).
- **Reference conversion done & type-clean:** `src/lib/clinic/fetchers/readiness.ts`.

## Translation patterns (supabase-js → Drizzle)
Import `db` from `@/lib/db` and tables from `@/lib/db/schema` (camelCase exports, e.g. `appointmentWorkflowRuns`). Import ops from `drizzle-orm`: `and, eq, inArray, isNotNull, isNull, or, sql, desc, asc`.

- `createServiceClient()` → use `db` directly (no client construction).
- `.from("t").select("a, b_c")` → `db.select({ a: t.a, b_c: t.bC }).from(t)` — **alias output keys back to snake_case** so downstream consumers are untouched.
- `.eq(c,v)` → `.where(eq(t.c, v))`; multiple → `and(...)`.
- `.in(c, arr)` → `inArray(t.c, arr)`. Guard empty arrays: `arr.length === 0 ? [] : await db...` (Drizzle errors on empty inArray in some cases; also avoids a pointless query).
- `.not("c","is",null)` → `isNotNull(t.c)`.
- `table!inner(x)` + `.eq("table.x", v)` → `.innerJoin(t2, eq(t2.id, t.fk))` + `and(eq(t2.x, v))`.
- `.or("and(a.eq.X,b.eq.Y),...")` (pairs) → row-tuple IN: `` sql`(${t.a}, ${t.b}) IN (${sql.join(pairs, sql`, `)})` `` where ``pairs = items.map(i => sql`(${i.a}, ${i.b})`)``.
- `.order("c", {ascending:false})` → `.orderBy(desc(t.c))`.
- `.limit(n)` → `.limit(n)`; `.single()`/`.maybeSingle()` → `const [row] = await db...; ` then use `row`.
- `.rpc("fn", args)` → `` db.execute(sql`select * from fn(${a}, ${b})`) `` (the 4 RPCs exist on Neon: configure_appointment_type, configure_outcome_pathway, confirm_outcome_pathway, save_workflow_blocks).
- Result unwrap: supabase returns `{ data, error }`; Drizzle returns the array directly. Drop `.data`, drop `{ error }` handling (Drizzle throws on error — wrap in try/catch where the old code checked `error`).
- INSERT: `.insert(t).values({...}).returning()`. UPDATE: `.update(t).set({...}).where(...)`. DELETE: `.delete(t).where(...)`.
- Nullable columns: Drizzle types them precisely. For ID arrays feeding `inArray`, narrow with `.filter((x): x is string => !!x)` (NOT `.filter(Boolean)`). For fn args wanting `string|undefined`, use `?? undefined`.
- jsonb columns come back typed `unknown` — cast at use site (`as Record<string, unknown>` etc.).
- `mode: 'string'` timestamps: Drizzle returns timestamptz as ISO strings (matches old supabase behaviour). Good.

## Auth (Task #3) — not started
- Neon Auth base URL: `https://ep-restless-lab-a70tuds0.neonauth.ap-southeast-2.aws.neon.tech/neondb/auth`
- Needs `NEON_AUTH_BASE_URL` + `NEON_AUTH_COOKIE_SECRET` (32+ chars) in `.env.local`.
- Server SDK: `createNeonAuth({baseUrl, cookies:{secret}})` from `@neondatabase/auth/next/server`. Methods: `auth.getSession()`, `auth.signIn.email()`, `auth.signUp.email()`, `auth.signOut()`, `auth.handler()` (catch-all route at `app/api/auth/[...path]/route.ts`).
- `getAuthenticatedUserId()` (staff-access.ts): swap `getClaims()` → verify Neon Auth session/JWT, return user id. The 18 downstream gates stay unchanged.
- NO `handle_new_user` trigger anymore: on signup, app must explicitly INSERT `public.users` (id = neon_auth user id, email, full_name).
- Browser auth files: login, signup, reset-password, setup/rooms, sidebar-user-section.
- `outcome-pathway-editor.tsx` does direct `.from()` in the BROWSER → must become an API route call (browser can't hold pg).

## STATUS: COMPLETE ✅
All 6 tasks done. App runs against Neon Sydney, verified end-to-end, 0 errors.

Latency (warm, application-code): tasks pre_appointment ~2000ms→192ms, runsheet ~850ms→101ms, patient resolve ~20ms. ~10× win.

What remains on Supabase (intentional): Storage only (org-logos, clinic-files buckets) + `@/lib/supabase/types` (pure TS type imports, no runtime). Auth fully on Neon Auth; all data on Drizzle/Neon.

Minor deferred polish (harmless, prototype): dead `service`/`_serviceClient` vars in a few files (settings/rooms, rooms-mutations, patient/[id]/summary passthrough); `supabase/types` could be renamed to a local types file; the deliver_form seed block was dropped (referenced a form not in seed.sql).

## Files still on supabase (historical — now storage/types only)
Run `grep -rl 'from "@/lib/supabase/' src/` for the live list.
