# Plan: Migrate live updates to Socket.IO on Railway

## Context

Supabase Realtime has been non-functional on this project for both `postgres_changes` and `broadcast` subscriptions. The project logs show persistent `UnableToConnectToProject` errors — the Realtime service can't talk to Postgres, and client subscribes silently time out. Pause/unpause via the dashboard has not cleared the state. REST-based broadcast publish works (it's just HTTP), but no client can receive.

We've already shrunk the problem: the Zustand store hydrates per-slice on first need and persists across client-side navigation, so reads are cheap. The only missing piece is **live updates** — telling the clinic run sheet to refresh when a patient joins or a session state transitions.

This plan replaces Supabase Realtime with a self-hosted Socket.IO server, deployed to Railway alongside Next.js.

## Architecture

```
Browser (/runsheet)
    │   WebSocket (Socket.IO)
    ▼
Custom Node server (server.ts) — the ONLY module that holds the `io` instance
    ├─ Next.js request handler (all existing routes unchanged)
    ├─ Internal POST /_internal/broadcast handler → io.to(room).emit(event, payload)
    └─ Socket.IO server, attached to the same HTTP server
         ▲
         │  HTTP POST to http://127.0.0.1:PORT/_internal/broadcast
         │
    /api/patient/arrive, /api/runsheet/session-mutate, etc.
    (call `broadcastSessionChange(locationId, event, payload)`)
```

- One process serves Next.js + Socket.IO on the same port.
- Socket.IO rooms scope events to a location — `io.to(`location:X`).emit(...)` hits only clients at that location, not the whole org.
- **The `io` instance lives only in `server.ts`'s scope.** Next.js App Router API routes run in isolated Webpack-bundled workers that do NOT share Node's module cache with the custom server. Trying to import `io` from an API route resolves to a separate module instance where `io` is null. The fix: API routes publish by POSTing to a local `/_internal/broadcast` endpoint handled by the main server process, which then does the `io.to(...).emit(...)` in its own scope.
- Clients authenticate via the existing Supabase session cookie. A connection middleware validates the cookie, resolves the user's `staff_assignments`, and gates which rooms they can join.
- Replaces Supabase Realtime entirely for live-update purposes. Supabase stays for DB/auth only.

## Hosting

- **Dev:** `npm run dev` runs `tsx server.ts` — same process, same port.
- **Prod:** Railway. Deploy from git. Railway supports WebSockets natively and doesn't have Vercel's serverless constraint. Cost: ~$5-10/mo at prototype scale.
- **Not Vercel.** Custom Node servers can't run on Vercel. If the production engineering team wants Vercel later, they can swap Socket.IO for Pusher/Ably with the same pub/sub API shape — write-path call sites don't change.

## Event contract (v1)

| Event | Direction | Payload |
|---|---|---|
| `join:location` | client → server | `{ locationId: string }` |
| `session_changed` | server → client | `{ event: 'arrived' \| 'session_created' \| 'status_changed' \| 'session_updated' \| 'session_deleted', sessionId: string }` |

Future events (readiness, workflow, payment) layer on without architectural change.

## Write paths (scope for v1)

- `/api/patient/arrive` — both branches (on-demand create + existing session arrive) emit `session_changed`.

Follow-up (not in this plan): session status transitions (process flow, in_session, complete, done), run-sheet add/remove session, workflow action state changes. Pattern is identical.

## Phases

### Phase 1: Custom server + Socket.IO plumbing

Stand up the dual-purpose Node server and prove a browser can connect. No auth, no emit-from-routes yet. Just "socket connects, logs connection, client logs connected."

| # | File | New/Modify |
|---|---|---|
| 1 | `package.json` | Modify — add deps `socket.io`, `socket.io-client`, `tsx`. Change scripts: `"dev": "tsx server.ts"`, `"start": "tsx server.ts"`, leave `"build"` as `next build`. |
| 2 | `server.ts` | New — creates Node HTTP server. The request handler is a single `async` function that (a) intercepts `POST /_internal/broadcast` and calls `io.to(room).emit(event, payload)`, (b) falls through to the Next.js handler for everything else. Attaches Socket.IO to the HTTP server. The `io` instance is held in a module-level `const` inside `server.ts` — it is NOT exported. |
| 3 | `src/lib/socket-client.ts` | New — browser-only module. Exports a lazy singleton `getSocket()` that calls `io()` from `socket.io-client`. Handles `connect` / `disconnect` / `connect_error` logging. No URL — uses same origin. |
| 4 | `src/components/clinic/clinic-data-provider.tsx` | Modify — remove existing Supabase broadcast subscribe useEffect. Add a new useEffect that grabs the socket, emits `join:location` with current `locationId`, and logs lifecycle. No event listener yet. |

**Acceptance:** `npm run dev` starts one process. Open `/runsheet`, browser console shows `[socket] connected`. Dev server log shows a connection. No errors.

**Note:** There is no `src/lib/socket-server.ts` module. The `io` instance lives only inside `server.ts`'s closure. This is deliberate — see the architecture section's note on Next.js App Router worker isolation.

### Phase 2: Server-side emit from the patient arrive path

Replace the Supabase-based broadcast helper with an HTTP POST to the internal broadcast endpoint. Wire up the client listener.

| # | File | New/Modify |
|---|---|---|
| 5 | `src/lib/realtime/broadcast.ts` | Modify — same export name (`broadcastSessionChange`) and signature. New implementation: `await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/_internal/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: `location:${locationId}`, event: 'session_changed', payload: { event, ...payload } }) })`. Drops the `SupabaseClient` parameter. Non-fatal on failure — log and swallow. |
| 6 | `src/app/api/patient/arrive/route.ts` | Modify — drop the `supabase` argument when calling `broadcastSessionChange`. Both branches (on-demand create + existing session arrive) stay. |
| 7 | `src/components/clinic/clinic-data-provider.tsx` | Modify — add a `socket.on('session_changed', ...)` listener that calls `getClinicStore().refreshSessions(currentLocationId)`. Clean up on unmount. |

**Acceptance:** Two tabs open. Tab A: `/runsheet` logged in as clinic staff. Tab B: `/entry/link-xxx?room=yyy`. Walk through patient flow. When arrive completes, tab A's run sheet refreshes within 1s. No polling. Browser console on tab A shows `[socket] session_changed received`. Dev server log shows `POST /_internal/broadcast 200` immediately after `POST /api/patient/arrive 200`.

**Note on the internal HTTP hop:** The API route sends an HTTP POST to `127.0.0.1:PORT` within the same machine. This is a ~1ms loopback call, not a real network trip. The overhead is trivial. The tradeoff is that the `io` instance stays trapped inside `server.ts`'s module scope where it's safe from Next.js worker isolation.

**Security of `/_internal/broadcast`:** The endpoint is only reachable from `localhost`. It's not exposed externally — Railway's router only forwards public traffic to routes Next.js knows about, and the interceptor in `server.ts` handles `/_internal/*` before Next.js ever sees it. Still, the handler should check `req.socket.remoteAddress` is `127.0.0.1`/`::1` and reject otherwise, as a belt-and-braces measure against any future reverse-proxy misconfiguration.

### Phase 3: Client reconnect resync

If the socket drops and reconnects, we may have missed events. On every `connect` (including reconnects), re-emit `join:location` AND trigger `refreshSessions` once to resync.

| # | File | New/Modify |
|---|---|---|
| 8 | `src/components/clinic/clinic-data-provider.tsx` | Modify — listen for `connect` (not just initial). On each fire, emit `join:location` and call `refreshSessions`. Idempotent. |

**Acceptance:** With `/runsheet` open, toggle network off for 10s, back on. Browser console shows disconnect → reconnect. A `refreshSessions` call fires on reconnect. Any events published while offline cause the store to be up-to-date after reconnect.

### Phase 4: Auth middleware

Lock down the socket. Anonymous connections can't join any rooms. All auth lives inside `server.ts` alongside the `io` instance — no separate module, consistent with the Phase 1 decision.

| # | File | New/Modify |
|---|---|---|
| 9 | `server.ts` | Modify — add `io.use(authMiddleware)`. Middleware parses Supabase session cookie from `socket.handshake.headers.cookie`, validates the JWT server-side using `@supabase/ssr`, queries `staff_assignments` for allowed location IDs, attaches `{ userId, allowedLocationIds }` to `socket.data`. Rejects connections without a valid session. |
| 10 | `server.ts` | Modify — in the `join:location` handler, verify `socket.data.allowedLocationIds.includes(locationId)` before joining. Drop silently if not allowed. |

**Acceptance:** Log out, try to open a WebSocket to `/socket.io/` with no cookie — connection rejected. Log in as a user assigned to location A, try to emit `join:location` for location B — no membership granted (verify server-side by checking `io.sockets.adapter.rooms`). Normal usage by authenticated staff unchanged.

### Phase 5: Cleanup

Remove Supabase realtime code that's now dead weight.

| # | File | New/Modify |
|---|---|---|
| 11 | `src/lib/supabase/client.ts` | Modify — remove the `realtime.setAuth` wiring. Supabase client is now only used for DB + auth, not realtime. |
| 12 | `src/components/clinic/clinic-data-provider.tsx` | Modify — remove any leftover `[Broadcast]` console.logs from diagnosis phase. |
| 13 | `src/lib/realtime/broadcast.ts` | Modify — final cleanup pass on comments. |

**Acceptance:** `npm run build` clean. `npx tsc --noEmit` clean. No references to `supabase.channel(...)` outside of tests/docs.

## Railway deployment

Not a code change, but the plan should call it out:

1. **Create Railway project**, link to the GitHub repo.
2. **Set build command:** `npm run build`.
3. **Set start command:** `tsx server.ts` (or precompile to JS first — see note below).
4. **Environment variables:** copy everything from `.env.local` into Railway's env config. Critically `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any Stripe/LiveKit keys.
5. **Port:** Railway injects `PORT` — `server.ts` must read `process.env.PORT`.
6. **Hostname:** Railway's assigned URL works for both HTTP and WebSocket. Socket.IO client auto-uses `window.location.origin`, so no client-side URL config needed.

**Production note:** running TypeScript via `tsx` in prod is acceptable for a prototype but less efficient than precompiling. A production-grade handover would add a build step that emits `server.js` + `dist/` via `tsc`, and Railway runs `node dist/server.js`. Not in scope for this plan.

## Risks and mitigations

- **Next.js App Router worker isolation (the module-cache trap).** Next.js 13+ App Router API routes run in isolated Webpack-bundled contexts that do NOT share the Node module cache with the custom server. An `io` instance defined and exported from a shared module would resolve to `null` (or a fresh, never-initialized instance) when imported from an API route. Mitigation: the `io` instance lives only inside `server.ts`'s scope. API routes publish via an HTTP POST to `http://127.0.0.1:PORT/_internal/broadcast` — a loopback hop the custom server intercepts before forwarding to Next.js. This is why the plan has no `src/lib/socket-server.ts` module and why `broadcastSessionChange` is implemented as a `fetch()`, not a direct `io.emit()`.
- **HMR disconnects the socket.** In dev, when Next.js hot-reloads server code, the custom server restarts and the socket drops. Client auto-reconnects. User-invisible nuisance, not a correctness issue.
- **Vercel lock-in.** Flagged. If production must stay on Vercel, swap Socket.IO for Pusher/Ably — the write-side API (`broadcastSessionChange`) stays the same, so only the server/client plumbing changes.
- **Multiple Railway instances.** At prototype scale we run one instance, so in-process emit works. If Railway scales horizontally later, we'd need the Socket.IO Redis adapter. Out of scope for this plan.
- **Existing `createClient` calls to Supabase for realtime.** The browser `createClient` still sets up Supabase realtime under the hood even though we're not using it — wasted WebSocket attempts to the broken Supabase realtime URL. Phase 5 removes the setAuth wiring; if we notice console noise from failed Supabase socket attempts, we can also pass `{ realtime: { params: { eventsPerSecond: 0 } } }` to disable the client's realtime subsystem entirely.

## Estimated time

- Phase 1: 45 min
- Phase 2: 30 min
- Phase 3: 15 min
- Phase 4: 45 min
- Phase 5: 15 min
- Railway deploy + env wiring: 30 min

**Total: ~3 hours.**

## Acceptance criteria (end-to-end)

- `npm run dev` starts Next.js + Socket.IO in one process on one port.
- `npm run build && npm start` runs the same in production mode.
- `/runsheet` connects to Socket.IO on mount, joins the correct `location:X` room.
- Patient joining via entry link → run sheet refreshes within 1s. No polling. No Supabase Realtime.
- Network flap → socket reconnects → state resyncs via `refreshSessions`.
- Unauthenticated client cannot join any room. Authenticated client cannot join a room for a location they don't have a `staff_assignment` for.
- `npx tsc --noEmit` and `npm run build` clean.
- Deployed to Railway, reachable via Railway's assigned URL, live updates working cross-tab in production.
