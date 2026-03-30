# Initial Project Scaffolding - 2026-03-30

## What was done

Set up the complete project scaffolding for the Coviu platform redesign prototype. Starting from an empty directory (just CLAUDE.md), the full Next.js project structure is now in place and compiling.

## Tech decisions

- **Next.js 16.2.1** (latest via create-next-app) with App Router and TypeScript
- **Tailwind CSS v4** — generated with CSS-based config (`@theme inline` in globals.css) rather than the v3 `tailwind.config.ts` approach. Brand tokens are defined in `src/styles/globals.css`.
- **Inter + JetBrains Mono** loaded via `next/font/google` with CSS variables

## Project structure created

### Route groups and pages (19 skeleton pages)

- `(auth)` — login, signup (no group layout, uses root layout)
- `(clinic)` — dashboard, runsheet, readiness, payments (layout with sidebar placeholder)
- `(patient)` — entry/[token], form/[token], waiting/[token], pay/[token] (layout with 420px max-width mobile-first container)
- `(admin)` — settings, workflows, workflows/[id], forms, forms/[id], team, rooms, appointment-types, payments/settings (layout with sidebar placeholder)

### Route naming decisions

- **`entry/[token]` instead of `checkin/[token]`** — "entry" is the umbrella concept covering the full patient flow (primer, OTP, identity, card capture, outstanding items, arrive). "Check in" implies in-person only; "entry" is modality-neutral.
- **`form/[token]` instead of `forms/[token]`** — required to avoid an ambiguous route conflict with `(admin)/forms/[id]`. Next.js route groups are transparent to the router, so both resolved to `/forms/[param]`. Singular `form` disambiguates and reads naturally for a single form submission page.

### API routes (3 stubs)

- `POST /api/webhooks/stripe` — Stripe webhook handler
- `GET /api/cron/daily-scan` — morning scan (create sessions from appointments)
- `POST /api/pms/sync` — PMS sync endpoint (Cliniko adapter)

### Library stubs (10 files)

- `src/lib/supabase/` — client.ts (browser), server.ts (server), middleware.ts (session refresh), types.ts (DB types placeholder). Client and server stubs follow the official `@supabase/ssr` pattern so they're ready for real database queries.
- `src/lib/stripe/` — client.ts, connect.ts (empty placeholders)
- `src/lib/workflows/` — engine.ts, scanner.ts (empty placeholders)
- `src/lib/livekit/` — client.ts, tokens.ts (empty placeholders)

### Hooks (5 stubs)

- useRealtimeRunsheet, useRealtimeWaiting, useLocation, useOrg, useRole

### Middleware

- `src/middleware.ts` calls Supabase session refresh helper. Next.js 16 shows a deprecation warning (middleware -> proxy convention) but it works fine.

### Component directories

- `src/components/ui/`, `clinic/`, `patient/`, `admin/` with .gitkeep files

## Environment configuration

- `.env.local.example` — documented template with all required vars
- `.env.local` — real keys configured for Supabase, Stripe (test mode), and LiveKit
- `.gitignore` updated to properly handle env files (allows `.env.local.example` to be tracked)

## Dependencies installed

- `@supabase/ssr`, `@supabase/supabase-js` — database and auth
- `stripe`, `@stripe/stripe-js` — payments (server + client)
- `livekit-client`, `@livekit/components-react` — video

## CLAUDE.md updates

- Renamed `checkin/[token]` to `entry/[token]` in project structure
- Renamed `forms/[token]` to `form/[token]` in project structure

## Verification

- `npm run build` passes cleanly (20 routes generated)
- All static pages prerender successfully
- All dynamic routes ([token], [id]) compile as server-rendered on demand
- Initial git commit created on main branch
