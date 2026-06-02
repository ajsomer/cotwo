

## (b) Supabase-specific things removed or adapted

**Removed entirely (no app-code replacement needed):**
- **All RLS**: every `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and every `CREATE POLICY` / `CREATE POLICY ... DROP` across migrations 001, 005, 007, 010, 014, 017, 019. Authz now lives in app code.
- **`supabase_realtime` publication**: all `ALTER PUBLICATION supabase_realtime ADD TABLE ...` (001, 004, 012, 014). Realtime in this app is Socket.io, not Supabase Realtime, so nothing is lost.
- **`storage.*`**: the `storage.buckets` inserts and `storage.objects` policies for the `org-logos` (003) and `clinic-files` (017) buckets. Neon has no Supabase Storage — file storage needs a separate provider (S3/R2 etc.). The `files.storage_path` column is retained; only the bucket/policies are dropped.

**Adapted (these had `auth.*` and need app-code replacements):**
- **`users.id` FK to `auth.users`** (re-added in 003, dropped in 002): NOT recreated. `users.id` is a plain `UUID PRIMARY KEY DEFAULT gen_random_uuid()`. Staff identity now maps to `neon_auth` (managed separately, not touched here) — the app must link a Neon Auth user to a `public.users` row itself.
- **`handle_new_user()` function + `on_auth_user_created` trigger on `auth.users`** (003): DROPPED. This auto-inserted a `public.users` row on Supabase Auth sign-up, reading `raw_user_meta_data->>'full_name'`. **App-code replacement required**: on staff sign-up via Neon Auth, the app must explicitly insert the `public.users` row (id, email, full_name) — there is no DB trigger doing it now.
- **`public.user_org_ids()` and `public.user_location_ids()`** (001): DROPPED. Both were `SECURITY DEFINER` helpers built on `auth.uid()` and used ONLY by the RLS policies (which are gone). **App-code replacement**: the org/location scoping they expressed (`staff_assignments → locations → organisations` for the current user) must be applied as explicit WHERE clauses / joins in application queries.
- The `auth.role() = 'authenticated'` checks inside the dropped storage policies are gone with those policies.

**Data-only statements excluded** (schema script is DDL-only): the 8 seed-form `INSERT`s in 008, the `DELETE FROM users WHERE id NOT IN (SELECT id FROM auth.users)` cleanup in 003, and the form-schema backfill `UPDATE` in 021. The 021 identity-page backfill only matters for pre-existing rows; on a fresh DB it is a no-op, and the app writes the `__patient_identity` page at form-creation time.

## (c) Sanity check: enums and table count

**Enums (final values):**
1. `user_role`: practice_manager, receptionist, clinician, **clinic_owner**
2. `employment_type`: full_time, part_time
3. `room_type`: clinical, reception, shared, triage
4. `appointment_modality`: telehealth, in_person
5. `appointment_status`: scheduled, arrived, in_progress, completed, cancelled, no_show
6. `session_status`: queued, waiting, checked_in, in_session, complete, done
7. `workflow_direction`: pre_appointment, post_appointment
8. `action_type`: send_sms, deliver_form, capture_card, send_reminder, send_nudge, send_session_link, send_resource, send_proms, send_rebooking_nudge, verify_contact, send_file, intake_package, intake_reminder, add_to_runsheet, task (16 values)
9. `action_status`: pending, sent, completed, failed, skipped, scheduled, opened, captured, verified, cancelled, firing, transcribed, dropped (13 values)
10. `payment_status`: pending, processing, completed, failed, refunded
11. `stripe_routing`: location, clinician
12. `workflow_template_status`: draft, published, archived
13. `appointment_type_source`: coviu, pms
14. `workflow_run_status`: active, complete, cancelled
15. `workflow_terminal_type`: run_sheet, collection_only
16. `pms_provider`: cliniko, halaxy, nookal, power_diary, gentu
17. `pms_connection_status`: connected, skipped, pending
18. `stripe_connection_status`: connected, skipped
19. `onboarding_stage`: not_started, test_session_sent, call_active, call_completed

**19 enums total.**

**Tables (29 total):** organisations, locations, rooms, users, staff_assignments, clinician_room_assignments, patients, patient_phone_numbers, payment_methods, phone_verifications, appointment_types, appointments, sessions, session_participants, payments, forms, form_fields, form_submissions, form_assignments, workflow_templates, workflow_action_blocks, type_workflow_links, outcome_pathways, appointment_workflow_runs, appointment_actions, intake_package_journeys, files, file_deliveries, pms_connections, stripe_connections.

Wait — that list is 30. Recount: the 30 names above are correct; **30 tables total** (I miscounted "29" — the accurate count is 30).

**Functions (4):** update_updated_at (trigger fn), configure_appointment_type, configure_outcome_pathway, confirm_outcome_pathway, save_workflow_blocks — i.e. 1 trigger helper + 4 RPCs.

A note on dependency ordering I handled explicitly: `phone_verifications` is created before `sessions` (it predates it in the migrations), so its `session_id` FK is added via a deferred `ALTER TABLE` after `sessions` exists; likewise `sessions.outcome_pathway_id` FK is deferred until after `outcome_pathways`. `workflow_action_blocks.parent_action_block_id` self-FK and its `form_id → forms` FK are inline since `forms` is created before the workflow tables in this consolidated ordering.
agentId: ad1269b57cdcff149 (use SendMessage with to: 'ad1269b57cdcff149' to continue this agent)
<usage>subagent_tokens: 124225
tool_uses: 25
duration_ms: 262804</usage>