# Feature: Tiers and Roles

The single source of truth for the Core vs Complete tier split and the four staff roles. Every feature in the codebase needs to be decided against both: which tier does it apply to, and which roles can see or perform it. Getting either wrong is a common failure mode.

This doc is the matrix you reach for when in doubt.

---

## The two tiers

**Core** is the day-of operations tier. Aimed at smaller clinics and practitioners who want digital front-door operations without committing to a PMS integration.

**Complete** is the full digital front door. PMS integration is a prerequisite, in-person modality and the workflow engine are the major adds.

Tier is set at the organisation level (`organisations.tier`) and applies to the entire org. An organisation can't have one location on Core and another on Complete; tier is org-wide.

## What's in each tier

### Core

- Telehealth modality only.
- Manual run sheet entry (no PMS sync).
- On-demand entry links (room link).
- Manual SMS-link sessions (run sheet entry tokens).
- Full run sheet with priority hierarchy, room expansion, bulk actions, and background notifications.
- Telehealth video (LiveKit in the prototype, Coviu's proprietary platform at handoff).
- Card capture and payments via Stripe Connect.
- One-shot pre-appointment SMS, fired when the receptionist saves the run sheet:

  > "You have an appointment at [Clinic] [tomorrow at Time / today at Time]. Tap here to get ready: [link]"

- Settings (team, rooms, appointment types, payment config, branding).

### Complete (everything in Core, plus)

- In-person modality (with QR code check-in).
- PMS integration (Cliniko first, adapter pattern for others).
- Bidirectional workflow engine (replaces the one-shot SMS with configurable timed actions across days or weeks).
- Form builder and form submissions.
- Intake automation (timed delivery, automated nudges, intake packages).
- Readiness dashboard ("Tasks" in the UI; the URL and code still say `readiness`).
- Post-appointment outcome pathways.
- Follow-up automation (PROMs, rebooking nudges, resources).
- AI scribe routing.

### What's deliberately *not* in Core

- No workflow engine. The one-shot SMS is the only timed automation.
- No forms. The form builder UI is hidden, form submissions don't exist.
- No readiness dashboard. The Tasks sidebar item is hidden.
- No in-person modality. The appointment type creator hides `in_person`.
- No QR code check-in. The location's `qr_token` may exist in the schema but the QR flow is gated.
- No post-appointment automation. Outcome pathway selection is hidden in the process flow.
- No PMS integration. Run sheet integrated entry point isn't available.
- No intake packages. The package action type is workflow-engine-only.

When you're building a feature and you're not sure whether it's Core or Complete, default to **Complete-only** unless the feature is part of the day-of operations spine (run sheet, payments, telehealth, identity verification, manual entry). Adding a Complete-only feature accidentally to Core is a regression; gating a Core feature on Complete-only infrastructure is a far worse one.

## The four roles

- **Clinic Owner.** First user to sign up. Counts as both a Practice Manager and a Clinician for permission purposes, plus carries account ownership (billing, subscription). Paid seat. One per organisation.
- **Practice Manager.** Non-clinical admin. Same admin permissions as Clinic Owner minus clinician capability and billing ownership. Free seat.
- **Receptionist.** Day-to-day operations. Run sheet, payments, outcome pathway selection. Cannot modify configuration.
- **Clinician.** Session-level access. Starts telehealth calls from the run sheet, sees their assigned rooms. Preference-level settings only.

## The "clinic_owner counts as both" rule

The single most important role-checking rule, and the one most often missed.

`clinic_owner` is a Practice Manager **and** a Clinician for permission purposes. Code that does this is wrong:

```ts
if (user.role === 'practice_manager') { /* show admin UI */ }
if (user.role === 'clinician') { /* show clinician UI */ }
```

The clinic owner is neither, by string match, but should see both. The correct check is membership in the appropriate role set:

```ts
const PRACTICE_MANAGER_ROLES = ['practice_manager', 'clinic_owner'];
const CLINICIAN_ROLES = ['clinician', 'clinic_owner'];
```

This shows up in:

- Sidebar visibility checks.
- Run sheet filtering (clinicians see their rooms; clinic owners see theirs too).
- Settings page access.
- Workflow / forms / readiness dashboard access.
- Action availability on session rows.

Search the codebase for any naked `=== 'practice_manager'` or `=== 'clinician'` and verify. If it should include `clinic_owner`, fix it.

## Role-by-tier visibility matrix

The sidebar items each role sees, by tier:

| Nav item     | Role               | Core | Complete |
|--------------|--------------------|------|----------|
| Run Sheet    | Clinician          | yes  | yes      |
| Run Sheet    | Receptionist       | yes  | yes      |
| Run Sheet    | Practice Manager   | yes  | yes      |
| Run Sheet    | Clinic Owner       | yes  | yes      |
| Tasks        | Clinician          | no   | no       |
| Tasks        | Receptionist       | no   | yes      |
| Tasks        | Practice Manager   | no   | yes      |
| Tasks        | Clinic Owner       | no   | yes      |
| Workflows    | Clinician          | no   | no       |
| Workflows    | Receptionist       | no   | no       |
| Workflows    | Practice Manager   | no   | yes      |
| Workflows    | Clinic Owner       | no   | yes      |
| Forms        | Clinician          | no   | no       |
| Forms        | Receptionist       | no   | no       |
| Forms        | Practice Manager   | no   | yes      |
| Forms        | Clinic Owner       | no   | yes      |
| Settings     | Clinician          | no   | no       |
| Settings     | Receptionist       | no   | no       |
| Settings     | Practice Manager   | yes  | yes      |
| Settings     | Clinic Owner       | yes  | yes      |

A few things to note about the matrix:

- "Tasks" is the recently-renamed sidebar label for the readiness dashboard. URL and code still use `readiness`. See `feature-readiness-dashboard.md`.
- Workflows and Forms are Complete-only AND admin-only. There's no view of them on Core for any role.
- Settings is admin-only on both tiers but the contents change. Core settings hide the workflow-engine-related sections.
- Run Sheet is the universal surface. Every role sees it, but the rendering varies (clinician filtering, no admin actions for non-admins).

## Action-level permissions

Sidebar visibility is the coarse layer. Within a feature, actions are role-gated too.

**Run Sheet:**

- Anyone can view (filtered).
- Receptionist, Practice Manager, Clinic Owner: bulk actions, "+ Add session," Plan Tomorrow.
- Clinicians: start/end call only. No bulk actions.
- Solo practitioners (Clinic Owner with no Receptionist): can process their own sessions through the standard Process flow.

**Tasks (Readiness):**

- Receptionist, Practice Manager, Clinic Owner: full access. Can add patients, mark transcribed, delete appointments.
- Clinicians: no access.

**Workflows:**

- Practice Manager, Clinic Owner: create, edit, delete templates and link them to appointment types.
- Others: no access.

**Forms:**

- Practice Manager, Clinic Owner: create, edit, delete forms; view submissions.
- Others: no access (form submissions are visible in the patient detail panel for all clinic-side roles, but the builder is admin-only).

**Settings:**

- Practice Manager, Clinic Owner: full access. Team management, rooms, appointment types, payment config, branding.
- Others: no access.

**Patient flows:**

- No staff roles apply. Patients use phone OTP per-visit.

## Cascading configuration

Configuration cascades top-down: organisation → location → clinician.

- **Organisation level** sets defaults: branding, payment routing model, tier, default appointment types, default workflow templates.
- **Location level** can override most org defaults. Has its own Stripe account if location-level routing is selected, its own rooms, its own staff assignments.
- **Clinician level** is preferences within whatever guardrails the org and location have set. Cannot override locked categories.

**Locked categories** (org-level only, cannot be overridden lower):

- **Payment routing model** (`stripe_routing`: `location` or `clinician`). Set once at org creation, locks the payment architecture for all locations and all clinicians.
- **Branding** (logo, colours). Set at org level, used everywhere patient-facing.
- **Tier** (`core` / `complete`). Org-wide.

Most other settings can override at lower levels (default appointment types, default workflow templates, room-specific configuration). Treat the cascade as the model and only break it for explicit reasons.

## Tier checks in code

Tier is read from `organisations.tier` and joined into the user's session context (org → location → staff_assignment chain). Once available, tier checks are simple string comparisons:

```ts
if (org.tier === 'complete') { /* show Complete-only feature */ }
```

But: the check needs to be *server-side* and *RLS-respected* for any feature that handles data. Hiding a sidebar link with a tier check on the client doesn't prevent an unauthorised request to the underlying API. Both layers need to gate.

The standard pattern (intended; see "current state" below):

1. Sidebar visibility: client-side check on the user's session context (cheap, prevents the feature appearing).
2. Page-level access: server-side check in the page's server component (refuse to render if tier doesn't allow).
3. API access: server-side check in the route handler (refuse to mutate if tier or role don't allow), backed by RLS where applicable.

**Current state (incomplete).** Layer 1 is done — the sidebar config in `src/components/clinic/sidebar.tsx` correctly hides Complete-only items from Core users and admin items from non-admins. Layers 2 and 3 are partial:

- The Complete-only pages (`/workflows`, `/forms`, `/readiness`) do not perform a server-side tier check. A Core-tier user who navigates to those URLs by hand will get the page rendered. The shells then load with whatever data the org has, which on a Core org is none, so the page is empty rather than functional — but the gate is not where it should be.
- Several API routes (notably under `/api/readiness/*`) don't perform a server-side role or tier check. They use the service-role client, which means RLS is not catching the gap either.

Treat this as a known gap, not a documented design. Don't write new clinic-side surfaces relying on layer 1 alone; add the server-side check on the page (and on the route handler if it mutates). When you touch one of the existing Complete-only pages or readiness API routes, adding the gate is a low-cost, high-value cleanup.

## Where to look

- **Sidebar configuration:** `src/components/clinic/sidebar.tsx`.
- **Role and tier hooks:** `src/hooks/useRole.ts`, `src/hooks/useOrg.ts`.
- **Tier and role enums:** `src/lib/supabase/types.ts` (generated from the schema).
- **Setup defaults per tier:** the seed and setup logic for new orgs.

## Related docs

- `00-product-overview.md` for the product framing of the tier split.
- `01-core-concepts.md` for the role definitions in narrative form.
- `feature-runsheet.md` for the role-by-role differences in the run sheet view.
- `feature-readiness-dashboard.md` for the Tasks sidebar item that's Complete-only.
- `feature-workflow-engine.md` and `feature-forms.md` (when written) for Complete-only feature areas.
- `feature-admin-and-config.md` for the Settings surfaces.
