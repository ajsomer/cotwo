# Conventions: Real-time and State

How real-time and client state actually work in this codebase. Real-time is the easiest thing to get wrong silently, and the failure modes (stale data, missed events, doubled subscriptions) are hard to debug after the fact. Read this before subscribing to a new channel or adding a new piece of client state.

---

## How real-time actually works in this codebase

Socket.io is the dominant transport. The custom `server.ts` runs Socket.io alongside Next.js and is the primary live-update mechanism for both clinic-side and patient-side surfaces today. Server-side mutations publish to Socket.io rooms via the broadcast helpers in `src/lib/realtime/broadcast.ts`, which post to an internal `/_internal/broadcast` HTTP endpoint that `server.ts` forwards as a Socket.io emit. Clients connect via `getSocket()` (`src/lib/socket-client.ts`), join rooms, and listen for named events.

Supabase Realtime (Postgres change feeds) is available but not currently wired up. `src/hooks/useRealtimeRunsheet.ts` and `src/hooks/useRealtimeWaiting.ts` exist but neither is called from any component — they're vestigial from an earlier design. Don't add new code that uses them; if you need a feed, add it to the Socket.io system.

If a future feature genuinely benefits from row-level change feeds (a single-row subscriber, no application-level semantics), Supabase Realtime is still on the table. But that's a deliberate choice with a justification, not a default. Default to Socket.io.

## Rooms and events

Socket.io uses rooms (the `socket.join(room)` / `io.to(room).emit(...)` pattern), not topic-per-feed channels. The clinic side uses one room per location, and event names dispatch the topic. This is by design — most clinic events are interesting to anyone watching that location, regardless of which surface they happen to be on.

**Clinic-side room:** `location:{location_id}`. The client joins via `socket.emit("join:location", locationId)` (see `clinic-data-provider.tsx`). The server enforces room membership against the user's `staff_assignments` (see `server.ts` `join:location` handler).

**Events emitted into the location room:**

- `session_changed`: a session's stored status, fields, or membership changed. Triggers a sessions refetch in the clinic store. Published by `broadcastSessionChange` / `broadcastSessionStatus`.
- `readiness_changed`: a readiness-relevant change (intake completed, transcribed, appointment added/removed). Triggers a readiness refetch. Published by `broadcastReadinessChange`.
- `presence:update`: which patient sessions currently have a connected tab in the waiting room. Updates the "connected" dot on the run sheet. Published from `server.ts` based on tracked socket presence.

**Patient-side rooms:** the waiting room joins the same Socket.io system and tracks presence via `presence:track`. There is no separate per-session room today; status changes are picked up via Socket.io events emitted alongside the same mutations that fire `session_changed`.

**Naming rules:**

- Lowercase, colon-separated. `location:abc-123-def`.
- Rooms are entity-scoped, not user-scoped. The room name describes *what* you're subscribed to.
- Event names are snake_case verbs in past tense (`session_changed`, `readiness_changed`) for state-change broadcasts, or `namespace:verb` (`presence:update`, `presence:track`) for live-state streams.
- One room per (entity-type, id). Don't fan out into `runsheet:`, `readiness:`, `payments:` per-feed rooms; reuse the location room and add a new event name. The reasoning: 95% of clients on a location care about all of its events, so per-feed fan-out doubles connections without adding selectivity.

If you need a new event on the clinic side, add it to `broadcast.ts`, register a listener in `clinic-data-provider.tsx`, and document it in this list.

## Selected-location subscription model

The location switcher controls *which* run sheet, readiness dashboard, and payments view are rendered. The clinic-side Socket.io connection joins the **selected** location's room only; switching location leaves the old room and joins the new one. The Zustand store's location-scoped slices reset and re-fetch on switch (`clinic-data-provider.tsx`).

This means today's behaviour is: **events at non-selected locations are not received by this client at all.** A receptionist assigned to three locations who is currently viewing Location A will not see tab flashes, favicon badges, or any other live signal from Location B until they switch to it.

**That is a known limitation, not a documented design.** The original spec (and the parts of `01-core-concepts.md` and the feature docs that mirror it) describes a "notifications fire across ALL assigned locations" rule — tab title flashing and favicon badges firing for any assigned location, with a click that switches context. That is the intended behaviour. The current build does not implement it. There is no separate notifications subscription, no multi-room join, and no cross-location notification fan-out. The tab/favicon hooks (`useTabNotifications`, `useFaviconBadge`) only see the selected location's data.

**What this means for contributors:**

- If you're building a feature that needs to react to events at the selected location, use the existing `location:{id}` room. That works.
- If you're building a feature that needs cross-location signal (e.g. a true multi-location notifications layer), recognise that the infrastructure isn't there yet. You'd need to either join multiple rooms on the same socket, or add a per-user room (`user:{id}`) that the server fans cross-location events into. Either is a sensible extension; pick one and document it here when you build it.
- Don't write code that *assumes* multi-location signal exists today. The store doesn't expose `assigned_location_ids` for subscription purposes, and adding listeners that read from it will quietly do nothing.

## Subscribe and unsubscribe

The lifecycle pattern across all real-time subscribers in this codebase:

- Subscribe on mount.
- Clean up on unmount.
- Unsubscribe and re-subscribe when the keying value changes (selected location, session id, etc).
- Update local state optimistically when the user takes an action; let the broadcast confirm.

In React this means a `useEffect` keyed on the channel name, with a cleanup function that calls `socket.off()` or `channel.unsubscribe()`. Forgetting the cleanup leaks subscriptions across re-renders and is the single most common source of doubled events.

For Zustand-store-managed subscriptions, the lifecycle is owned by the store, not by individual components. The store opens and closes connections in response to state changes (selected location updated, user assigned to a new location), and components read from the store without managing their own subscriptions.

## State management layers

In order of preference:

1. **Server components and server actions.** No client state at all. The server renders against the user's session, RLS-scoped, and the result is HTML. Use for static reads where there is no real-time signal forcing a refresh.

2. **Zustand store** (`src/stores/clinic-store.ts`). The clinic-side state container. Holds run sheet sessions, readiness appointments, location list, role context, real-time connection status. Slices are organised by feature (runsheet, readiness, locations, etc). Components read from the store and write through the store's setters.

3. **Component-local state.** For forms, transient UI state, and the entire patient-side flow. Patient-side has no global store; each entry-flow component owns its own state machine.

The progression is deliberate: prefer the simplest layer that covers the case. If a server component will do, don't reach for Zustand. If component state will do, don't pull data into Zustand just because it's convenient.

## The Zustand clinic store

Lives at `src/stores/clinic-store.ts`. Single store, sliced by feature.

**Slices:**

- **Locations**: list of locations the user is assigned to, the currently selected location, and the assigned-vs-selected distinction described above.
- **Runsheet**: sessions for the selected location, refreshed via Socket.io broadcasts and on initial fetch. Derived state (priority, expansion, late detection) is computed at render time, not stored.
- **Readiness**: pre-appointment and post-appointment appointment lists for the selected location, plus task counts.
- **Role / org**: the current user's role, the org tier, and any cached org-level metadata.
- **Connection**: real-time connection status. Drives the "reconnecting" UI when sockets drop.

**Patterns:**

- The store is the single source of truth for clinic-side derived UI state. Don't mirror its data into component state.
- Setters are explicit functions on the store, not direct mutations. `setSelectedLocation`, `upsertSession`, `markActionCompleted`.
- Real-time event handlers live in the store (or its direct collaborators), not in components. A component subscribes to a slice and re-renders; it does not handle the underlying Socket.io event.
- The store's `init` function (or equivalent) is called from the clinic layout once on mount. It opens connections, fetches initial data, and sets up the long-lived subscriptions.

If you need new state on the clinic side, add a slice. Don't introduce a parallel store.

## Optimistic updates

The pattern across all clinic-side mutations:

1. User takes an action ("admit patient," "mark transcribed," etc).
2. Component calls a store setter that updates local state immediately, *and* fires the API call.
3. The API call hits the server, which performs the mutation and emits a Socket.io broadcast.
4. The broadcast arrives back at the same client (and all other subscribers). The store handler reconciles: if the local state already reflects the broadcast, no-op. If not, update.
5. If the API call fails, the store rolls back the local change and surfaces an error toast.

The reason for this dance: the receptionist clicking "admit" should see the run sheet update instantly, not wait for a round-trip. But the broadcast is still authoritative, so other subscribers see the change too.

Don't shortcut this by skipping the optimistic update. The latency feels broken without it.

**On conflict resolution.** The store does not arbitrate competing concurrent edits, by design. If two receptionists act on the same session at roughly the same time — receptionist A marks it complete locally, receptionist B's earlier "admit" broadcast arrives at A's client right after — the rule is **last write wins**, where "last" means "last broadcast applied to local state." Server-side, the database mutation that lands later wins; broadcasts are emitted in commit order; clients reconcile by replacing local state with whatever the most recent broadcast says. This means the optimistic UI on A's screen can transiently show a state that the server has already overwritten, and the next broadcast will correct it. We accept that. There is no version vector, no CRDT, no per-field merge.

What this means for contributors:

- Don't write code that assumes optimistic state is durable. The next broadcast might overwrite it.
- Don't write reconciliation logic that tries to merge local and remote state field by field. Replace local state with the broadcast payload.
- For mutations where conflict matters (concurrent payment captures, double-admits), the prevention happens at the database — unique constraints, conditional updates, idempotency keys — not in the client store.

## Polling fallback

Real-time connections drop. Networks die, browser tabs go to sleep, deploys restart sockets. The clinic store holds a connection status flag, and when the connection is "dropped" or "reconnecting," the store falls back to polling.

The fallback pattern:

- Detect connection drop via Socket.io's `disconnect` event.
- Show a "reconnecting" indicator in the UI (subtle, not alarming).
- Start a 30-second polling interval that re-fetches the affected data through the same API the initial load uses.
- When Socket.io reconnects, stop the polling interval, fetch one more time to catch any events missed during the outage, and resume real-time.

Polling is a fallback, not a primary mechanism. Don't add features that depend on polling working; assume real-time will recover.

## Patient-side state

Patient-side has no global store. The arrival flow (`entry-flow.tsx`) is a state machine in component state with no Zustand. The intake journey (`intake-journey.tsx`) is the same.

This is deliberate. Patient flows are short, linear, and per-visit. There is nothing to cache between visits, and the multi-step flow benefits from explicit local state over a global container.

The exception is the virtual waiting room, which connects to the same Socket.io server as the clinic side. It uses `presence:track` to register the patient's tab against a session id, and listens for `status_changed` to navigate to the call when the clinician admits. The subscription is owned by the waiting room component and tears down on unmount.

If you build a new patient-side surface and find yourself reaching for Zustand, stop and reconsider. The patient-side architecture is intentionally simple, and adding a global store on the patient side breaks that simplicity. Component state plus Socket.io listeners is the pattern.

## Common pitfalls

A short list of the most-likely-to-bite mistakes:

1. **Subscribing without keying the effect on the room/listener.** The subscription leaks across location switches and you get doubled events.
2. **Missing the cleanup.** Same problem at unmount. `socket.off(event, handler)` for every `socket.on(...)`.
3. **Reaching for `useRealtimeRunsheet` or `useRealtimeWaiting`.** They exist as vestigial Supabase Realtime hooks but nothing wires them up. Use Socket.io.
4. **Assuming multi-location notifications work today.** They don't (see the "selected location" section above). If you wire up tab/favicon hooks expecting cross-location signal, it won't fire.
5. **Mirroring Zustand data into component state.** State drifts; refetches stop propagating.
6. **Polling instead of real-time as a primary mechanism.** Polling is a fallback. If you find yourself adding a 30-second poll on a feature, the question is "why isn't this on Socket.io?"
7. **Forgetting that derived state isn't stored.** Filtering for "all late sessions" in SQL doesn't work; `late` is computed from `scheduled_at` and the current time.
8. **Adding a new per-feed room.** Don't fan out into `runsheet:{id}` / `readiness:{id}` / `payments:{id}` rooms; reuse `location:{id}` and add a new event name.
