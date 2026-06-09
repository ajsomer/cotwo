-- 024_pms_integration.sql
-- Cliniko (and future PMS) two-way integration schema. Plan §8.
-- Deltas against the live Neon schema (NOT migration 001).

-- ─────────────────────────────────────────────────────────────────────────
-- A. pms_connections: re-scope org → location; add credentials + sync state.
-- Legacy rows are onboarding MARKERS (no credentials); keep them as markers.
-- A connection is "sync-active" iff credentials_encrypted IS NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE pms_connections
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS credentials_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS default_business_external_id TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill location_id for legacy marker rows: each org's first location.
-- credentials_encrypted stays NULL → they remain inert markers.
UPDATE pms_connections pc
SET location_id = sub.location_id
FROM (
  SELECT DISTINCT ON (org_id) org_id, id AS location_id
  FROM locations
  ORDER BY org_id, created_at ASC
) sub
WHERE pc.org_id = sub.org_id
  AND pc.location_id IS NULL;

-- Swap org-scoped uniqueness for location-scoped.
ALTER TABLE pms_connections DROP CONSTRAINT IF EXISTS pms_connections_org_id_key;
-- (org_id retained, denormalised, for org-wide queries.)
ALTER TABLE pms_connections ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE pms_connections ADD CONSTRAINT pms_connections_location_id_key UNIQUE (location_id);

-- ─────────────────────────────────────────────────────────────────────────
-- B. Incremental cursors — connection-scoped (plan §8.B).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pms_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  cursor_updated_at TIMESTAMPTZ,
  UNIQUE(connection_id, resource)
);

-- ─────────────────────────────────────────────────────────────────────────
-- C. External IDs — connection-scoped link tables (plan §8.C).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE locations ADD COLUMN IF NOT EXISTS pms_external_id TEXT;

CREATE TABLE IF NOT EXISTS pms_patient_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  pms_external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connection_id, pms_external_id),
  UNIQUE(connection_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_pms_patient_links_patient ON pms_patient_links (patient_id);

-- ─────────────────────────────────────────────────────────────────────────
-- D. Practitioner mapping — connection-scoped link table (plan §8.D).
-- Scoped to staff_assignments, never a single id on the global users row.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pms_practitioner_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  staff_assignment_id UUID NOT NULL REFERENCES staff_assignments(id) ON DELETE CASCADE,
  pms_external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connection_id, pms_external_id),
  UNIQUE(connection_id, staff_assignment_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- E/H. Appointment-type mapping + per-connection resolution config (§8.E/H).
-- The single source of truth for PMS-import state: confirmed_modality / room_id
-- / sync_enabled live HERE, never on the org-scoped appointment_types row.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pms_appointment_type_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES pms_connections(id) ON DELETE CASCADE,
  appointment_type_id UUID NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
  pms_external_id TEXT NOT NULL,
  confirmed_modality appointment_modality,          -- NULL until confirmed
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  sync_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connection_id, pms_external_id),
  UNIQUE(connection_id, appointment_type_id)
);

-- Appointments: connection↔location is 1:1, so upsert on (location_id, ext id).
-- Partial unique index so concurrent sync runs can't duplicate (§8.H).
CREATE UNIQUE INDEX IF NOT EXISTS appointments_location_pms_external_id_uq
  ON appointments (location_id, pms_external_id)
  WHERE pms_external_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- F. Form provider tag (plan §8.F). NULL = generic, not PMS-bound.
-- Per-question pmsTarget bindings live in forms.schema, not a column.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE forms ADD COLUMN IF NOT EXISTS pms_provider pms_provider;

-- ─────────────────────────────────────────────────────────────────────────
-- G. Write-back idempotency + per-field receipts (plan §8.G).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS pms_external_id TEXT,
  ADD COLUMN IF NOT EXISTS pms_push_status TEXT,   -- pending|partial|sent|failed
  ADD COLUMN IF NOT EXISTS pms_pushed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pms_push_field_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  provider pms_provider NOT NULL,
  survey_question_name TEXT NOT NULL,
  pms_target_key TEXT NOT NULL,
  status TEXT NOT NULL,                 -- written|skipped_existing|unmapped|failed
  attempted_value TEXT,
  failure_kind TEXT,                    -- validation|transport|auth|mapping
  detail TEXT,
  attempts INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(submission_id, survey_question_name)
);
CREATE INDEX IF NOT EXISTS idx_pms_push_field_results_submission
  ON pms_push_field_results (submission_id);
