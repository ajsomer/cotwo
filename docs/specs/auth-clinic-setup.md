# Auth & Clinic Setup

**Surface:** Auth & Clinic Setup (sign-up through to run sheet landing)
**Users:** Clinic owners (primary). The first user who creates the account.
**Available to:** All tiers. Prototype builds clinic path only.
**Real-time:** No. Sequential form submission.
**Priority:** Foundation feature. Must exist before any clinic-side surface works.

Auth and clinic setup is the entry point to the Coviu platform. A new user arrives, creates an account, sets up their clinic, and lands on the run sheet as an authenticated clinic owner with rooms ready to go.

This spec covers the prototype scope. The full onboarding from Layer 3 includes branching paths (individual vs clinic), PMS integration, Stripe Connect setup, and team invitations. For the prototype, we build the clinic owner path with the minimum steps needed to produce a real authenticated user inside a working clinic context.

> The goal is under two minutes from landing on the sign-up page to seeing the run sheet with rooms ready.

---

## Role Model

The Coviu role model has four roles. The first user who signs up always becomes the Clinic Owner. Additional team members are invited later with one of the other three roles.

| Role | Paid Seat | Admin Access | On Run Sheet | Description |
|------|-----------|--------------|--------------|-------------|
| Clinic Owner | Yes | Full | Yes (as clinician) | The person who created the account. A practising clinician who also owns and administers the clinic. Has all Practice Manager permissions plus account ownership. One per organisation. |
| Practice Manager | No (free) | Full | No | Operational admin. Configures workflows, forms, rooms, team. Same admin permissions as Clinic Owner but not a clinician. Not a paid seat. |
| Receptionist | No (free) | Operational only | Sees all rooms | Day-to-day operations. Run sheet, payments, outcome pathway selection. Cannot modify platform configuration. |
| Clinician | Yes | Preferences only | Assigned rooms only | Clinical consultation. Starts sessions from run sheet. Sees only assigned rooms at their location. |

### Clinic Owner vs Practice Manager

Clinic Owner and Practice Manager share the same admin permissions. The distinction is:

**Clinic Owner** is a practising clinician who owns the account. They are a paid seat because they appear on the run sheet and see patients. They are assigned to rooms. They have account-level privileges (billing, subscription management) that a Practice Manager does not.

**Practice Manager** is a non-clinical admin role. They have full platform configuration access but are not a clinician, do not appear on the run sheet as a provider, and are a free seat. A clinic might have a Clinic Owner (the lead clinician) and a Practice Manager (the operations person who runs the front desk and configuration).

A user holds one role. You cannot be both Clinic Owner and Practice Manager, as the permissions overlap entirely. The Clinic Owner role is the clinician version of Practice Manager.

### Permissions Matrix

| Capability | Clinic Owner | Practice Manager | Receptionist | Clinician |
|------------|-------------|-----------------|--------------|-----------|
| View run sheet | Yes (all rooms) | Yes (all rooms) | Yes (all rooms at location) | Yes (assigned rooms) |
| Add/edit sessions | Yes | Yes | Yes | No |
| Process sessions (payment + outcome) | Yes | Yes | Yes | No |
| Start telehealth calls | Yes (own sessions) | No | No | Yes (own sessions) |
| Configure rooms | Yes | Yes | No | No |
| Manage team (invite, roles) | Yes | Yes | No | No |
| Configure workflows and forms | Yes | Yes | No | No |
| Manage billing and subscription | Yes | No | No | No |
| View readiness dashboard | Yes | Yes | Yes | No |

---

## Prototype Scope

### What We Build

- **Sign up and log in.** Email and password via Supabase Auth.
- **Create your clinic.** Clinic name, address, optional logo. Creates both the organisation and location records in one step.
- **Create your rooms.** Room names, minimum one. Auto-assigns the Clinic Owner to the first room.
- **Landing.** Redirect to the run sheet as an authenticated Clinic Owner scoped to their clinic.
- **Login for returning users.** Email and password. Redirect to run sheet or resume incomplete setup.

### What We Cut

- **"For myself" individual contractor path.** Clinic owner path only.
- **Team invitations.** Seed receptionist and clinician users directly for demos.
- **Stripe Connect onboarding.** Stubbed. Configure later in Settings.
- **PMS integration step.** Complete tier onboarding. Not needed for prototype.
- **Free trial mechanics.** All prototype accounts are on a paid plan.
- **Magic link / passwordless auth.** Email and password is simpler for demos.
- **Multi-location setup.** Single location created automatically. Add locations later in Settings.

---

## The Flow

Three screens plus the landing. The user progresses linearly. No branching, no skipping. Each step creates database records that subsequent steps depend on.

### Screen 1: Sign Up

| | |
|---|---|
| **Route** | `/signup` |
| **Purpose** | Create a Supabase Auth account and a corresponding user record. |
| **Fields** | Full name (required), email address (required), password (required, min 8 characters), confirm password. |
| **Validation** | Email format. Password minimum 8 characters. Passwords must match. All fields required. |
| **Submit action** | 1. Call Supabase Auth `signUp()` with `{ email, password, options: { data: { full_name } } }`. 2. A database trigger on `auth.users` automatically creates the corresponding `users` record (see Auth Model). 3. Session is set immediately (email confirmation disabled for prototype). 4. Redirect to `/setup/clinic`. |
| **Error states** | Email already registered: show "Already have an account? Log in" link. Weak password: inline message. Network error: toast with retry. |
| **Layout** | Coviu logo centred above a card (max-width 440px). Form fields stacked. "Create account" primary button. "Already have an account? Log in" link below. |

The sign-up page is minimal. No marketing content, no feature tour. The user wants to get in and get set up.

#### Login Page

| | |
|---|---|
| **Route** | `/login` |
| **Purpose** | Authenticate a returning user. |
| **Fields** | Email, password. |
| **Submit action** | Supabase Auth `signInWithPassword()`. On success: if user has org with rooms, redirect to `/runsheet`. If user has org without rooms, redirect to `/setup/rooms`. If no org, redirect to `/setup/clinic`. |
| **Additional** | "Forgot password" link (Supabase Auth `resetPasswordForEmail()` — see Auth Callback Route below). "Create an account" link to `/signup`. |

### Screen 2: Create Your Clinic

| | |
|---|---|
| **Route** | `/setup/clinic` |
| **Purpose** | Create the organisation and its first location. The user becomes the Clinic Owner. |
| **Fields** | Clinic name (required), clinic address (required, free text), logo upload (optional, PNG/JPG, max 2MB). |
| **What happens** | 1. Create `organisations` record (name, slug auto-generated from name, logo_url if uploaded, tier = core). 2. Create `locations` record with the same name, the address, and a generated `qr_token`. 3. Create `staff_assignments` record linking user to location with role = clinic_owner, employment_type = full_time. 4. Redirect to `/setup/rooms`. |
| **Logo handling** | Upload to Supabase Storage (org-logos bucket). Store public URL in `organisations.logo_url`. Placeholder with clinic initial updates live as user types. |
| **Step indicator** | Top of page: Clinic (active) > Rooms. Two steps. Current step highlighted in teal. |

Organisation and location are created as a single action from the user's perspective. The user fills in their clinic name and address. Behind the scenes, both an organisation record and a location record are created. The location inherits the clinic name. The user never sees the word "location" during setup.

This keeps the data model clean for future multi-location support. When the clinic grows and adds a second site, a new location is created under the same organisation. No migration, no restructuring.

### Screen 3: Create Your Rooms

| | |
|---|---|
| **Route** | `/setup/rooms` |
| **Purpose** | Create rooms at the location. Rooms are the organisational containers on the run sheet. |
| **Fields** | Room name (required). Repeated row pattern for multiple rooms. |
| **Minimum** | One room required to proceed. |
| **Default state** | One pre-filled room row: "[User Name]'s Room". Editable. "+ Add another room" below. |
| **Auto-assign** | Clinic Owner automatically assigned to the first room via `clinician_room_assignments`. They land on the run sheet with their room visible and ready. |
| **Submit action** | 1. Create `rooms` records (name, link_token, location_id, sort_order). 2. Create `clinician_room_assignments` for Clinic Owner and first room. 3. Redirect to `/runsheet`. |
| **Room guidance** | Help text: "Rooms group sessions on your run sheet. Common setups: one room per clinician, a shared room for rotating staff, or an on-demand room for walk-ins. You can change this later in Settings." |
| **Step indicator** | Clinic (complete, green tick) > Rooms (active). |

Each room row has a text input for the name and a delete button (disabled when only one remains). "+ Add another room" appends a new empty row. Enter in the last input adds a new row and focuses it.

The room creation step is deliberately lightweight. No clinician assignment beyond the auto-assign for the owner (team members are not invited yet). No room type selection. Just names. Refinement happens later in Settings > Rooms.

### Screen 4: Landing on the Run Sheet

| | |
|---|---|
| **Route** | `/runsheet` |
| **Purpose** | The user's first view of their operational dashboard. |
| **State** | Run sheet loads with the clinic's location context. Rooms visible but empty. Sidebar present with Clinic Owner navigation. |
| **First-run hint** | Empty state: "Your clinic is set up. Click + Add session to schedule your first patient." Dismisses after the first session is created. |
| **Sidebar** | Org name and logo in header. Location name in switcher (single, no dropdown). User name and "Clinic Owner" role badge at bottom. |
| **Auto-assigned room** | Clinic Owner's room visible and expanded (empty). Additional rooms collapsed. |

> This is the moment the platform feels real. Zero to a configured clinic in under two minutes. Everything downstream works from this point.

---

## Auth Model

The auth model connects Supabase Auth (credentials, sessions, JWTs) to the Coviu data model (roles, locations, permissions).

### Relationship Chain

**auth.users** (Supabase) → **users** (profile, `users.id = auth.users.id`) → **staff_assignments** (role, location) → **clinician_room_assignments** (room access)

The `users.id` column IS the `auth.users.id` UUID. No separate `auth_id` column. This means `auth.uid()` in RLS policies matches `users.id` directly — no joins needed for permission checks.

| Table | Key Fields | Created At |
|-------|------------|------------|
| `auth.users` | id (UUID), email, encrypted_password | Screen 1: Sign Up |
| `users` | id (= auth.users.id), full_name, email | Screen 1: Sign Up (via DB trigger) |
| `organisations` | id, name, slug, logo_url, tier | Screen 2: Create Clinic |
| `locations` | id, org_id, name, address, qr_token | Screen 2: Create Clinic (same step) |
| `staff_assignments` | id, user_id, location_id, role, employment_type | Screen 2: Create Clinic |
| `rooms` | id, location_id, name, link_token, sort_order | Screen 3: Create Rooms |
| `clinician_room_assignments` | id, staff_assignment_id, room_id | Screen 3: Create Rooms |

Note: `staff_assignments` has no `org_id` column. The org is derived via `locations.org_id`. All queries that need the org join through `locations`.

### User Record Creation (Database Trigger)

The `users` record is created automatically by a database trigger on `auth.users` insert. The `signUp()` call passes `full_name` in `options.data`, which Supabase stores in `auth.users.raw_user_meta_data`. The trigger reads it from there.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

This is the Supabase-recommended pattern. The trigger runs with `SECURITY DEFINER` so it has permission to insert into `public.users` regardless of RLS. If the trigger fails, the sign-up fails — test thoroughly.

### FK Reinstatement

The foreign key between `users.id` and `auth.users.id` was removed during early prototyping (migration 002) to allow seed data with fake UUIDs. This spec reinstates it. The sign-up flow creates real `auth.users` records via the trigger, so the FK constraint is now safe to enforce.

**Migration:** `ALTER TABLE users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)`. Existing seed data with fake IDs must be cleaned up or recreated via Supabase Admin API.

### Role Enum Update

**Migration:** `ALTER TYPE user_role ADD VALUE 'clinic_owner'`. Existing values: practice_manager, receptionist, clinician. Application code treats clinic_owner as having all practice_manager permissions plus clinician capabilities and account ownership.

### Prototype Prerequisite: Disable Email Confirmation

Supabase requires email confirmation by default. With it enabled, `signUp()` returns the user UUID but no session — the user cannot proceed until clicking a confirmation link in their email.

**For the prototype, disable email confirmation:** Supabase Dashboard > Authentication > Providers > Email > toggle off "Confirm email". This allows `signUp()` to return a session immediately, enabling the seamless sign-up-to-setup flow.

Production will re-enable email confirmation and add the confirmation redirect handling.

### Auth Callback Route

Password reset (and future email confirmation) uses the PKCE flow. Supabase sends an email with a link containing a `token_hash`. The callback route exchanges this for a session.

| | |
|---|---|
| **Route** | `/auth/callback` |
| **Purpose** | Exchange auth tokens from email links (password reset, future email confirmation). |
| **How it works** | 1. Supabase email link redirects to `/auth/callback?token_hash=...&type=recovery`. 2. Route calls `supabase.auth.verifyOtp({ token_hash, type })` to exchange for a session. 3. On success: redirect to `/auth/reset-password` (for recovery) or `/runsheet` (for email confirmation). |

The `resetPasswordForEmail()` call specifies `redirectTo: '/auth/callback'`. The callback route must be registered in the Supabase Dashboard under Authentication > URL Configuration > Redirect URLs.

**Reset password page** (`/auth/reset-password`): Simple form with new password + confirm password. Calls `supabase.auth.updateUser({ password })`. Redirects to `/runsheet` on success.

---

## Session and Middleware

Supabase Auth manages the session via cookies (set by `@supabase/ssr`). The Next.js middleware refreshes the session on every request (via `supabase.auth.getUser()`, which validates the JWT server-side) and enforces a progressive gate.

### Route Protection

| Route Pattern | Auth Required | Setup State | Behaviour |
|---------------|---------------|-------------|-----------|
| `/signup`, `/login` | No | Any | If authenticated with complete setup, redirect to `/runsheet` |
| `/auth/callback` | No | Any | Token exchange only. Redirects based on token type. |
| `/auth/reset-password` | Yes | Any | Must have active session (set by callback). |
| `/setup/clinic` | Yes | No org | If org exists, redirect to `/setup/rooms` or `/runsheet` |
| `/setup/rooms` | Yes | Has org, no rooms | If rooms exist, redirect to `/runsheet` |
| `/runsheet` | Yes | Complete | Full auth + setup required |
| `/readiness` | Yes | Complete | Receptionist, PM, or Clinic Owner |
| `/workflows`, `/forms` | Yes | Complete | PM or Clinic Owner only |
| `/settings/*` | Yes | Complete | PM or Clinic Owner only |
| `/entry/*`, `/waiting/*` | No | N/A | Patient-facing, token-based access |

### Progressive Gate Logic

The middleware creates a chain of prerequisites. If a user abandons setup, they resume where they left off on next login.

- **No auth session:** Redirect to `/login`. Patient-facing routes exempt.
- **Authenticated, no org:** Redirect to `/setup/clinic`.
- **Authenticated, has org, no rooms:** Redirect to `/setup/rooms`.
- **Authenticated, complete setup:** Allow access to clinic routes. Resolve role and location context.
- **Authenticated, visits /login or /signup:** Redirect to `/runsheet` (or appropriate setup step).

### User Context Resolution

After auth and setup are confirmed, the middleware resolves the user's full context for all clinic-side pages.

| | |
|---|---|
| **User context** | user_id, full_name, email, org_id, org_name, org_logo_url, role |
| **Location context** | location_id (selected), location_name, all_assigned_location_ids |
| **Room context** | Clinic Owner/clinician: assigned_room_ids via clinician_room_assignments. Receptionist/PM: all rooms at selected location. |

```sql
SELECT sa.role, sa.location_id,
       l.org_id, o.name AS org_name, o.logo_url,
       l.name AS location_name
FROM staff_assignments sa
JOIN locations l ON sa.location_id = l.id
JOIN organisations o ON l.org_id = o.id
WHERE sa.user_id = :user_id
```

---

## Components

### Auth Pages Layout (/login, /signup)

| | |
|---|---|
| **Header** | Coviu logo centred. |
| **Content** | Centred card (max-width 440px). White background, 1px border #E2E1DE, 16px radius, 32px padding. |
| **Below card** | "Already have an account? Log in" or "Need an account? Sign up". |
| **Background** | #F8F8F6. |
| **Mobile** | Card fills width with 16px horizontal padding. |

### Setup Layout (/setup/*)

| | |
|---|---|
| **Header** | Coviu logo (top-left). Step indicator (top-centre). |
| **Step indicator** | Two steps: Clinic > Rooms. Active step in teal (#2ABFBF). Complete steps green tick (#1D9E75). Future steps grey (#8A8985). |
| **Content** | Centred card (max-width 520px). Same card styling as auth pages. |
| **Footer** | Minimal. Optional "Need help?" link. |
| **Mobile** | Card fills width with 16px padding. Step indicator scales. |

### Form Components

| Component | Spec |
|-----------|------|
| Text input | Full-width. 44px height. 14px font. Border #E2E1DE, focus border teal. Label above. |
| Password input | Same as text with show/hide toggle (eye icon). |
| File upload | Drag-and-drop zone or click to browse. Preview on upload. "Remove" to clear. PNG/JPG, max 2MB. |
| Primary button | Full-width. Teal bg (#2ABFBF). White text. 44px height. 600 weight. Disabled: reduced opacity. |
| Secondary link | Teal text. Underline on hover. |
| Error message | Red (#E24B4A) below the field. Appears on blur or submit. |
| Loading state | Button shows spinner, form fields disable during submission. |

### Room Row Component

| | |
|---|---|
| **Layout** | Text input (name, flex-grow) + delete button (icon, right). 8px gap between rows. |
| **First room** | Pre-filled: "[User Name]'s Room". Delete disabled (min one room). |
| **Additional rooms** | Empty input. Delete enabled. |
| **"+ Add another room"** | Teal text button below last row. Appends empty row. |
| **Keyboard** | Enter in last row adds new row and focuses it. Tab moves between rows. |
| **Validation** | All rooms must have non-empty name on submit. Empty names get red border. |

---

## Data Requirements

### Schema Changes

- **Role enum:** Add `clinic_owner` to `user_role` enum.
- **FK reinstatement:** Add `FOREIGN KEY (id) REFERENCES auth.users(id)` on `users` table (restoring the constraint dropped in migration 002).
- **DB trigger:** Create `handle_new_user()` trigger on `auth.users` to auto-create `users` records on sign-up.
- **Supabase Storage:** Create `org-logos` bucket for logo uploads. Public read access.
- **No new tables.** All tables already exist in the schema.

### Create Clinic Transaction

Screen 2 creates multiple records atomically. If any insert fails, the entire operation rolls back.

**Step 1:** `INSERT INTO organisations (name, slug, logo_url, tier) VALUES (:name, :slug, :logo_url, 'core') RETURNING id`

Slug is auto-generated from the clinic name: lowercase, spaces to hyphens, strip non-alphanumeric, append random suffix if collision (e.g. "Bondi Health" → `bondi-health`, or `bondi-health-3f2a` on collision).

**Step 2:** `INSERT INTO locations (org_id, name, address, qr_token) VALUES (:org_id, :name, :address, gen_random_uuid()::text) RETURNING id`

**Step 3:** `INSERT INTO staff_assignments (user_id, location_id, role, employment_type) VALUES (:user_id, :location_id, 'clinic_owner', 'full_time')`

### Create Rooms Transaction

**Step 1:** `INSERT INTO rooms (location_id, name, link_token, sort_order)` for each room. `RETURNING id` for the first room.

**Step 2:** `INSERT INTO clinician_room_assignments (staff_assignment_id, room_id)` for the Clinic Owner and the first room.

### Seed Data for Demos

Team invitations are cut from the prototype. Demo users are seeded via Supabase Admin API to create real `auth.users` records.

- **Demo Receptionist:** Auth user + users record + staff_assignments (role = receptionist) at the same org and location.
- **Demo Clinician:** Auth user + users record + staff_assignments (role = clinician) + clinician_room_assignments for assigned room(s).
- **Demo Practice Manager:** Auth user + users record + staff_assignments (role = practice_manager).

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Email already registered | Supabase Auth error. Show "Already have an account?" with login link. |
| User closes browser mid-setup | Login redirects to next incomplete step via progressive gate. |
| User navigates to /runsheet before rooms exist | Middleware redirects to /setup/rooms. |
| User visits /setup/clinic with existing org | Redirect to /setup/rooms (no rooms) or /runsheet (complete). |
| Logo upload fails | Inline error. Logo is optional; user can proceed without it. |
| Duplicate room names | Allowed. Names need not be unique. |
| All room rows deleted | Validation prevents submit: "At least one room is required." |
| Duplicate org names | Allowed. Different clinics can share a name. |
| Location insert fails in create clinic | Transaction rolls back. Org not created. User retries. |
| Auth session expires during setup | Next action redirects to /login. Setup resumes after re-login. |

---

## Accessibility

- **Keyboard navigation:** Tab through all fields. Enter submits. Escape closes modals. Room rows navigable via Tab and Enter.
- **Focus management:** After redirect, focus moves to first input on the new screen.
- **Error announcement:** Validation errors use aria-describedby. Screen readers announce on appearance.
- **Form labels:** All inputs have visible labels. Placeholders are supplementary.
- **Step indicator:** `aria-current="step"` on active step. Completed steps announced as "complete".
- **Logo upload:** Drop zone has `role="button"` with aria-label. Status announced via aria-live.
- **Colour contrast:** All text meets WCAG AA. Error red on white passes. Teal used for interactive elements, not meaning-only text.

---

## Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| First user role | Clinic Owner (always) | A practising clinician who owns the clinic. Paid seat. Full admin plus clinician. |
| Clinic Owner vs PM | Same admin, different seat type | Owner is a clinician (paid). PM is non-clinical (free). One role per user. |
| Org + location setup | Collapsed into one screen | User enters clinic name and address. Both records created behind the scenes. User never sees "location." |
| Schema approach | Keep org and location separate | UX is simplified, not the data model. Multi-location is additive later. |
| Room auto-assign | Owner assigned to first room | Solo practitioner lands on run sheet ready. No extra config. |
| Auth method | Email and password (prototype) | Simplest for demo and testing. Magic link is future. |
| Setup resumption | Progressive middleware gate | Each step is a prerequisite. Abandoned setup resumes on login. |
| Team invites | Deferred (seed for demos) | Prototype scope. Seed users via Supabase Admin API. |
| FK reinstatement | Yes, with this feature | Real auth.users records. FK constraint is safe to enforce. |
| Role enum | Add clinic_owner | New value. Treated as PM + clinician + account owner in app code. |
| User record creation | DB trigger on auth.users | Supabase-recommended. No orphaned auth users. Trigger pulls full_name from raw_user_meta_data. |
| Email confirmation | Disabled for prototype | Enables seamless sign-up-to-setup flow. Re-enable for production. |
| users.id strategy | users.id = auth.users.id (no separate auth_id) | RLS policies already use auth.uid() = users.id. Simpler, no joins for permission checks. |
| Org slug | Auto-generated from clinic name | Required NOT NULL UNIQUE column. User never sees it. Random suffix on collision. |
