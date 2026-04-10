# Technical Review: Readiness Dashboard Spec

**Reviewed:** 2026-04-08
**Spec:** `docs/specs/readiness-dashboard-spec.md`
**Reviewer:** Claude (automated schema + codebase review)

---

## Summary

The spec is well-structured and the majority of its assumptions align with the existing schema and codebase. There is one critical schema gap (transcription tracking), several moderate issues worth resolving before implementation, and a handful of minor clarifications. An existing implementation (`readiness-shell.tsx`, `/api/readiness`) already covers a subset of what the spec describes and should be the starting point.

---

## Critical Issues

### 1. No schema support for form transcription state

The spec's "Form Completed, Needs Transcription" priority slot and "Mark as transcribed" interaction require tracking whether a form submission has been transcribed into the PMS. **No existing table has this field.**

- `form_submissions` has: id, form_id, patient_id, appointment_id, responses, created_at. No status column.
- `form_assignments` (migration 007) has: status ('pending', 'sent', 'opened', 'completed'). No transcription state.
- `appointment_actions` (the workflow engine's runtime table) has: status (action_status enum). The enum values are: pending, sent, completed, failed, skipped, scheduled, opened, captured, verified, cancelled, firing. No "transcribed" value.

**Options:**
1. Add a `transcribed_at` column to `form_submissions` (simplest, tracks per-submission).
2. Add a `transcription_status` column to `form_assignments` (aligns with existing form tracking).
3. Add `'transcribed'` to the `action_status` enum and track it on `appointment_actions` (keeps it in the workflow engine layer).

**Recommendation:** Option 3. The transcription state is a workflow concern (it only exists in unintegrated Complete). Tracking it on `appointment_actions` keeps the workflow engine as the single source of truth for the Readiness Dashboard. The `action_status` enum would need a new `'transcribed'` value, and the `deliver_form` action's lifecycle becomes: `scheduled` -> `firing` -> `sent` -> `opened` -> `completed` -> `transcribed`.

**Resolution:** Accepted Option 3. Add `'transcribed'` to `action_status` enum. Track transcription state on `appointment_actions`. The lifecycle for `deliver_form` actions becomes: `scheduled` → `firing` → `sent` → `opened` → `completed` → `transcribed`. The action stays at `sent` or `opened` indefinitely if the patient never completes the form, becoming overdue per the standard derivation.

---

## Moderate Issues

### 2. Role access list is incomplete

The spec says: "Receptionists (primary), Practice Managers, Clinic Owners." The `clinic_owner` role must be included in all role checks alongside `practice_manager` and `clinician` (established pattern in codebase). The spec correctly lists Clinic Owners but the implementation must ensure `clinic_owner` is included in every `practice_manager` gate. Just flagging this for implementation awareness.

**Resolution:** Acknowledged. Implementation must include `clinic_owner` in every `practice_manager` permission gate, following established codebase pattern. Not a spec change.

### 3. Spec describes a "Practitioner" dropdown populated from clinicians, but appointments.clinician_id references `users.id` directly

The schema has `appointments.clinician_id` as a FK to `users(id)`, not to `staff_assignments`. The "Practitioner" dropdown in the Add Patient flow should:
- Query `staff_assignments` WHERE `location_id` = selected location AND `role` IN ('clinician', 'clinic_owner')
- Join `users` to get `full_name`
- Save the selected `user_id` into `appointments.clinician_id`

This works, but the spec should clarify that practitioner selection is location-scoped (it is, implicitly, via staff_assignments).

**Resolution:** Resolved by removing practitioner as a separate field entirely. Room is the only assignment in the manual entry path. `appointments.clinician_id` becomes nullable and is left null at creation; clinician is derived from room at day-of session creation. No practitioner dropdown needed.

### 4. Patient matching logic needs clarification

The spec says: "match an existing one by mobile + DOB if a previous record exists for this org." The schema stores phone numbers in `patient_phone_numbers` (separate table), not on `patients`. The matching query is:

```sql
SELECT p.* FROM patients p
JOIN patient_phone_numbers ppn ON ppn.patient_id = p.id
WHERE p.org_id = :org_id
AND p.date_of_birth = :dob
AND ppn.phone_number = :phone;
```

This is fine but worth noting that matching crosses two tables. The spec should mention that the phone number is also inserted into `patient_phone_numbers` (with `is_primary = true`) on patient creation.

**Resolution:** Accepted clarification. Patient creation flow inserts into both `patients` and `patient_phone_numbers` (with `is_primary = true`). Matching query joins both tables. No design change.

### 5. No `room_id` derivation from appointment type

The spec says: "Selecting an appointment type implicitly selects the workflow template, the room type, and the modality." The schema for `appointment_types` carries `modality` but **not** `room_type` or `room_id`. Room assignment is done on `appointments.room_id`. The Add Patient form would need either:
- A room dropdown (explicit), or
- A mapping from appointment_type -> room_type -> available rooms at the location (implicit, but no `room_type` column on `appointment_types`)

The `rooms` table has a `type` column (room_type enum: clinical, reception, shared, triage). But there's no FK or mapping from appointment types to room types in the schema.

**Recommendation:** For the prototype, either add a Room dropdown to the Add Patient form, or auto-assign based on the clinician's room assignments (`clinician_room_assignments` table). The spec's claim that appointment type "implicitly selects the room type" is not supported by the schema.

**Resolution:** The original spec was wrong. Appointment type does NOT imply room — only modality. Room is an explicit dropdown in the Add Patient form, populated from rooms at the current location. No schema change needed for room mapping. The flagged concern is resolved by the spec correction.

### 6. Existing implementation gap: post-appointment mode

The current `/api/readiness` endpoint only queries `direction='pre_appointment'` workflow runs. The spec requires a Pre/Post toggle. The API endpoint will need to accept a `direction` parameter and query accordingly.

**Resolution:** Accepted. Parameterise the existing `/api/readiness` endpoint with a `direction` query parameter. Do not create a separate endpoint for post-appointment.

### 7. No "overdue" or "at risk" derivation logic defined

The spec describes priority slots (Overdue, At Risk, In Progress) but the existing schema has no explicit "overdue" flag. This is a derived state, similar to the run sheet's `late` and `upcoming` states. The derivation logic needs to be defined:
- **Overdue:** `appointment_actions.status` NOT IN terminal statuses AND `appointment_actions.scheduled_for` < NOW() AND appointment `scheduled_at` is within 24 hours?
- **At Risk:** Similar but with a wider window?

The spec's Open Question #3 touches this. For implementation, the thresholds need concrete values. The spec should either define them or explicitly delegate to the workflow engine config.

**Resolution:** Accepted with refinement. Overdue = action `scheduled_for` is in the past AND (appointment within 24 hours OR action was scheduled more than 48 hours ago, whichever is sooner). At Risk = action `scheduled_for` is in the past AND appointment within 7 days AND not overdue. Concrete thresholds are global defaults for the prototype, configurable per workflow template in v2.

---

## Minor Issues

### 8. Filter by "Room type" has no direct path

The spec lists "Room type" as a filter chip. To filter by room type, the query path is: `appointments.room_id` -> `rooms.type`. This works but requires a join. Worth noting that if `room_id` is nullable on appointments (which it is), unassigned appointments won't appear under any room type filter.

**Resolution:** The "Room type" filter has been removed entirely from the spec. The filter set is now Room (specific rooms at the location), Appointment type, and Status (priority slot). The query path for the Room filter is `appointments.room_id` directly. Unassigned appointments (null `room_id`) cannot exist in the manual entry path because room is a required field, so the flagged edge case does not apply.

### 9. `appointment_actions` does not track "who transcribed"

If audit trail matters for the transcription handoff, the schema would need a `transcribed_by` (UUID FK -> users) column alongside the status change.

**Resolution:** Out of scope for v1. The prototype tracks only that transcription happened (state transition on `appointment_actions`), not who performed it. v2 work will add `transcribed_by` and `transcribed_at` columns.

### 10. Real-time channel naming

The spec proposes `readiness:{location_id}` as the channel. The existing run sheet uses Supabase Realtime with the Zustand store pattern (`useClinicStore`). The Readiness Dashboard should follow the same store pattern rather than introducing a parallel subscription system.

**Resolution:** The Readiness Dashboard uses the existing `useClinicStore` Zustand store, not a parallel store. Realtime subscriptions live in `ClinicDataProvider` alongside the run sheet subscriptions. Channel naming follows the existing pattern.

### 11. Date range filtering not in current API

The spec mentions "filter by date range to view patients whose workflows completed in past periods." The current API endpoint doesn't support date range parameters. This will need to be added.

**Resolution:** Out of scope for v1. The default view shows active workflows only. Date range filtering for historical workflows is a v2 enhancement and the API endpoint does not need to support it.

### 12. Typography inconsistency

The spec lists "12px 600" for patient name and "11px" for secondary text. The CLAUDE.md brand system specifies "14px" for body and "12px" for small/labels. The spec's sizes are smaller than the established system. Consider using the existing type scale.

**Resolution:** Accepted. The spec's font sizes have been updated to match the established brand system (14px body, 12px small/labels) as defined in CLAUDE.md.

---

## Existing Implementation to Build On

The codebase already has a partial implementation:

| Component | Path | Status |
|-----------|------|--------|
| Page wrapper | `src/app/(clinic)/readiness/page.tsx` | Exists, renders ReadinessShell |
| API endpoint | `src/app/api/readiness/route.ts` | Exists, pre-appointment only, no filters |
| Shell component | `src/components/clinic/readiness-shell.tsx` | Exists, basic date grouping, expandable rows |
| Workflow engine | `src/lib/workflows/engine.ts` | Exists, handles scheduled action execution |
| Workflow scanner | `src/lib/workflows/scanner.ts` | Exists, schedules actions for appointments |
| Preconditions | `src/lib/workflows/preconditions.ts` | Exists, form/card/contact/rebooking checks |
| Slide-over pattern | `src/components/ui/slide-over.tsx` | Exists, used by add-session-panel |
| Zustand store | `src/stores/clinic-store.ts` | Exists, real-time subscription pattern |

**Gap between existing and spec:** The existing implementation is a basic "outstanding items" list grouped by date. The spec adds: priority hierarchy sorting, auto-expand/collapse, filter chips, Add Patient flow, form transcription handoff, post-appointment mode toggle, patient detail panel, and background notifications.

---

## Schema Changes Required Before Implementation

~~1. Add `'transcribed'` to `action_status` enum (or alternative from Critical Issue #1)~~
~~2. Decide on room assignment strategy for Add Patient flow (Moderate Issue #5)~~

See updated list in "Outstanding Schema Changes Required Before Implementation" below.

---

## Open Questions (Spec's Own + Additional)

The spec's original questions 1–5 are resolved within the spec itself (see the spec's Open Questions section). Questions 6–9 below were added by this review and are resolved as follows.

6. **Room assignment in Add Patient:** Resolved. Explicit room dropdown in the Add Patient form.
7. **Transcription tracking location:** Resolved. `appointment_actions` with new `'transcribed'` enum value.
8. **Overdue/At Risk thresholds:** Resolved. Overdue = `scheduled_for` past AND (appointment within 24h OR action scheduled 48h+ ago). At Risk = `scheduled_for` past AND appointment within 7 days AND not overdue.
9. **Store pattern:** Resolved. Use existing `useClinicStore`.

---

## Outstanding Schema Changes Required Before Implementation

1. Add `'transcribed'` to the `action_status` enum (migration required)
2. Make `appointments.clinician_id` nullable if it is currently non-null (migration required)
3. Verify `useClinicStore` already has `readinessAppointments` slice and `refreshReadiness` action; extend to accept a `direction` parameter if needed
4. Parameterise `/api/readiness` endpoint with `direction` query parameter

---

*End of review.*
