# Plan: Settings — Rooms Management

## Context

The sidebar and route structure are in place. `/settings` shows a 4-card grid linking to Team, Rooms, Appointment Types, and Payment Config. All four sub-pages are stubs. The run sheet is functional and renders rooms from the `rooms` table.

We need to flesh out the Rooms settings page first because rooms are the organisational backbone of the run sheet — every session belongs to a room, and clinicians are assigned to rooms. Being able to create, edit, and delete rooms unblocks testing of multi-room run sheet layouts and clinician filtering.

### Current State

- **`/settings/rooms`**: Stub page with just an `<h1>Rooms</h1>`
- **`rooms` table**: Exists in the schema with columns: `id`, `location_id`, `name`, `room_type` (clinical/reception/shared/triage), `link_token`, `sort_order`
- **Seed data**: 4 rooms at Bondi Junction — Dr Smith's Room (clinical), Dr Nguyen's Room (clinical), Nurse Room (shared), On-Demand Room (triage)
- **`clinician_room_assignments`**: Junction table linking staff assignments to rooms, with `ON DELETE CASCADE` on `room_id`. Seed data assigns Dr Smith and Dr Nguyen to their respective rooms.
- **Run sheet**: Already reads rooms via `fetchLocationRooms()` and groups sessions by room
- **Types**: `Room` and `RoomType` already defined in `src/lib/supabase/types.ts`
- **Existing UI components**: `SlideOver` panel in `src/components/ui/slide-over.tsx`, `Button` in `src/components/ui/button.tsx`, `Badge` in `src/components/ui/badge.tsx`

### Target State

A fully functional rooms management page scoped to the selected location:
- List all rooms for the current location with name, type, sort order, and on-demand link token
- Create new rooms via a slide-over panel
- Edit existing rooms via the same panel
- Delete rooms (with confirmation, only if no active sessions)
- Reorder rooms via sort_order (simple number input, not drag-and-drop)
- Clinician assignment management per room (which clinicians are assigned to this room)

## Architecture

- **Server component** (`/settings/rooms/page.tsx`): Thin wrapper that renders the client shell.
- **Client component** (`rooms-settings-shell.tsx`): Reads `useLocation()` to get the selected location, fetches rooms via API route, manages CRUD state. Lives in `src/components/clinic/`.
- **API route** (`/api/settings/rooms/route.ts`): GET (list rooms + clinicians for location), POST (create room + assignments), PATCH (update room + assignments), DELETE (delete room). Uses Supabase service role client since this is a prototype without full RLS for settings.
- **Slide-over panel**: Reuses the existing `SlideOver` component for create/edit form.

### Key Design Decisions

- **API route for mutations**: Server actions would be cleaner for production, but API routes are simpler to prototype and debug. One route file handles all CRUD.
- **No drag-and-drop reorder**: Sort order is a numeric field. Users type the number. Drag-and-drop is a lot of complexity for a prototype.
- **`link_token` auto-generated**: When creating a room, the API generates a unique `link_token` (used for on-demand entry URLs). Users don't set this manually. Displayed read-only in the edit panel with a copy-to-clipboard button.
- **Clinician assignment bundled into room save**: POST and PATCH handlers accept a `clinician_assignment_ids` array. After saving the room, the handler deletes existing assignments and inserts the new set. One round trip, one transaction. No separate assignment endpoint.
- **Clinician list via query param**: GET `/api/settings/rooms?location_id=xxx&type=clinicians` returns available clinicians for the location instead of rooms. Avoids a separate API file.
- **Location-scoped**: The page only shows rooms for the currently selected location (from the sidebar's location switcher). Switching locations refreshes the list.
- **Delete protection**: Cannot delete a room that has sessions with status other than `done`. Show an error toast if attempted. The `clinician_room_assignments` cascade handles assignment cleanup automatically — no manual deletion needed.
- **Unassigned clinician warning**: In the rooms list, clinical rooms showing "Unassigned" render in amber text as a visual cue that setup is incomplete. Triage and shared rooms show "Unassigned" in neutral gray since it's expected for those room types.

## Phases

### Phase 1: API Route

One route file handling all room CRUD operations plus clinician list for a given location.

| # | File | Action |
|---|------|--------|
| 1 | `src/app/api/settings/rooms/route.ts` | New — GET, POST, PATCH, DELETE handlers |

**GET** `/api/settings/rooms?location_id=xxx`
- Returns all rooms for the location, ordered by `sort_order`
- Joins `clinician_room_assignments` → `staff_assignments` → `users` to include assigned clinician names and staff_assignment_ids per room

**GET** `/api/settings/rooms?location_id=xxx&type=clinicians`
- Returns clinicians available at the location for the assignment checklist
- Queries `staff_assignments` where `role = 'clinician'`, joined with `users` for names
- Response: `Array<{ staff_assignment_id, user_id, full_name }>`

**POST** `/api/settings/rooms`
- Body: `{ location_id, name, room_type, sort_order, clinician_assignment_ids? }`
- Auto-generates `link_token` via `crypto.randomUUID()`
- After room insert, inserts `clinician_room_assignments` rows if `clinician_assignment_ids` provided
- Returns the created room with assignments

**PATCH** `/api/settings/rooms`
- Body: `{ id, name?, room_type?, sort_order?, clinician_assignment_ids? }`
- Updates room fields, then replaces `clinician_room_assignments` (delete all for room, insert new set)
- Returns the updated room with assignments

**DELETE** `/api/settings/rooms?id=xxx`
- Checks for sessions with status not in (`done`, `queued`) — if any exist, returns 409 with error message
- Deletes the room — `clinician_room_assignments` cascade handles assignment cleanup automatically
- Returns 200 on success

### Phase 2: Rooms List UI

The main rooms page showing a table of all rooms for the selected location.

| # | File | Action |
|---|------|--------|
| 2 | `src/app/(clinic)/settings/rooms/page.tsx` | Modify — render `RoomsSettingsShell` |
| 3 | `src/components/clinic/rooms-settings-shell.tsx` | New — client component: fetch rooms, render list, manage panel state |

**List layout**: Table with columns: Sort Order, Room Name, Type (badge), Clinicians (comma-separated names or "Unassigned"), Actions (Edit, Delete).

**Unassigned styling**: Clinical rooms with no clinician assignments show "Unassigned" in amber-500 text. Triage, shared, and reception rooms show "Unassigned" in gray-400 text (it's expected for these types).

**Empty state**: "No rooms configured for this location. Create your first room to get started."

**Header**: "Rooms" title with "+ Add room" button on the right.

**Data fetching**: `useEffect` on `selectedLocation?.id` to call GET API. Refetch after any mutation.

### Phase 3: Room Create/Edit Panel

Slide-over panel for creating and editing rooms.

| # | File | Action |
|---|------|--------|
| 4 | `src/components/clinic/room-form-panel.tsx` | New — slide-over with form fields |

**Form fields**:
- Room name (text input, required)
- Room type (select: Clinical, Reception, Shared, Triage — maps to `clinical`, `reception`, `shared`, `triage`)
- Sort order (number input, default to next available)
- Clinician assignments (checkbox list of clinicians at this location, fetched via `?type=clinicians`)
- On-demand link (read-only, shown only in edit mode, displays full URL like `{origin}/entry/{link_token}` with a copy-to-clipboard button)

**Clinician list**: Fetched on panel open via GET `?type=clinicians&location_id=xxx`.

**On save**: POST for create, PATCH for edit. Both include `clinician_assignment_ids` array. Panel closes and list refetches on success.

## Dependency Graph

```
Phase 1 (API) ── Phase 2 (List UI) ── Phase 3 (Form Panel)
```

All phases are sequential.

## Verification

- Navigate to `/settings/rooms` — see list of 4 seed rooms with correct types, sort orders, and clinician names
- Click "+ Add room" — slide-over opens with empty form, all 4 room types in dropdown
- Fill in name "Reception Desk", type "Reception", sort order 5 — save — room appears in list
- Click "Edit" on Dr Smith's Room — panel opens pre-filled, on-demand link shown with copy button, clinician checkboxes show Dr Smith checked — change name — save — list updates
- Click "Delete" on the new Reception Desk room — confirm — room removed from list
- Try to delete Dr Smith's Room (has active sessions in seed data) — see error message
- Verify "Unassigned" text: add a new clinical room without assigning clinicians — amber "Unassigned" text. Add a triage room without clinicians — gray "Unassigned" text.
- Switch dev role to Clinician — should not be able to access `/settings` at all (sidebar hides it)
- Switch location (if multi-location) — rooms list refreshes to new location's rooms

## Total New Files: 3
## Total Modified Files: 1
