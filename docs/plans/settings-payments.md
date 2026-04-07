# Plan: Settings — Payment Configuration

## Context

The settings hub at `/settings` links to a `/settings/payments` stub. The run sheet's Process flow handles day-to-day payment processing inline. What's missing is the configuration layer: how does a clinic set up *where* payments go and *which rooms* collect them?

### Current State

- **`/settings/payments`**: Stub page — just `<h1>Payment Settings</h1>`
- **`organisations.stripe_routing`**: Enum column (`'location'` | `'clinician'`), defaults to `'location'`
- **`locations.stripe_account_id`**: Nullable text, determines if payments are enabled at the location level
- **`staff_assignments.stripe_account_id`**: Nullable text, for per-clinician Stripe accounts
- **`rooms` table**: No `payments_enabled` column — payment eligibility is currently derived solely from `location.stripe_account_id`
- **Patient entry flow**: `payments_enabled` in `EntryContext` is set from `!!location.stripe_account_id`
- **Stripe lib**: `src/lib/stripe/connect.ts` is an empty stub. `src/lib/stripe/client.ts` exports the publishable key. Webhook handler returns `{ received: true }`.

### Target State

A two-tab payment settings page:

1. **Configuration tab** — routing mode toggle (clinic vs per-clinician) and Stripe Connect account management
2. **Rooms tab** — per-room toggle for whether payments are required

## Schema Changes

### New column on `rooms`

```sql
ALTER TABLE rooms ADD COLUMN payments_enabled BOOLEAN NOT NULL DEFAULT true;
```

Default `true` preserves current behaviour: if the location has a Stripe account, all rooms at that location collect payments. Toggling a room to `false` exempts it from card capture.

### No other schema changes

`organisations.stripe_routing`, `locations.stripe_account_id`, and `staff_assignments.stripe_account_id` already exist and are sufficient.

## Access Control

| Action | clinic_owner | practice_manager | clinician | receptionist |
|--------|:---:|:---:|:---:|:---:|
| View payment settings page | Yes | Yes | Per-clinician mode only | No |
| Toggle routing mode (clinic ↔ per-clinician) | Yes | Yes | No | No |
| Connect clinic-level Stripe account | Yes | Yes | No | No |
| Connect own clinician Stripe account | — | — | Yes | No |
| View all clinician connect statuses | Yes | Yes | No | No |
| Toggle room payment enablement | Yes | Yes | No | No |

Clinicians only see the Configuration tab (not Rooms), and only when routing is set to per-clinician. They see a single row — their own — with a connect/disconnect button.

Receptionists don't access this page at all (Settings is hidden from them in the sidebar).

## Architecture

### Page and layout

- **Server component** (`/settings/payments/page.tsx`): Thin wrapper rendering the client shell.
- **Client component** (`payments-settings-shell.tsx`): Two-tab layout. Reads `useLocation()` for selected location, `useOrg()` for tier and stripe_routing, `useRole()` for access gating. Lives in `src/components/clinic/`.

### API route

One route file: `src/app/api/settings/payments/route.ts`

**GET** `?location_id=xxx`
- Returns: `{ routing_mode, location_stripe_account_id, clinicians: [{ staff_assignment_id, user_id, full_name, stripe_account_id }] }`
- Clinicians array: all clinician + clinic_owner staff_assignments at this location, joined with `users` for names

**PATCH** — two mutation types distinguished by `action` field in body:

1. `{ action: 'set_routing', routing_mode: 'location' | 'clinician' }`
   - Updates `organisations.stripe_routing`
   - Only clinic_owner / practice_manager

2. `{ action: 'connect_account', target: 'location' | 'clinician', staff_assignment_id?: string, stripe_account_id: string }`
   - `target: 'location'`: writes to `locations.stripe_account_id`
   - `target: 'clinician'`: writes to `staff_assignments.stripe_account_id` for the given assignment
   - Clinicians can only update their own `staff_assignment_id`

3. `{ action: 'disconnect_account', target: 'location' | 'clinician', staff_assignment_id?: string }`
   - Sets the relevant `stripe_account_id` to `null`

### Room payments API

Extends the existing `src/app/api/settings/rooms/route.ts`:

**PATCH** — the existing room update handler already accepts partial updates. Add `payments_enabled` to the accepted fields. No new route needed.

### Patient entry flow update

In `src/components/patient/entry-flow.tsx` (or wherever `payments_enabled` is resolved), the check becomes:

```typescript
payments_enabled:
  room.payments_enabled &&
  (org.stripe_routing === 'location'
    ? !!location.stripe_account_id
    : !!clinician_stripe_account_id)
```

This is resolved server-side in the entry token resolution (the page.tsx that builds `EntryContext`).

## Tab 1: Configuration

### Routing Mode Section

**Heading**: "Payment routing"

**Segmented control** with two options:
- **Clinic** — "Payments for this location go to one bank account"
- **Per clinician** — "Each clinician connects their own Stripe account"

Shows the current `organisations.stripe_routing` value. On change, a confirmation dialog: "Change payment routing to [mode]? This affects where payments are directed for all locations." Confirm triggers PATCH with `action: 'set_routing'`.

Only visible to clinic_owner / practice_manager. Hidden entirely for clinicians.

### Stripe Connect Section

Renders differently based on routing mode:

**Clinic mode** (`stripe_routing === 'location'`):
- Single card showing the current location's Stripe connect status
- **Not connected**: "Connect Stripe" button, explanatory text: "Connect a Stripe account to accept payments at [Location Name]"
- **Connected**: Green status dot, account ID displayed (truncated), "Disconnect" button (with confirmation)
- Clinic_owner / practice_manager can connect/disconnect

**Per-clinician mode** (`stripe_routing === 'clinician'`):
- List of clinicians at the current location, each as a row:
  - Clinician name
  - Connect status: green dot + "Connected" or amber dot + "Not connected"
  - Connect/Disconnect button
- **Clinic_owner / practice_manager view**: See all clinicians, but buttons are disabled with tooltip "Each clinician must connect their own account"
- **Clinician view**: See only their own row with an active Connect/Disconnect button

### Stripe Connect Stub (Prototype)

Real Stripe Connect uses an OAuth redirect to Stripe's hosted onboarding. For the prototype:

- "Connect Stripe" button opens a simple confirmation dialog: "Connect test Stripe account?"
- On confirm, generates `acct_test_{crypto.randomUUID().slice(0, 8)}` and writes it to the DB
- "Disconnect" clears the `stripe_account_id` to `null`
- No real Stripe API calls

## Tab 2: Rooms

**Heading**: "Room payments"

**Description text**: "Choose which rooms require patients to provide a payment method during check-in."

**Room list**: All rooms at the current location, each as a row:
- Room name
- Room type badge (reuse existing badge component)
- Toggle switch for `payments_enabled`

Toggle change triggers PATCH to existing rooms API with `{ id, payments_enabled }`.

**Disabled state**: If the location has no Stripe account connected (in clinic mode) or no clinicians connected (in per-clinician mode), show an info banner: "Connect a Stripe account on the Configuration tab to enable payments." Toggles are visible but disabled.

Only visible to clinic_owner / practice_manager. Clinicians don't see this tab.

## Phases

### Phase 1: Schema Migration

| # | File | Action |
|---|------|--------|
| 1 | `supabase/migrations/NNN_room_payments.sql` | New — `ALTER TABLE rooms ADD COLUMN payments_enabled BOOLEAN NOT NULL DEFAULT true` |

### Phase 2: Payments API Route

| # | File | Action |
|---|------|--------|
| 2 | `src/app/api/settings/payments/route.ts` | New — GET and PATCH for routing mode + Stripe account management |

### Phase 3: Room API Update

| # | File | Action |
|---|------|--------|
| 3 | `src/app/api/settings/rooms/route.ts` | Modify — accept `payments_enabled` in PATCH handler |

### Phase 4: Configuration Tab UI

| # | File | Action |
|---|------|--------|
| 4 | `src/app/(clinic)/settings/payments/page.tsx` | Modify — render `PaymentsSettingsShell` |
| 5 | `src/components/clinic/payments-settings-shell.tsx` | New — two-tab layout, routing toggle, connect section |

### Phase 5: Rooms Tab UI

| # | File | Action |
|---|------|--------|
| 6 | `src/components/clinic/payments-settings-shell.tsx` | Continue — rooms tab with toggle list |

### Phase 6: Patient Entry Flow Update

| # | File | Action |
|---|------|--------|
| 7 | `src/app/(patient)/entry/[token]/page.tsx` | Modify — update `payments_enabled` resolution to check `room.payments_enabled` and routing mode |
| 8 | `src/lib/supabase/types.ts` | Modify — add `payments_enabled` to `Room` interface |

## Dependency Graph

```
Phase 1 (Schema) ── Phase 2 (Payments API) ── Phase 4 (Config Tab UI)
                 \                          \
                  ── Phase 3 (Room API)  ──── Phase 5 (Rooms Tab UI)
                                                        \
                                              Phase 6 (Entry Flow Update)
```

Phase 1 is prerequisite for everything. Phases 2+3 can run in parallel. Phases 4+5 can run in parallel after their API dependencies. Phase 6 comes last.

## Verification

**Configuration tab:**
- Navigate to `/settings/payments` — see two tabs: Configuration, Rooms
- Default routing mode is "Clinic" (from seed data)
- Click "Connect Stripe" — confirmation dialog — confirm — green "Connected" status with test account ID
- Click "Disconnect" — confirm — status reverts to "Not connected"
- Switch to "Per clinician" routing — confirmation dialog — confirm — clinician list appears
- Each clinician shows "Not connected"
- Switch dev role to clinician — see only own row with active Connect button
- Switch dev role back to practice_manager — see all clinicians, connect buttons disabled with tooltip

**Rooms tab:**
- See all rooms with toggle switches
- Toggle a room off — PATCH fires — toggle reflects new state
- Disconnect Stripe account on Configuration tab — info banner appears, toggles disabled
- Reconnect — toggles re-enable

**Patient entry flow:**
- With a room's `payments_enabled` toggled off: patient entry skips card capture step
- With room toggled on and Stripe connected: card capture step appears
- With room toggled on but Stripe disconnected: card capture skipped (no account to charge)

## Total New Files: 3
## Total Modified Files: 3
