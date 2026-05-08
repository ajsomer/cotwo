# Remove Collection-Only Appointment Types Plan

**Status:** Proposed, not implemented
**Date:** 2026-05-08

## Summary

Remove `collection_only` from appointment-type configuration and add-patient flows, while leaving the database enum and legacy read paths tolerant until standalone forms are built. The goal is to stop modelling form-only work as fake appointments and prepare for a future standalone forms surface that feeds readiness directly.

## Key Changes

- **Product/UI:** Remove "Standalone collections" from Appointment Types settings. Appointment types become run-sheet appointment types only: name, duration, modality, fee, intake package, reminders, urgency.
- **Add patient flow:** Require room/date/time for every appointment type. Delete the `isRunSheet` / `needsScheduling` branch in the add-patient panel and the matching nullable scheduling path in `/api/readiness/add-patient`.
- **Configuration API:** Stop accepting `terminal_type = 'collection_only'` from `/api/appointment-types/configure`; always call `configure_appointment_type` with `p_terminal_type: 'run_sheet'`.
- **Types:** Narrow app-owned UI types where practical, but keep generated Supabase enum/types unchanged because removing a Postgres enum value is invasive and unnecessary for v1.
- **Legacy tolerance:** Keep read paths that may encounter old `collection_only` templates tolerant. Existing intake links, old workflow templates, and historical null-scheduled appointments should not crash; they just stop being creatable from UI/API.
- **Future standalone forms:** Plan a new standalone forms model separately. It should not be backed by appointments and should create readiness items directly once designed.

## Implementation Details

- In `appointment-types-settings-shell`, remove collection filtering, the standalone collections section, `handleNewCollection`, and `editorTerminalType` branching. The settings page should show one appointment types table and one "New appointment type" button.
- In `appointment-type-editor`, remove `forceTerminalType`, `terminalType`, `isCollectionOnly`, collection-specific copy, disabled fields, and conditional payload values. Always require duration and modality and send `terminal_type: 'run_sheet'` or omit it if the API defaults it.
- In `/api/appointment-types/configure`, reject or ignore `collection_only`; prefer rejecting with `400` if supplied so stale clients fail loudly. Always pass run-sheet duration/modality through to the RPC.
- In `AddPatientPanel`, remove conditional scheduling validation. `room_id`, `date`, and `time` are always required once an appointment type is selected.
- In `/api/readiness/add-patient`, stop looking up `workflow_templates.terminal_type` to decide required fields. Always require `room_id` and `scheduled_at`, and create appointments with scheduled time and room.
- In `src/lib/workflows/scanner.ts`, leave the existing null-`scheduled_at` guard in place for `add_to_runsheet` blocks. It protects historical collection-only/null-scheduled appointments by marking the action `dropped` instead of throwing.
- In `src/stores/clinic-store.ts`, narrow `AppointmentTypeRow.terminal_type` if practical for app-owned UI state. Do not edit generated `src/lib/supabase/types.ts` to remove `collection_only`.
- Leave tolerant read paths in place where they key off `scheduled_at === null`, especially `src/lib/intake/outstanding.ts` and `src/lib/readiness/derived-state.ts`. Those paths continue to protect historical records and in-flight intake links.
- Do not modify migrations to remove `workflow_terminal_type.collection_only` in this plan. Leave DB cleanup for a later migration only after no production rows depend on it.

## Test Plan

- Appointment type settings no longer displays "Standalone collections" or "New collection".
- Creating/editing an appointment type always requires duration and modality and saves successfully.
- `/api/appointment-types/configure` rejects `terminal_type: 'collection_only'`.
- Add patient flow always requires room/date/time and creates scheduled appointments only.
- A historical appointment with `scheduled_at = null` renders on the readiness dashboard without error.
- The workflow scanner processes a legacy null-scheduled appointment with an `add_to_runsheet` block by emitting/recording the existing `dropped` behavior rather than throwing.
- An in-flight intake link backed by a `collection_only` workflow template still resolves through `resolve-journey.ts`.
- Run `npm run lint` and `npm run build`.

## Assumptions

- V1 removes creation and primary UI support for collection-only appointment types, not historical database values.
- Standalone forms will be a separate future feature, not a renamed `collection_only` appointment type.
- Readiness integration for standalone forms will be planned separately with its own data model and lifecycle.
