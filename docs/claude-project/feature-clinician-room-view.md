# Feature: Clinician Room View

The clinician's filtered view of the run sheet. Structurally a filtered run sheet, but the role-filtering logic appears in enough non-obvious places (notifications, channel subscriptions, action availability) that it earns its own doc.

This is not a separate page. Clinicians hit the same `/runsheet` URL as receptionists; the rendering is determined by role and assignment data.

---

## What a clinician sees

The standard run sheet, filtered to the rooms they're assigned to via `clinician_room_assignments`. The filtering is applied at the data-fetch layer (the run sheet query takes role and assignment into account) so the clinician's Zustand store contains only their rooms.

A clinician with one room assigned sees that one room's slice of the day. A clinician with several sees a multi-room view that behaves like the receptionist run sheet, just narrower.

A clinician with **no** rooms assigned sees an empty run sheet with a message to ask their practice manager to assign them. This is a setup state, not a normal one.

## What's different from the receptionist view

The component is the same; the differences are flags and conditional rendering:

- **Single-room clinicians**: their one room should be always expanded, with no room header. The component logic in `room-container.tsx` supports this, but the `singleRoom` flag at the call site in `runsheet-shell.tsx` is currently hardcoded to `false`, so single-room clinicians today see the standard room header and expansion controls. Wiring the flag (compute from `clinicianRoomIds.length === 1`) is the small change to land the intended behaviour.
- **Multi-room clinicians**: standard room expansion/collapse behaviour, same as the receptionist view.
- **No summary bar.** Clinicians don't see "3 late, 5 to process" aggregates.
- **No bulk actions.** No bulk admit, no bulk nudge.
- **No "+ Add session" button.** Clinicians don't plan the run sheet.
- **No Plan Tomorrow toggle.**
- **No process flow access** unless the clinician is also processing their own sessions (solo practitioner case, see below).
- **Start/end call** is the primary action available on session rows. For telehealth, the clinician clicks to admit a waiting patient or to start the call.

## The "clinic owner is also a clinician" case

A clinic owner who is also a practising clinician (which is most clinic owners) sees both views in a single page. Specifically:

- They see the receptionist-shaped run sheet (full clinic view, summary bar, bulk actions, "+ Add session," Plan Tomorrow).
- They *also* have clinician-side actions on their assigned rooms (start call, admit).

This is why the role check in the codebase needs to include `clinic_owner` in any practice-manager OR clinician role set. See `feature-tiers-and-roles.md` for the rule.

The `clinic_owner` role does not get filtered to only their assigned rooms; they see the full clinic view, just with clinician actions enabled where applicable.

## Solo practitioner mode

A clinic owner with no receptionist (which is many small clinics on Core) needs to do their own processing: take payment, select outcome pathway, mark done. The same Process flow that a receptionist uses is available to them on their own sessions.

This is not a separate "solo mode" toggle. The Process flow's availability is determined by role: any user with the Receptionist OR Practice Manager OR Clinic Owner permission set can process sessions. The clinic owner naturally falls into this set because they count as Practice Manager.

A pure Clinician role (not clinic owner) cannot process sessions. They start and end calls but can't take payment or close out the visit. If a clinic has a pure Clinician role and no receptionist, that's a setup gap; someone with admin permissions has to do the processing.

## Notifications for clinicians

The intent is that clinicians get notified (tab flash, favicon badge, optional push) only for events in rooms they're assigned to — a "patient arrived" event in someone else's room shouldn't paginate them. Today, notifications are driven from the same selected-location runsheet summary the receptionist uses, with no per-room or per-clinician filter applied. Once room-scoped filtering and cross-location signal are built (see the runsheet doc and the realtime conventions doc), the natural extension is to additionally filter the notification trigger by `clinician_room_assignments`.

For now: a clinician sees the same tab flash / favicon badge as anyone else viewing the selected location. That's a known limitation, not the design we want.

## Real-time subscriptions

The clinician's clinic-side connection joins the same Socket.io room as the receptionist: `location:{selected_location_id}`. Events on that room (`session_changed`, `readiness_changed`, `presence:update`) are emitted to all subscribers, and the rendering layer filters to the clinician's assigned rooms.

Server-side filtering by role does not happen on the broadcast — the room is shared and everyone hears the same events. Filtering is at render time, via `clinicianRoomIds` on the runsheet shell. If a clinician should not see a session at all (different room), it's already absent from their store. If they should see it but with reduced action affordances (e.g. no Process button), that's down to role-aware action config in `derived-state.ts`.

There is no separate `readiness:` or `payments:` room. The single `location:{id}` room carries everything, and views read what they need.

## Action availability

The set of actions visible on a session row depends on role, session state, and modality. For clinicians:

- **Queued / Late / Upcoming**: no actions. The clinician waits for the patient to arrive.
- **Waiting** (telehealth): "Admit" button, starts the call.
- **Checked in** (in-person): typically no clinician action. The receptionist process flow handles in-person check-in to call transition through different mechanics (the clinician moves to the room physically).
- **In session**: "End call" or session controls. Telehealth-specific.
- **Complete / Done**: no actions. Processing is admin-only unless the clinic owner is solo-mode.

Compared to the receptionist's full set of actions (Nudge, Admit, Process, etc), the clinician's set is small. This is intentional; the clinician's job on the run sheet is to start and end calls, not to drive the operational flow forward.

## Where to look

- **Run sheet page:** `src/app/(clinic)/runsheet/page.tsx` (same as receptionist).
- **Role-aware filtering:** `src/lib/runsheet/queries.ts` (look for the join through `clinician_room_assignments`).
- **Action config:** `src/lib/runsheet/derived-state.ts` (the `getActionConfig` function decides what action a session row shows).
- **Role hooks:** `src/hooks/useRole.ts`.
- **Room assignment table:** `clinician_room_assignments`.

## Related docs

- `feature-runsheet.md` for the broader run sheet feature this is filtered against.
- `feature-tiers-and-roles.md` for the clinic_owner-counts-as-both rule and the role visibility matrix.
- `feature-process-flow.md` for what happens when a session is complete and ready for processing.
- `conventions-realtime-and-state.md` for the channel subscription patterns clinicians use.
- `feature-admin-and-config.md` for room assignment management.
