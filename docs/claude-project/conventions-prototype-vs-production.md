# Conventions: Prototype vs Production

The most-referenced conventions doc in this set. The Coviu MVP is built to production standards but deployed as a prototype, which means contributors constantly need to know whether a given system is real, stubbed, or somewhere in between. This is the inventory.

The framing matters. "Prototype standards" does not mean "lower quality." It means certain integrations are deliberately replaced with stubs that have the same interface but a different implementation, so the product team can demo the experience without depending on third parties or paying for production-rate usage. The real implementation lands at engineering handoff. The architecture, the data model, and the security boundary are not stubbed; those are final.

If a contributor is unsure whether something is meant to be real or stubbed, this doc is the answer.

---

## What is real (and stays real)

These are not stubbed and never were. Treat them as production code; bugs here are real bugs, and changes need the same care as any production change.

**The data model.** The Postgres schema, the foreign-key chains, the constraints, the enums. The schema is final to the precision needed for the MVP, and migrations are tracked in `supabase/migrations/`. If you need to change the schema, write a migration; don't hand-edit the database.

**RLS policies.** Mandatory and never stubbed. Every clinic-side table has policies that scope reads and writes via `auth.uid()` against `staff_assignments`. Patient-facing routes use the service-role client to bypass RLS, but that bypass is the policy's intent (the entry token is the authorisation primitive for patient routes), not a workaround. RLS is the security boundary; weakening it for convenience is not acceptable.

**The auth chain.** `auth.users → users → staff_assignments → clinician_room_assignments`. The trigger that creates the `users` row on signup, the middleware that validates the JWT on every request, the progressive setup gate, the redirect rules. All real, all final.

**The Stripe integration code (mostly).** Stripe Connect is wired up against the *test mode* of the Stripe API. The OAuth dance to onboard a clinic, the payment intent flow, the routing logic between location-level and clinician-level Stripe accounts — all real. The webhook handler at `/api/webhooks/stripe` is the exception: it's a TODO stub that accepts the request and returns `{ received: true }` without verifying the signature or processing the event (see the stubbed list below). At handoff, the integration code stays; the webhook handler gets built; the API key flips from test to live.

**Real-time infrastructure.** Socket.io, the custom server, the room/event topology (`location:{id}` rooms with named events), the optimistic update pattern, the polling fallback. All real. The reconnection behaviour and the clean teardown on unmount are part of this; if any of those break, that's a real bug. The cross-location notification rule is the *intended* design but is not yet implemented — see `conventions-realtime-and-state.md`.

**Patient-side flows.** The arrival flow, the virtual waiting room, the intake package journey, the QR check-in. All real, all final. These are the surfaces real patients will see.

**Clinic-side flows.** The run sheet, the readiness dashboard, the workflow engine runtime, the process flow, the form builder. All real. Bugs in these surfaces are bugs.

**The component library.** Tailwind tokens, primitive components in `src/components/ui/`, the brand system. Real and final.

## What is stubbed (and gets swapped at handoff)

A short list of integrations that are deliberately fake and will be replaced before any real clinic uses the system. Don't try to fix the stubs to make them production-ready; the stubs are intentional placeholders.

### SMS provider (stubbed)

The SMS provider is pluggable behind a small interface (`src/lib/sms/*`). The active implementation in the prototype is a console logger that prints the SMS to the server log instead of sending. The interface is identical to the production-bound implementation (Vonage was the original target), so swapping is a one-line change in a factory.

**What this means in practice:**

- When the workflow engine fires an SMS action, the server console gets a line like `[WORKFLOW] intake_package: ... SMS to +614... : http://localhost:3000/intake/abc123`.
- The patient does not actually receive a text message. The link is real and works if you visit it manually.
- During development and demos, copy the link from the console to walk through the flow.
- This is *not* a bug. It is the entire point of the stub.

The phone OTP for the arrival flow is stubbed differently: instead of sending a real SMS, the OTP code is logged to the console (and shown in a debug overlay during development). The patient still goes through the OTP flow, they just need to read the code from the console rather than a text message.

### LiveKit (placeholder for proprietary video)

LiveKit is a fully functional real-time video service, and it works in the prototype. The reason it's listed here is that it is a *stand-in* for Coviu's own proprietary video platform, which is what production will eventually use.

**What this means:**

- Telehealth calls work end to end in the prototype using LiveKit's hosted service.
- The token-issuing code, room joining, participant management, all real.
- At handoff, the LiveKit-specific calls get swapped for calls to Coviu's video platform. The interface (start a call, generate a token, end a call) stays the same.

If you're working on the video flow, you can treat LiveKit as production-equivalent in the prototype. Just be aware that the production version uses different infrastructure.

### Stripe webhook handler (stubbed)

`/api/webhooks/stripe/route.ts` is a placeholder. The handler returns `{ received: true }` and does not verify the Stripe signature, parse the event payload, update any rows, or fan out broadcasts.

**What this means:**

- Webhook-driven state transitions don't happen in the prototype. The `payments` row reflects whatever the synchronous charge call returned at capture time; refunds, chargebacks, async payment intents, and webhook retries do not update the database.
- Demos and development don't depend on webhook delivery. The charge flow is synchronous and self-contained for the test cards we use.
- At handoff, this is the single biggest piece of real Stripe code that needs to be built. Signature verification, an idempotent event handler, and broadcasts (probably `payment_changed` events into the location room) are all production work.

This is the only Stripe-related stub. The rest of the integration is real (see "What is real" above).

### Email confirmation (disabled)

Supabase's email confirmation flow on signup is disabled in the project's Supabase configuration. New users sign up and are immediately authenticated, no confirmation email required.

**Why:** the prototype demo flow needs to walk a clinic from signup through setup to operation in one sitting. Waiting for an email confirmation breaks the demo.

**What changes at handoff:** email confirmation gets re-enabled in the Supabase dashboard. The signup code already handles the confirmation case correctly (it just doesn't trigger right now), so no code changes needed.

### Seed data and demo fixtures

The repo ships with a `supabase/seed.sql` and a set of seeded organisations, users, locations, rooms, appointments, workflows, and forms. This data is what populates a fresh demo environment.

**What this means:**

- Don't treat seed data as schema. It's content, regenerated whenever the seed script is rerun.
- Don't write feature code that depends on specific seed IDs. Seed UUIDs are not stable across regenerations (or shouldn't be assumed stable, anyway).
- For demos, you reset to seed state with the appropriate Supabase command. The sequence is documented in the repo's README.

### PMS sync (not yet built)

Cliniko is the first intended PMS integration. The schema has `pms_external_id` columns on `appointments` and `appointment_types`, an `appointment_type_source` enum (`coviu | pms`), and a stub route at `/api/pms/sync` that returns `{ synced: true }` without doing any work.

**What does *not* yet exist:**

- The adapter interface (no `src/lib/pms/` directory).
- Any Cliniko-specific code.
- A fixture set or stub adapter implementation.
- Read or write logic of any kind.

**What this means:**

- Complete-tier features that conceptually depend on PMS sync (run sheet integrated entry point, payment write-back, appointment sync) currently work against locally-created data only. There is no PMS in the loop.
- Demos that need pre-existing appointments use seed data, not synced data.
- "Implement PMS sync" is a real workstream at handoff, not a swap. The adapter interface gets designed, a Cliniko adapter gets written, and the sync route gets a real handler.

The seed data sets `tier = 'complete'` for the demo org and pretends PMS sync has populated appointments. That pretence is the only reason Complete-tier surfaces have anything to render.

## What is half-real

A category that catches people out: things that are real in implementation but limited in scope.

**Stripe (test mode).** The Stripe Connect integration runs against test keys, test accounts, and test cards. You can run a clinic through Connect OAuth, take a payment with a test card, and the database updates normally for the synchronous charge path. No actual money moves. At engineering handoff the keys swap to live; the integration code itself is production-shaped and doesn't change. The exception is the webhook handler, which is a TODO stub — see the stubbed list. So "half-real" describes the mode of the working integration, plus the absence of webhook-driven state transitions.

**The seed organisation tier flag.** The demo data sets `tier = 'complete'` for the demo org. This is real (the column exists, RLS policies and feature flags read it correctly), but it's not arrived at through a real upgrade flow; it's just set in seed. If the production build adds a billing-tier upgrade flow, that's new work, not a stub replacement.

**The deployment target.** The prototype runs locally via `npm run dev` or `npm start`. It does not deploy anywhere yet. Vercel was the original target but its serverless model does not support a long-lived custom server (which we need for Socket.io). The deployment story is deferred to engineering handoff. See `02-architecture.md`.

**Service-role usage in patient routes.** The pattern of using the service-role Supabase client in patient-facing API routes is *real and intentional* (RLS doesn't apply because patients aren't authenticated as Supabase users), but each patient-facing route bears the responsibility of validating the entry token before doing anything. Routes that skip token validation are bugs, not stubs. See `02-architecture.md` and `feature-patient-entry-flow.md`.

**Background jobs.** The morning scan that spawns sessions from appointments, the workflow scheduler that fires actions at their scheduled times, and similar periodic jobs run inside the Next.js server in the prototype. There is no Cron, no queue, no separate job runner. At handoff, these may need to move to a job queue depending on the scale and reliability requirements. The job logic is real; the orchestration is the prototype-shaped part.

## What gets swapped at handoff

A short summary of the work the production team picks up:

1. **Replace the SMS stub** with the real provider.
2. **Replace LiveKit** with Coviu's proprietary video platform.
3. **Switch Stripe to live mode** (config) *and* build out the webhook handler (currently a TODO stub).
4. **Re-enable email confirmation** in the Supabase project.
5. **Build out the real Cliniko integration** behind the PMS adapter interface (the adapter itself does not yet exist; see the PMS section).
6. **Decide on a deployment target** that supports the custom server model, or refactor the broadcast layer to fit a serverless host.
7. **Move background jobs** to a queue or Cron if needed for reliability.
8. **Build a comprehensive test suite.** The prototype has type checking and lint, no significant tests.
9. **Audit the service-role usage** in patient-facing routes and add monitoring to detect any RLS bypass that's not intended.
10. **Drop the vestigial `form_fields` table** when migration windows allow.
11. **Remove the dead Supabase Realtime hooks** (`useRealtimeRunsheet`, `useRealtimeWaiting`) or wire them up if a row-feed surface is genuinely needed.

## Non-negotiables

A few things contributors should not do, regardless of prototype status:

- **Don't weaken RLS to make a feature easier.** RLS is the security boundary, not a productivity drag.
- **Don't bypass auth in clinic-side code.** Service-role on the clinic side is reserved for narrow administrative operations (setup flows, system tasks). Feature code uses the user's session.
- **Don't log PHI in feature code.** Patient identifiers, names, dates of birth, phone numbers, form responses; none of these belong in `console.log` or in the runsheet event log. The SMS stub does log phone numbers to the server console because the alternative — a stub that doesn't tell you what it would have sent — would prevent the prototype from being usable for development and demos. That exception is scoped to the SMS stub and ends at handoff when the stub is replaced. It does not license feature code to log patient data anywhere else.
- **Don't commit secrets.** No Stripe live keys, no Supabase service role keys in source. The `.env` files are gitignored; keep it that way.
- **Don't add stubs without documenting them here.** If a new integration is stubbed, this doc grows. A stub that isn't tracked is a stub that ships to production.

## When you find something not in this doc

Either:

1. It is real, and you should treat it as production code.
2. It is stubbed but not documented, in which case this doc needs updating.

If the answer isn't obvious, ask before assuming.
