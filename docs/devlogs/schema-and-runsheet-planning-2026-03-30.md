# Schema Deployment and Run Sheet Planning - 2026-03-30

## What was done

Deployed the full database schema to Supabase, configured all service credentials, wrote the run sheet feature spec, and produced a 12-phase implementation plan for the run sheet.

## Database Schema

Wrote and deployed `supabase/migrations/001_initial_schema.sql` against the hosted Supabase project.

**22 tables created:**
- Org hierarchy: organisations, locations, rooms
- Users: users (linked to auth.users), staff_assignments, clinician_room_assignments
- Patients: patients, patient_phone_numbers, payment_methods
- Scheduling: appointment_types, appointments
- Sessions: sessions, session_participants
- Payments: payments
- Workflows (Complete tier): workflow_templates, workflow_action_blocks, type_workflow_links, outcome_pathways, appointment_actions
- Forms (Complete tier): forms, form_fields, form_submissions

**12 enums**, **updated_at triggers** on all mutable tables, **RLS policies** (org-scoped via `public.user_org_ids()` helper function), **realtime publication** on sessions, session_participants, payments.

**Schema additions beyond the original CLAUDE.md data model:**
- `organisations.logo_url` — patient-facing branding in entry flow header
- `locations.qr_token` (unique, auto-generated) — for QR code check-in URLs
- `rooms.link_token` (unique, auto-generated) — for on-demand link URLs
- `sessions.entry_token` (unique, auto-generated) — for SMS link URLs
- `sessions.notification_sent`, `notification_sent_at`, `patient_arrived`, `patient_arrived_at`, `session_started_at`, `session_ended_at` — needed for derived state calculations
- `appointments.phone_number` — stores the receptionist's manual entry phone number before patient identity resolution
- `clinician_room_assignments` junction table — controls which rooms a clinician sees on their run sheet view

**Issues encountered during deployment:**
1. Expression indexes on `timestamptz::date` are not immutable in Postgres. Changed `(location_id, (scheduled_at::date))` to simple composite `(location_id, scheduled_at)`.
2. Supabase doesn't allow creating functions in the `auth` schema via migrations. Moved `user_org_ids()` and `user_location_ids()` from `auth` to `public` schema.

## Service Credentials Configured

All keys set in `.env.local`:
- **Supabase** — project URL, publishable key (anon), service role secret key
- **Stripe** — test mode publishable + secret keys (webhook secret still placeholder)
- **LiveKit** — websocket URL, API key, API secret

## Supabase CLI

Installed as dev dependency (`supabase@2.84.4`). Linked to the hosted project. Used `db push` and `db reset --linked` to deploy the migration cleanly.

## Run Sheet Spec

Wrote the full feature spec at `docs/specs/runsheet.md` (329 lines). Covers:
- Layout hierarchy (rooms → sessions, two-level)
- Session row columns (time, patient, status badge, modality, readiness, action)
- Derived display state calculation (9 states from 6 stored statuses)
- Room auto-expansion logic (collapsed → auto-expanded → fully expanded)
- Summary bar with informational counts and bulk action buttons
- Process flow slide-over (3-step: payment → outcome → done)
- Add session panel (create/edit, today/tomorrow, SMS timing)
- Background notifications (tab title flashing, favicon badge)
- Edge cases, accessibility, data requirements

## Run Sheet Implementation Plan

Produced a 12-phase implementation plan at `docs/plans/runsheet.md`. Phases:

1. **Data Layer** — types, queries, derived state, grouping, formatting (pure TS)
2. **Seed Data** — realistic day of sessions with relative timestamps
3. **Context Providers** — location/org/role hooks
4. **UI Primitives** — badge, button, skeleton, live clock, status/modality badges
5. **Session Row + Room Container** — core structural components
6. **Page Assembly** — first demo milestone: static run sheet with seed data
7. **Real-Time** — Supabase subscriptions, connection indicator, polling fallback
8. **Session Actions** — server actions with optimistic UI (including call dropdown for late patients)
9. **Process Flow** — 3-step slide-over panel
10. **Add Session Panel** — create + edit modes, plan tomorrow toggle
11. **Clinician View** — same components, filtered by role (zero new files)
12. **Background Notifications** — tab title flashing, favicon badge

~35 new files, ~8 modified. Phases 9-12 are independent of each other.

## CLAUDE.md Updates

- Added `logo_url`, `tier`, `qr_token`, `link_token`, `clinician_room_assignments` to data model section
- Added `entry_token`, `notification_sent`, `patient_arrived` to sessions description
- Added RLS/service-role note for patient-facing routes
- Added entry tokens documentation to Important Notes
- Fixed project structure: `checkin/[token]` → `entry/[token]`, `forms/[token]` → `form/[token]`
