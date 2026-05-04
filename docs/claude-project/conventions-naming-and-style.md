# Conventions: Naming and Style

The rules of the road. Designed to be skimmed, not read end to end. If you're reaching for a convention and don't see it here, default to whatever is already in the codebase. These notes describe the conventions; the codebase enforces them.

---

## Database

- **Tables:** `snake_case`, plural. `appointments`, `session_participants`, `intake_package_journeys`.
- **Columns:** `snake_case`. `scheduled_at`, `org_id`, `is_primary`.
- **Enums:** `snake_case` for both type names and values. `session_status`, `appointment_modality`, `core`, `complete`.
- **Foreign keys:** `<referenced_table_singular>_id`. `appointment_id`, `room_id`, `org_id`.
- **Junction tables:** describe the relationship, not the alphabetical order. `session_participants` not `patient_sessions`. `clinician_room_assignments` not `room_clinicians`.
- **Booleans:** prefer `is_<adjective>` or `<verb>ed` form. `is_primary`, `is_default`, `notification_sent`, `patient_arrived`.
- **Timestamps:** all in UTC. Column suffix `_at` for moments, `_for` for scheduled times. `created_at`, `scheduled_for`, `fired_at`, `completed_at`.
- **Money:** integer cents in a column suffixed `_cents`. `amount_cents`, `default_fee_cents`. Display formatting happens in code.
- **Phone:** E.164 format in storage. `+61412345678`. Display formatting happens in code.

## TypeScript

- **Types and interfaces:** `PascalCase`. `Appointment`, `EntryContext`, `IntakeJourneyContext`.
- **Variables and functions:** `camelCase`. `patientId`, `getOutstandingJourneysForPatient`.
- **Constants:** `SCREAMING_SNAKE_CASE` only when truly constant at module scope. Otherwise `camelCase`.
- **Hooks:** `use<Thing>` prefix, always camelCase. `useRealtimeRunsheet`, `useLocation`, `useRole`.
- **Booleans:** mirror DB conventions where they cross. `isPrimary`, `notificationSent`.
- **Enums in TS:** prefer string union types over TS `enum`. The DB enum values are the source of truth; TS mirrors them as unions.

## Files and folders

- **Component files:** `kebab-case.tsx`. Every component file in `src/components` is kebab-case; the exported component name is still `PascalCase` inside the file. Don't introduce `PascalCase.tsx` for new files.
- **Utility / lib files:** `kebab-case.ts`. `derived-state.ts`, `resolve-journey.ts`.
- **Hook files:** `use<Thing>.ts` (no kebab). `useRealtimeRunsheet.ts`.
- **API routes:** Next.js App Router conventions. `route.ts` inside the URL-shaped folder. Folder names in URLs are `kebab-case`.

## React

- **Server components by default.** Reach for `"use client"` only when interactivity, real-time subscriptions, or browser-only APIs are needed. Server-side data fetching is preferred over client-side fetching in clinic-side surfaces.
- **Single source of truth.** A piece of state lives in one place: server fetch, Zustand store, or component state. Don't mirror server data into client state unless there's a real-time signal forcing it.
- **Client components fetch via API routes.** Server components fetch via the Supabase server client directly. Don't have client components import the server client.
- **Co-locate components with their feature.** `src/components/clinic/*`, `src/components/patient/*`, `src/components/ui/*` (shared primitives).
- **Avoid prop-drilling more than two levels.** Reach for context or the Zustand store.

## Comments

The default is no comments. The CLAUDE.md rule applies: only add a comment when the *why* is non-obvious. A hidden constraint, a subtle invariant, a workaround for a specific bug, behaviour that would surprise a reader. Don't explain *what* the code does (well-named identifiers do that). Don't reference the current task, fix, or callers ("used by X", "added for the Y flow", "handles issue #123"); those belong in commit messages and PR descriptions.

If you're tempted to write a multi-paragraph docstring, the function probably needs to be split.

## Display formatting

- **Times** in the user's timezone (the location's, not the browser's). Use `Intl.DateTimeFormat` with the location timezone explicit. Don't display naked UTC.
- **Currency** with the symbol. Australian dollars. `$120.00`, not `12000`, not `120 AUD`.
- **Phone numbers** in a humanised form. `0412 345 678` for AU mobiles, `+61 2 9876 5432` for landlines. Storage stays E.164.
- **Dates** in `Day, DD Mon YYYY` form. `Mon, 15 Apr 2026`.
- **Scheduled times on the run sheet** use JetBrains Mono. Everything else uses Inter.

## Brand tokens

`tailwind.config.ts` is the source of truth for the full token set; this section is a memorisation aid for the values that show up in every design discussion. If the values below ever drift from the config, the config wins — update this doc to match.

- **Teal 500** (`#2ABFBF`): primary brand colour, used for primary buttons and active states.
- **Amber 500** (`#D4882B`): accent / CTA, used sparingly for the things you want a user to act on.
- **Gray 50 to 800**: neutral palette. Page bg is `gray-50`, card bg is `gray-100`, borders are `gray-200`, secondary text is `gray-500`, primary text is `gray-800`.
- **Status colours**: red 500 (late / error), amber 500 (waiting / warning), teal 500 (in session / success), blue 500 (complete / info), green 500 (ready), faded variants for `done`.

Component patterns:

- **Cards**: white bg, 1px `gray-200` border, `rounded-xl`, subtle shadow on hover.
- **Primary buttons**: `teal-500` bg, white text, `rounded-lg`, hover `teal-600`.
- **Secondary buttons**: white bg, `gray-200` border, `gray-800` text.
- **CTA buttons**: `amber-500` bg, white text. Used sparingly.
- **Status badges**: rounded-full pills, colour-coded by status.
- **Form inputs**: white bg, `gray-200` border, `rounded-lg`, focus ring `teal-500`.

## Imports

- **Absolute imports via `@/`.** `import { foo } from '@/lib/foo'`. Configured in `tsconfig.json`.
- **No deep relative imports.** `../../../` is a smell; reach for the absolute alias.
- **Group imports**: external packages, then `@/` internals, then relatives. One blank line between groups.
- **Type-only imports** with `import type { ... }`. Helps the compiler tree-shake and signals intent.

## Error handling

- **User-facing errors** become toast notifications. Don't surface raw error messages or stack traces to the user.
- **Console logging** is fine for development debugging. The custom server already logs key events; don't add log spam in feature code.
- **Graceful degradation**: if real-time drops, show a "reconnecting" indicator and fall back to polling. Don't error the page.
- **Loading states** use skeletons, not spinners, for asynchronous content. Spinners are acceptable for short transient states (button submitting, etc).
- **Don't add error handling for impossible cases.** If a server query is RLS-scoped and the user can't reach the route without permission, you don't need a fallback for "what if the user isn't authorised." Trust the layer above.

## Testing

The prototype does not have a comprehensive test suite. Type checking and lint are the primary correctness signals, and manual end-to-end walkthroughs are the primary feature-correctness signal. Don't add tests speculatively. Wait for a bug, then add a regression test if it's clearly worth the maintenance cost.

This is deliberately a prototype-era policy. The engineering handoff includes "build out a proper test suite" as a major workstream.

## File-level structure

Most files in this codebase follow a predictable order:

1. `"use client"` directive (if applicable)
2. Imports
3. Type definitions
4. The exported component or function
5. Helpers (un-exported)

Helpers live below the consumer that uses them. If a helper is used by multiple consumers, lift it to a `lib/` file.
