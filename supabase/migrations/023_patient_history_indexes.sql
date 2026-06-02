-- 023_patient_history_indexes.sql
--
-- Composite (and partial-composite) indexes for the patient contact card's
-- history reads and the review endpoints, after splitting the patient dossier
-- into /summary + /history (see src/app/api/patient/[id]/). Existing indexes
-- are single-column only (idx_appointments_patient_id, _scheduled_at,
-- idx_form_assignments_patient_id, idx_form_submissions_patient_id), which
-- force the planner to sort over the full filtered set on every open.
--
-- Partial where the query is always-filtered: every appointment-history read
-- carries `status <> 'cancelled'`, so a partial index is tighter and smaller.
-- The partial predicate must match the query's WHERE clause EXACTLY
-- (`status <> 'cancelled'`, written the same way) for the planner to use it.
--
-- Depends on: 001_initial_schema.sql (appointments, sessions, form_submissions),
--             007_forms_v1.sql (form_assignments).
-- Sequence after 022 (pending apply on refactor/codebase-simplification); apply
-- both together.

-- Appointment history: filter patient_id, exclude cancelled, order scheduled_at.
CREATE INDEX IF NOT EXISTS idx_appointments_patient_scheduled_active
  ON appointments (patient_id, scheduled_at DESC)
  WHERE status <> 'cancelled';

-- Awaiting-scheduling bucket: scheduled_at IS NULL, ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_appointments_patient_awaiting
  ON appointments (patient_id, created_at DESC)
  WHERE scheduled_at IS NULL AND status <> 'cancelled';

-- Form history ordered reads (bounded patient-wide branch).
CREATE INDEX IF NOT EXISTS idx_form_assignments_patient_created
  ON form_assignments (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_patient_created
  ON form_submissions (patient_id, created_at DESC);

-- Latest-session-per-appointment lookup (sessions joined back to appointments).
CREATE INDEX IF NOT EXISTS idx_sessions_appointment_created
  ON sessions (appointment_id, created_at DESC);

-- By-appointment submission reads used by the active-appointment form branch
-- and by the review endpoints (/api/readiness/form-submission, intake-handoff).
CREATE INDEX IF NOT EXISTS idx_form_submissions_appointment_created
  ON form_submissions (appointment_id, created_at DESC);
