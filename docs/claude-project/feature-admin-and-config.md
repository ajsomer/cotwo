# Feature: Admin and Config

The settings layer. Bundles team management, rooms, appointment types, payment configuration, and org branding into one doc because the individual settings pages are small and they all share the cascading-configuration pattern.

> **Split note:** if team management, appointment types, or workflow templates grow substantially (more configuration depth, more flow complexity, more cross-cutting concerns), this doc should be split. The current bundling is appropriate while each settings surface is essentially a CRUD list with light validation. Re-evaluate at the next major settings expansion.

---

## What's in Settings

Visible to Practice Managers and Clinic Owners only. The Settings sidebar item is hidden for Receptionists and Clinicians.

Four sub-pages today:

1. **Team** (`/settings/team`): manage staff (invite, edit role, deactivate). Shows the assigned location list per staff member.
2. **Rooms** (`/settings/rooms`): create, edit, delete rooms at the selected location. Manage clinician room assignments.
3. **Appointment types** (`/settings/appointment-types`): create, edit, delete appointment types. Link them to workflow templates (Complete only).
4. **Payments** (`/settings/payments`): Stripe Connect onboarding for the location, view connected accounts, set the routing model.

A **Branding** sub-page is intended (org logo, org name; the schema has `organisations.logo_url` ready) but is not yet built. The settings hub at `/settings` shows only the four cards above. If you need to set the logo today, do it directly via the database; the patient-facing header reads from `logo_url` already.

Settings on Core hides the workflow-template linking on appointment types (because the workflow engine doesn't exist on Core).

## Cascading configuration model

Configuration cascades top-down: organisation → location → clinician.

- **Organisation level** sets defaults: branding, payment routing model, tier, default appointment types, default workflow templates.
- **Location level** can override most org defaults. Has its own Stripe account if location-level routing is selected, its own rooms, its own staff assignments.
- **Clinician level** is preferences within whatever guardrails the org and location have set. Cannot override locked categories.

**Locked categories** (org-level only):

- **Payment routing model** (`stripe_routing`: `location` or `clinician`). Set once at org creation, locks the payment architecture for all locations and all clinicians. Can't be flipped without significant operational consequences (existing Stripe accounts would need to be migrated).
- **Branding** (logo, colours). Set at org level, used everywhere patient-facing.
- **Tier** (`core` / `complete`). Org-wide.

The cascade exists across all settings pages. Don't break it for convenience.

## Team management

Practice Managers and Clinic Owners can:

- Invite a new user via email. The invite creates a `users` row (or links an existing one) and a `staff_assignments` row at the chosen location with the chosen role.
- Edit a staff member's role at a location.
- Add a staff member to additional locations (creates additional `staff_assignments` rows).
- Remove a staff member from a location (deletes the `staff_assignments` row).
- Soft-deactivate a staff member (flag on the `users` row that hides them from the team list and prevents login).

For clinicians specifically: the team page surfaces a clinician's `clinician_room_assignments` so the admin can pick which rooms that clinician sees on their run sheet view. This sub-flow is shared with the Rooms page (you can also assign clinicians from a room's edit panel).

The clinic owner role is special: there can be only one per org. The team page does not let you create a second clinic owner. Transferring ownership is a not-yet-built flow.

## Rooms

The Rooms page lists rooms at the selected location and lets the admin:

- Create a room: name, room type (`clinical`, `reception`, `shared`, `triage`), payments enabled flag. The `link_token` is auto-generated.
- Edit a room: rename, change type, toggle payments.
- Delete a room: warns if there are active or future sessions linked.
- Manage clinician room assignments: which clinicians appear in this room on their run sheet view.

The "On-demand link" button on each room row copies the URL `/entry/{link_token}?room={slug}` to the clipboard. This is the URL the receptionist hands to a patient for an on-demand telehealth visit. See `feature-patient-entry-flow.md`.

## Appointment types

Appointment types are org-scoped (not location-scoped). They define:

- Name (e.g. "Initial consultation," "Follow-up").
- Modality (`telehealth` or `in_person`; in-person hidden on Core).
- Default fee in cents (`default_fee_cents`).
- Default duration in minutes.
- A reference to the linked workflow templates (Complete only, via `type_workflow_links`).
- A `pms_external_id` for sync mapping (Complete only, when PMS integration is wired up).

When an appointment of this type is created (manually or via PMS sync), the system reads the linked workflow templates and schedules the appropriate `appointment_actions`. See `feature-workflow-engine.md`.

The appointment type CRUD is straightforward; the linking sub-flow (which workflow template fires for which phase) is the substantive part on Complete.

## Payments configuration

The Payments settings page handles Stripe Connect onboarding and routing decisions.

Key flows:

- **Connect a Stripe account.** Initiates the Custom Connect OAuth flow with Stripe. The clinic's account ID is stored on the location (if `stripe_routing == 'location'`) or on the relevant `staff_assignments` row (if `stripe_routing == 'clinician'`).
- **View connected accounts.** The page lists which Stripe account each location or clinician is using and links to the Stripe dashboard for each.
- **Update routing model.** Changing routing is destructive (existing connected accounts may need re-onboarding). The UI warns appropriately.

Stripe is in **test mode** in the prototype. Connecting a Stripe account uses Stripe's test mode and no real money moves. See `conventions-prototype-vs-production.md`.

For the architectural detail of how routing decisions are made at payment time, see `feature-payments.md`.

## Branding

Intended to be org-level only, with a sub-page that lets the admin upload a logo and adjust the org name. The logo would be stored in Supabase Storage and the URL saved to `organisations.logo_url`. The patient-facing persistent header already reads `organisations.logo_url`, so once a value is in the database it shows up in the right places.

The sub-page UI is not yet built. The schema column exists. To set a logo today, write directly to `organisations.logo_url`.

There is no per-location branding override in the prototype. If a multi-location clinic needs different branding per site, that's a future enhancement.

## RLS and admin access

All Settings routes are gated server-side on role membership in the admin set (`practice_manager` or `clinic_owner`). The middleware does not enforce this beyond the basic auth gate; the page-level server components and the underlying API routes do the role check.

For mutations:

- Each route handler validates the user's role and the location they're assigned to.
- The mutation uses the user's session client (RLS-scoped) for ordinary writes.
- For setup-shaped operations (creating an org, etc.) the routes use the service-role client, but those are scoped to the setup flows, not to general admin operations.

If you add a new Settings page, follow the existing pattern: server-side role check, RLS-scoped mutations, no service-role for ordinary CRUD.

## Where to look

- **Settings layout:** `src/app/(clinic)/settings/layout.tsx`.
- **Settings pages:** `src/app/(clinic)/settings/team/page.tsx`, `rooms/page.tsx`, `appointment-types/page.tsx`, `payments/page.tsx`.
- **Team management components:** `src/components/clinic/team-*`.
- **Rooms management components:** `src/components/clinic/rooms-settings-shell.tsx` and friends.
- **Appointment type editor:** `src/components/clinic/appointment-type-editor.tsx`.
- **Stripe Connect setup:** `src/lib/stripe/connect.ts` and the `payments` Settings page.
- **Spec files:**
  - `docs/plans/settings-rooms.md`
  - `docs/plans/settings-payments.md`

## Related docs

- `feature-tiers-and-roles.md` for who can see Settings, and the cascading configuration framing.
- `feature-payments.md` for the runtime payment flow that Settings configures.
- `feature-workflow-engine.md` for the Complete-tier linking that appointment types do.
- `feature-runsheet.md` for what gets affected when rooms, types, or assignments change.
- `feature-auth-and-clinic-setup.md` for the initial creation that Settings later edits.
