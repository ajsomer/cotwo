# Plan: Run Sheet Visual Refinements

## Context

The run sheet is functional but needs visual polish for scannability and density. Three areas: session rows, room headers, and the sidebar user section.

### Current State

- **Session rows**: Grid layout with time, patient name, status badge, modality pill badge (TH/IP), readiness text ("Ready"/"No card"), action button. Background tinting already implemented in `getRowBackground()`. Padding is `py-2.5`.
- **Modality badge**: Coloured pill badges ("TH" teal, "IP" gray) via `ModalityBadge` component using the `Badge` UI primitive.
- **Readiness**: Text labels ("Ready" in green, "No card" in amber) computed inline in `SessionRow`.
- **Room headers**: Room name + chevron + status count badges. No action icons. Clinician name already removed.
- **Room ordering**: Currently sorted by highest-priority session first, then `sort_order` as tiebreaker.
- **Sidebar user section**: Name, role, and "Sign out" stacked vertically on separate lines.
- **`RoomGroup` type**: Does not carry `link_token` — needed for copy link functionality.

### Target State

- Dense, scannable session rows with quiet icon cluster replacing text badges
- Room headers with hover-reveal action icons (settings, send link, copy link)
- Rooms ordered by `sort_order` (stable positioning), not by priority state
- Sidebar user section with sign out inline

## Files to Change

| # | File | Action | What |
|---|------|--------|------|
| 1 | `src/components/clinic/session-row.tsx` | Modify | Replace modality pill and readiness text with icon cluster, tighten to py-2, reorder right-side zones |
| 2 | `src/components/clinic/modality-badge.tsx` | Modify | Replace pill badges with quiet 16px stroke icons |
| 3 | `src/components/clinic/room-container.tsx` | Modify | Add hover-reveal action icons (settings, send link, copy link), pass link_token |
| 4 | `src/lib/runsheet/grouping.ts` | Modify | Change room sort to use `sort_order` only (not priority). Add `link_token` to `RoomGroup` construction |
| 5 | `src/lib/supabase/types.ts` | Modify | Add `link_token` to `RoomGroup` interface |
| 6 | `src/components/clinic/sidebar-user-section.tsx` | Modify | Move sign out inline with user name |

## Phases

### Phase 1: Session Row Visual Refinements

| File | Changes |
|------|---------|
| `src/components/clinic/modality-badge.tsx` | Replace `Badge` pills with inline SVG icons. Telehealth: video camera icon (16px, gray-400, stroke). In-person: building icon (16px, gray-400, stroke). Add `title` attribute for tooltip. |
| `src/components/clinic/session-row.tsx` | (1) Replace readiness text with icon cluster: card icon (green-500 if card on file, amber-500 with slash if not), optional document icon (amber-500) for forms. (2) Reorder right side: status badge → icon cluster (modality + readiness) → action button with 12px gaps. (3) Reduce padding to `py-2`. (4) Background tinting already in place — verify `done` rows apply `opacity-40` on content, not just the row wrapper. |

**Row right-side layout**: `StatusBadge` | gap-3 | `[modality icon] [card icon] [forms icon?]` | gap-3 | `ActionButton`

**Icon cluster details**:
- Modality: 16px, gray-400, stroke style. Video camera (telehealth) or building (in-person).
- Card: 16px, green-500 if `has_card_on_file`, amber-500 if not. Slash overlay on no-card variant.
- Forms: 16px, amber-500. Only shown if forms outstanding (Complete tier, future — stub for now).
- All icons have `title` tooltips on hover.
- Icons spaced 6px apart within the cluster.

### Phase 2: Room Header Changes

| File | Changes |
|------|---------|
| `src/lib/supabase/types.ts` | Add `link_token: string` to `RoomGroup` interface. |
| `src/lib/runsheet/grouping.ts` | (1) Pass `link_token` from `Room` into `RoomGroup` during construction. (2) Change room sort to `sort_order` only — remove priority-based sorting. |
| `src/components/clinic/room-container.tsx` | Add three hover-reveal action icons to the right of the room name, before status badges: gear (room settings), paper plane (send link), clipboard (copy link). Icons: 16px, gray-400, stroke, `opacity-0 group-hover:opacity-100 transition-opacity`. Copy link reads `link_token` from group. |

**Room action icons** (left to right):
1. Gear icon → navigates to `/settings/rooms` (or opens edit panel). Title: "Room settings".
2. Paper plane icon → stub action (console.log for now). Title: "Send session link".
3. Clipboard icon → copies `{origin}/entry/{link_token}` to clipboard, brief "Copied!" state. Title: "Copy room link".

**Room ordering**: `groups.sort((a, b) => a.room_sort_order - b.room_sort_order)` — stable position, no priority reordering.

### Phase 3: Sidebar User Section

| File | Changes |
|------|---------|
| `src/components/clinic/sidebar-user-section.tsx` | Restructure to flex row: left side has name + role stacked, right side has "Sign out" link vertically centred. Remove the separate sign out line below. |

## Dependency Graph

```
Phase 1 (Session Rows) ─── can run in parallel ─── Phase 3 (Sidebar)
Phase 2 (Room Headers) ─── depends on types change
```

Phase 1 and Phase 3 are independent. Phase 2 requires the types change first.

## Verification

- **Session rows**: Each state shows correct background tint. Modality shows as quiet gray icon (camera or building). Card icon is green or amber. No text pills. Rows are visually denser (py-2). Right side reads: badge → icons → button.
- **Room headers**: Hover over a room header → three action icons fade in. Click copy → clipboard has the room URL. Icons hidden when not hovering.
- **Room ordering**: Rooms stay in the same position regardless of session state changes. Sort order from DB is respected.
- **Sidebar**: User name and sign out are on the same line.

## Total New Files: 0
## Total Modified Files: 6
