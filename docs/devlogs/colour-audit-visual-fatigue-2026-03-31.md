# Colour Audit — Reduce Visual Fatigue - 2026-03-31

## What was done

Applied the run sheet colour audit across 8 files. The goal: colour is a signal, not decoration. In a calm state the page is almost entirely neutral. When something goes wrong, the colour pops like a signal flare against the grey backdrop.

Zero new files. Zero new dependencies. Type-checks clean.

## Principle

The run sheet is a surface receptionists stare at for hours. Saturated colour is reserved for things that need action. Everything else is neutral. The visual hierarchy is: muted badges tell you what's happening, bold action buttons tell you what to do about it.

## Status Badges — Desaturated non-urgent states

**`src/components/ui/badge.tsx`** — Added 4 new muted badge variants alongside the existing bold ones:

| Variant | Style | Used for |
|---------|-------|----------|
| `amber-soft` | 8% opacity bg, 80% opacity text | Waiting, Checked in |
| `teal-muted` | 8% opacity bg, 70% opacity text | In session |
| `blue-muted` | 8% opacity bg, 70% opacity text | Complete |
| `gray-muted` | gray-100 bg, gray-500 text | Running over |

The bold variants (`red`, `amber`, `teal`, `blue`) are preserved for action buttons and urgent states.

**`src/lib/supabase/types.ts`** — Extended `StatusBadgeConfig.variant` union to include the new muted variants.

**`src/lib/runsheet/derived-state.ts`** — `getStatusBadgeConfig()` remapped:

| State | Before | After |
|-------|--------|-------|
| Late | `red` | `red` (unchanged — this is a fire) |
| Upcoming | `amber` | `amber` (unchanged — needs monitoring) |
| Waiting | `amber` | `amber-soft` (patient is here, no panic) |
| Checked in | `amber` | `amber-soft` (same rationale) |
| In session | `teal` | `teal-muted` (happening, nothing to do) |
| Running over | `teal` | `gray-muted` (informational only, not an emergency) |
| Complete | `blue` | `blue-muted` (needs processing but not urgent) |
| Queued | `gray` | `gray` (unchanged — already quiet) |
| Done | `faded` | `faded` (unchanged — already faded) |

## Modality Icons — Removed colour containers

**`src/components/clinic/modality-badge.tsx`** — The telehealth icon had a `bg-blue-500` rounded square container. The in-person icon had `bg-green-600`. Both added unnecessary colour to every single session row.

Replaced with bare icons: `text-gray-400`, `strokeWidth={1.75}`, no background container. The icons are still distinguishable by shape (Video vs User) without needing colour.

## Traffic Lights — Muted non-urgent dots

**`src/components/clinic/room-container.tsx`** — Three changes to the `TrafficLight` dots in room headers:

| Dot | Before | After |
|-----|--------|-------|
| Red (late) | `bg-red-500` | `bg-red-500` (unchanged — fires stay loud) |
| Amber (awareness) | `bg-amber-500` | `bg-amber-500/80` (slightly softer than action buttons) |
| Teal (active) | `bg-teal-500` | `bg-teal-500/60` (noticeably muted — active is fine) |
| Grey (total) | `bg-gray-500` | `bg-gray-500` (unchanged) |

## Action Buttons — Stay bold, properly typed

**`src/components/ui/button.tsx`** — Added `blue` variant (`bg-blue-500 text-white hover:bg-blue-500/90`) so Process buttons don't need inline className overrides.

**`src/components/clinic/action-button.tsx`** — Updated variant map: `blue` now maps to `"blue"` instead of `"primary"` (which was teal). Process buttons are now properly blue without any className hacks.

**`src/components/clinic/runsheet-header.tsx`** and **`src/components/clinic/summary-bar.tsx`** — Bulk process buttons changed from `variant="primary" className="bg-blue-500 hover:bg-blue-500/90"` to `variant="blue"`. Cleaner.

## Show All toggle

**`src/components/clinic/room-container.tsx`** — Changed from `text-teal-500` to `text-gray-500`. It's a toggle, not a call to action.

## The visual test

When all sessions are queued: grey badges, grey dots, grey icons, white rows. Calm.

When one patient goes late: a single red badge, a red Call button, and a red traffic light dot pop against the neutral backdrop. Nothing else competes.

## Files modified

| File | Change |
|------|--------|
| `src/components/ui/badge.tsx` | +4 muted variant styles |
| `src/components/ui/button.tsx` | +1 blue variant |
| `src/lib/supabase/types.ts` | Extended variant union |
| `src/lib/runsheet/derived-state.ts` | Remapped 5 badge configs to muted variants |
| `src/components/clinic/modality-badge.tsx` | Bare icons, no colour containers |
| `src/components/clinic/room-container.tsx` | Muted traffic lights, grey show-all toggle |
| `src/components/clinic/action-button.tsx` | Blue variant mapping |
| `src/components/clinic/runsheet-header.tsx` | Blue variant for bulk process |
| `src/components/clinic/summary-bar.tsx` | Blue variant for bulk process |
