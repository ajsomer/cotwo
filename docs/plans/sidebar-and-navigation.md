# Plan: Sidebar and Navigation

## Context

The clinic layout currently uses a thin top nav bar with "Coviu" branding and a location switcher. The updated CLAUDE.md specifies a fixed left sidebar with org branding, location switcher, role/tier-aware nav links, and a user section at the bottom. The `(admin)` route group is being consolidated into `(clinic)` under a `/settings` namespace.

The run sheet is implemented and functional. The sidebar is the shell that ties everything together — it's the frame around the run sheet and all future features.

### Current State

- **`(clinic)` route group**: has `layout.tsx` with `ClinicProviders`, a top nav bar, and pages for `runsheet`, `dashboard`, `readiness`, `payments`
- **`(admin)` route group**: separate layout (no providers), stub pages for `settings`, `workflows`, `forms`, `team`, `rooms`, `appointment-types`, `payments/settings`
- **Location switcher**: exists as a standalone component in the top nav
- **Context hooks**: `useLocation`, `useOrg`, `useRole` are wired up via `ClinicProviders`

### Target State

- One `(clinic)` route group with sidebar layout
- `(admin)` pages moved under `(clinic)/settings/*`, `(clinic)/workflows/*`, `(clinic)/forms/*`
- `(admin)` route group deleted
- `dashboard` and `payments` pages removed (dashboard is replaced by run sheet as the landing page; payments are handled in the process flow)
- Sidebar visible on all clinic-side pages
- Nav items filtered by role and tier

## Architecture

- **`sidebar.tsx`** is a client component (needs `useRole`, `useOrg`, `useLocation` for visibility logic)
- **`layout.tsx`** remains a server component for data fetching — passes data to `ClinicProviders`, which wraps sidebar + content
- The sidebar reads role/tier from context to determine which nav items to show
- Active route highlighting via `usePathname()`
- Mobile: deprioritised. Clinic-side is desktop-primary. If we get to it, sidebar hides behind a hamburger on narrow viewports. Not blocking.

## Phases

### Phase 1: Route Restructure

Move admin pages under `(clinic)` and clean up the old route group. No UI changes yet.

| # | File | Action |
|---|------|--------|
| 1 | `src/app/(clinic)/settings/page.tsx` | New — settings landing page (grid of 4 cards: Team, Rooms, Appointment Types, Payment Config) |
| 2 | `src/app/(clinic)/settings/team/page.tsx` | New — move from `(admin)/team` |
| 3 | `src/app/(clinic)/settings/rooms/page.tsx` | New — move from `(admin)/rooms` |
| 4 | `src/app/(clinic)/settings/appointment-types/page.tsx` | New — move from `(admin)/appointment-types` |
| 5 | `src/app/(clinic)/settings/payments/page.tsx` | New — move from `(admin)/payments/settings` |
| 6 | `src/app/(clinic)/workflows/page.tsx` | New — move from `(admin)/workflows` |
| 7 | `src/app/(clinic)/workflows/[id]/page.tsx` | New — move from `(admin)/workflows/[id]` |
| 8 | `src/app/(clinic)/forms/page.tsx` | New — move from `(admin)/forms` |
| 9 | `src/app/(clinic)/forms/[id]/page.tsx` | New — move from `(admin)/forms/[id]` |
| 10 | `src/app/(admin)/` | Delete — entire route group |
| 11 | `src/app/(clinic)/dashboard/page.tsx` | Delete — run sheet is the landing page |
| 12 | `src/app/(clinic)/payments/page.tsx` | Delete — payments handled in process flow |

### Phase 2: Sidebar Component

The core sidebar component with all nav items, visibility logic, and active state. Includes the dev-only user/role switcher.

| # | File | New/Modify |
|---|------|-----------|
| 13 | `src/components/clinic/sidebar.tsx` | New — full sidebar component |
| 14 | `src/components/clinic/sidebar-nav-item.tsx` | New — individual nav link with icon, label, active state |
| 15 | `src/components/clinic/sidebar-user-section.tsx` | New — bottom section: user name, role badge, sign out |
| 16 | `src/components/clinic/dev-role-switcher.tsx` | New — prominent dev-only switcher: Sarah/receptionist, Dr Smith/clinician, PM. Visible at bottom of sidebar in development only. Swaps role and userId in `ClinicProviders` so nav items and run sheet view update in real-time. |

**Sidebar structure (top to bottom):**

```
┌─────────────────────┐
│ [Logo] Org Name     │  ← org branding from context
│                     │
│ Location Switcher   │  ← existing component, restyled for sidebar
├─────────────────────┤
│ 📋 Run Sheet        │  ← all roles, all tiers
│ ✅ Readiness        │  ← receptionist + PM, Complete only
│ 🔄 Workflows        │  ← PM only, Complete only
│ 📝 Forms            │  ← PM only, Complete only
│ ⚙️  Settings         │  ← PM only, all tiers
├─────────────────────┤
│                     │  ← flex spacer
│ [DEV] Role Switcher │  ← development only, prominent
├─────────────────────┤
│ Sarah Mitchell      │
│ Receptionist        │
│ [Sign out]          │
└─────────────────────┘
```

**Nav item visibility rules:**

| Nav Item | Path | Roles | Tier |
|----------|------|-------|------|
| Run Sheet | `/runsheet` | `practice_manager`, `receptionist`, `clinician` | core, complete |
| Readiness | `/readiness` | `practice_manager`, `receptionist` | complete |
| Workflows | `/workflows` | `practice_manager` | complete |
| Forms | `/forms` | `practice_manager` | complete |
| Settings | `/settings` | `practice_manager` | core, complete |

**Icons**: Inline SVGs, consistent style: 20x20 viewBox, 1.5px stroke, `currentColor`, rounded line caps/joins. No icon library dependency.

**Dev role switcher**: Three buttons in a row — "Receptionist", "Clinician", "PM". Active role highlighted. Clicking swaps the role and userId in context. Wrapped in `process.env.NODE_ENV === 'development'` check so it never ships. Styled with a dashed amber border so it's obviously dev tooling, not product UI.

### Phase 3: Layout Integration + Run Sheet Header Adjustment

Replace the top nav bar with the sidebar layout. Also simplify the run sheet header since the sidebar now owns location context.

| # | File | New/Modify |
|---|------|-----------|
| 17 | `src/app/(clinic)/layout.tsx` | Modify — replace top nav with sidebar layout (sidebar left, content right) |
| 18 | `src/components/clinic/location-switcher.tsx` | Modify — restyle for sidebar (full-width select, appropriate sizing for 240px column) |
| 19 | `src/components/clinic/providers.tsx` | Modify — add `userName` to context, add `setRole`/`setUserId` for dev switcher |
| 20 | `src/components/clinic/runsheet-header.tsx` | Modify — remove location name (sidebar owns that now). Header becomes: "Run sheet" title, date, live clock, "+ Add session" button. |

**Layout structure:**

```
┌──────────┬──────────────────────────┐
│          │                          │
│ Sidebar  │   Content (children)     │
│ 240px    │   flex-1                 │
│ fixed    │   overflow-y-auto        │
│ h-screen │   h-screen              │
│          │                          │
└──────────┴──────────────────────────┘
```

### Phase 4: Redirect and Default Route

Make `/` redirect to `/runsheet`. The root `page.tsx` lives outside the `(clinic)` route group.

| # | File | New/Modify |
|---|------|-----------|
| 21 | `src/app/page.tsx` | Modify — redirect to `/runsheet` (for prototype; production would check auth and redirect to `/login` if unauthenticated) |

**Auth redirect note**: In production, the middleware layer (`src/middleware.ts`) would own the auth gate — unauthenticated users go to `/login`, authenticated users pass through. The root `page.tsx` redirect is a prototype shortcut. The middleware already calls `updateSession()` from Supabase; adding a redirect rule there is the production path. For now, the root page just does `redirect('/runsheet')`.

### ~~Phase 5: Mobile Sidebar~~ (Deprioritised)

Clinic-side is desktop-primary. Skipping for now. If needed later: hamburger toggle, overlay with backdrop, visible below `lg` breakpoint.

## Dependency Graph

```
Phase 1 (Routes) ── Phase 2 (Sidebar Component) ── Phase 3 (Layout + Header) ── Phase 4 (Redirects)
```

All phases are sequential.

## Key Design Decisions

- **One route group, not two**: The `(admin)` group has no independent layout needs — it shares the same sidebar, same providers, same location context. Separate groups just create confusion and duplicate layout logic.
- **Settings landing page as a card grid**: Team, Rooms, Appointment Types, Payment Config as four cards. Simple navigation to sub-pages. No over-engineering.
- **Sidebar is a client component**: It reads from three hooks (`useRole`, `useOrg`, `useLocation`) and uses `usePathname()` for active state. The layout server component fetches data and passes it down through `ClinicProviders`.
- **No collapsible sidebar**: For a desktop-primary clinic tool, a fixed 240px sidebar is fine. Collapsing adds complexity for no real gain.
- **Icons**: Inline SVGs, 20x20, 1.5px stroke, currentColor, rounded caps/joins. Five nav items don't justify a dependency.
- **Dev role switcher is prominent**: Dashed amber border, sits above the user section in the sidebar. Not buried in a console command or hidden menu. Swapping roles should be instant and visible.
- **Run sheet header simplified**: Location name removed from run sheet header — the sidebar's location switcher owns that context now. Avoids duplication.
- **Root redirect is a prototype shortcut**: Production auth gating belongs in middleware. The root `page.tsx` redirect is expedient for now.

## Verification

- **Phase 1**: `npm run build` passes. Old admin routes are gone. New routes under `(clinic)` resolve. `/settings` shows a 4-card grid.
- **Phase 3**: Navigate to `/runsheet` — sidebar visible on the left, run sheet in the content area. Active state highlights "Run Sheet". Click "Settings" — navigates to `/settings`. Run sheet header no longer shows location name.
- **Phase 3**: Use dev role switcher → clinician — only "Run Sheet" shows in sidebar, run sheet filters to assigned rooms. Switch to PM — all items show. Switch tier to core (would need a separate control) — Readiness, Workflows, Forms disappear.
- **Phase 4**: Navigate to `/` — redirects to `/runsheet`.

## Total New Files: ~8
## Total Modified Files: ~6
## Total Deleted Files/Dirs: ~12
