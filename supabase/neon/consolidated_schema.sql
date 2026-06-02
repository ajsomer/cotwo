-- ============================================================================
-- Coviu Platform — Consolidated schema for Neon (plain Postgres 17)
-- Reflects the final state of Supabase migrations 001–023, with all
-- Supabase-specific constructs (RLS, auth schema, storage, supabase_realtime)
-- removed. Targets the `public` schema only. Does NOT touch `neon_auth`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums (final form, all later ADD VALUEs folded in)
-- ----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('practice_manager', 'receptionist', 'clinician', 'clinic_owner');
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time');
CREATE TYPE room_type AS ENUM ('clinical', 'reception', 'shared', 'triage');
CREATE TYPE appointment_modality AS ENUM ('telehealth', 'in_person');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE session_status AS ENUM ('queued', 'waiting', 'checked_in', 'in_session', 'complete', 'done');
CREATE TYPE workflow_direction AS ENUM ('pre_appointment', 'post_appointment');

CREATE TYPE action_type AS ENUM (
  'send_sms', 'deliver_form', 'capture_card', 'send_reminder', 'send_nudge',
  'send_session_link', 'send_resource', 'send_proms', 'send_rebooking_nudge',
  'verify_contact', 'send_file',
  'intake_package', 'intake_reminder', 'add_to_runsheet',
  'task'
);

CREATE TYPE action_status AS ENUM (
  'pending', 'sent', 'completed', 'failed', 'skipped',
  'scheduled', 'opened', 'captured', 'verified', 'cancelled',
  'firing',
  'transcribed',
  'dropped'
);

CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded');
CREATE TYPE stripe_routing AS ENUM ('location', 'clinician');

CREATE TYPE workflow_template_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE appointment_type_source AS ENUM ('coviu', 'pms');
CREATE TYPE workflow_run_status AS ENUM ('active', 'complete', 'cancelled');
CREATE TYPE workflow_terminal_type AS ENUM ('run_sheet', 'collection_only');

CREATE TYPE pms_provider AS ENUM ('cliniko', 'halaxy', 'nookal', 'power_diary', 'gentu');
CREATE TYPE pms_connection_status AS ENUM ('connected', 'skipped', 'pending');
CREATE TYPE stripe_connection_status AS ENUM ('connected', 'skipped');
CREATE TYPE onboarding_stage AS ENUM ('not_started', 'test_session_sent', 'call_active', 'call_completed');

-- ----------------------------------------------------------------------------
-- 2. Shared trigger function (updated_at)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. Org hierarchy
-- ----------------------------------------------------------------------------

CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'core' CHECK (tier IN ('core', 'complete')),
  logo_url TEXT,
  stripe_routing stripe_routing NOT NULL DEFAULT 'location',
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  qr_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_org_id ON locations(org_id);
CREATE INDEX idx_locations_qr_token ON locations(qr_token);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  room_type room_type NOT NULL DEFAULT 'clinical',
  link_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  sort_order INTEGER NOT NULL DEFAULT 0,
  payments_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_location_id ON rooms(location_id);
CREATE INDEX idx_rooms_link_token ON rooms(link_token);

-- ----------------------------------------------------------------------------
-- 4. Users & staff
-- (users.id is a plain UUID PK with gen_random_uuid() default — NO auth FK.
--  App-code authz now owns identity; staff auth lives in neon_auth, untouched.)
-- ----------------------------------------------------------------------------

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  onboarding_stage onboarding_stage NOT NULL DEFAULT 'not_started',
  has_seen_patient_journey BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id)
);

CREATE INDEX idx_staff_assignments_user_id ON staff_assignments(user_id);
CREATE INDEX idx_staff_assignments_location_id ON staff_assignments(location_id);

CREATE TABLE clinician_room_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_assignment_id UUID NOT NULL REFERENCES staff_assignments(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(staff_assignment_id, room_id)
);

CREATE INDEX idx_clinician_room_assignments_staff ON clinician_room_assignments(staff_assignment_id);
CREATE INDEX idx_clinician_room_assignments_room ON clinician_room_assignments(room_id);

-- ----------------------------------------------------------------------------
-- 5. Patients
-- ----------------------------------------------------------------------------

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_org_id ON patients(org_id);

CREATE TABLE patient_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(patient_id, phone_number)
);

CREATE INDEX idx_patient_phone_numbers_patient_id ON patient_phone_numbers(patient_id);
CREATE INDEX idx_patient_phone_numbers_phone ON patient_phone_numbers(phone_number);

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT NOT NULL,
  card_last_four TEXT NOT NULL,
  card_brand TEXT NOT NULL,
  card_expiry TEXT,
  is_default BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_methods_patient_id ON payment_methods(patient_id);

-- ----------------------------------------------------------------------------
-- 6. Phone verifications (application-level OTP)
-- ----------------------------------------------------------------------------

CREATE TABLE phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  session_id UUID,  -- FK added after sessions table (see below)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_phone_verifications_phone ON phone_verifications(phone_number);
CREATE INDEX idx_phone_verifications_session ON phone_verifications(session_id);

-- ----------------------------------------------------------------------------
-- 7. Scheduling
-- ----------------------------------------------------------------------------

CREATE TABLE appointment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  modality appointment_modality NOT NULL DEFAULT 'telehealth',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  default_fee_cents INTEGER NOT NULL DEFAULT 0,
  pms_external_id TEXT,
  source appointment_type_source NOT NULL DEFAULT 'coviu',
  pms_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointment_types_org_id ON appointment_types(org_id);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  clinician_id UUID REFERENCES users(id) ON DELETE SET NULL,
  appointment_type_id UUID REFERENCES appointment_types(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,  -- nullable (collection_only workflows)
  status appointment_status NOT NULL DEFAULT 'scheduled',
  phone_number TEXT,
  pms_external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_org_id ON appointments(org_id);
CREATE INDEX idx_appointments_location_id ON appointments(location_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_clinician_id ON appointments(clinician_id);
CREATE INDEX idx_appointments_scheduled_at ON appointments(scheduled_at);
CREATE INDEX idx_appointments_location_scheduled ON appointments(location_id, scheduled_at);
CREATE INDEX idx_appointments_created_at ON appointments(created_at);
CREATE INDEX idx_appointments_patient_scheduled_active
  ON appointments (patient_id, scheduled_at DESC)
  WHERE status <> 'cancelled';
CREATE INDEX idx_appointments_patient_awaiting
  ON appointments (patient_id, created_at DESC)
  WHERE scheduled_at IS NULL AND status <> 'cancelled';

-- ----------------------------------------------------------------------------
-- 8. Sessions
-- ----------------------------------------------------------------------------

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  status session_status NOT NULL DEFAULT 'queued',
  entry_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  video_call_id TEXT,
  notification_sent BOOLEAN NOT NULL DEFAULT false,
  notification_sent_at TIMESTAMPTZ,
  patient_arrived BOOLEAN NOT NULL DEFAULT false,
  patient_arrived_at TIMESTAMPTZ,
  session_started_at TIMESTAMPTZ,
  session_ended_at TIMESTAMPTZ,
  invite_sent BOOLEAN NOT NULL DEFAULT false,
  invite_sent_at TIMESTAMPTZ,
  prep_completed BOOLEAN NOT NULL DEFAULT false,
  card_captured BOOLEAN NOT NULL DEFAULT false,
  device_tested BOOLEAN NOT NULL DEFAULT false,
  outcome_pathway_id UUID,  -- FK added after outcome_pathways (see below)
  is_onboarding_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_appointment_id ON sessions(appointment_id);
CREATE INDEX idx_sessions_room_id ON sessions(room_id);
CREATE INDEX idx_sessions_location_id ON sessions(location_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_location_created ON sessions(location_id, created_at);
CREATE INDEX idx_sessions_entry_token ON sessions(entry_token);
CREATE INDEX idx_sessions_onboarding_demo ON sessions(is_onboarding_demo) WHERE is_onboarding_demo = true;
CREATE INDEX idx_sessions_appointment_created ON sessions (appointment_id, created_at DESC);

-- Deferred FK: phone_verifications.session_id -> sessions(id)
ALTER TABLE phone_verifications
  ADD CONSTRAINT phone_verifications_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

CREATE TABLE session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'patient',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, patient_id)
);

CREATE INDEX idx_session_participants_session_id ON session_participants(session_id);
CREATE INDEX idx_session_participants_patient_id ON session_participants(patient_id);

-- ----------------------------------------------------------------------------
-- 9. Payments
-- ----------------------------------------------------------------------------

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_appointment_id ON payments(appointment_id);
CREATE INDEX idx_payments_session_id ON payments(session_id);
CREATE INDEX idx_payments_patient_id ON payments(patient_id);

-- ----------------------------------------------------------------------------
-- 10. Forms
-- ----------------------------------------------------------------------------

CREATE TABLE forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_platform_demo BOOLEAN NOT NULL DEFAULT false,
  public_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  public_token_rotated_at TIMESTAMPTZ,
  public_token_rotated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_forms_org_id ON forms(org_id);
CREATE INDEX idx_forms_platform_demo ON forms(org_id) WHERE is_platform_demo = false;

CREATE TABLE form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  field_type TEXT NOT NULL,
  label TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  options JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_fields_form_id ON form_fields(form_id);

CREATE TABLE form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  responses JSONB NOT NULL DEFAULT '{}',
  submission_source TEXT NOT NULL DEFAULT 'entry_flow'
    CHECK (submission_source IN ('entry_flow', 'standalone_public', 'standalone_sms', 'standalone_qr')),
  review_status TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT form_submissions_source_review_consistency CHECK (
    (submission_source = 'entry_flow' AND review_status IS NULL)
    OR
    (submission_source <> 'entry_flow' AND review_status IN ('pending', 'reviewed', 'archived'))
  ),
  CONSTRAINT form_submissions_standalone_no_appointment CHECK (
    submission_source = 'entry_flow' OR appointment_id IS NULL
  )
);

CREATE INDEX idx_form_submissions_form_id ON form_submissions(form_id);
CREATE INDEX idx_form_submissions_patient_id ON form_submissions(patient_id);
CREATE INDEX idx_form_submissions_appointment_id ON form_submissions(appointment_id);
CREATE INDEX idx_form_submissions_readiness_pending
  ON form_submissions (created_at DESC, form_id)
  WHERE submission_source <> 'entry_flow' AND review_status = 'pending';
CREATE INDEX idx_form_submissions_patient_created ON form_submissions (patient_id, created_at DESC);
CREATE INDEX idx_form_submissions_appointment_created ON form_submissions (appointment_id, created_at DESC);

CREATE TABLE form_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  schema_snapshot JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'opened', 'completed')),
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_assignments_form_id ON form_assignments(form_id);
CREATE INDEX idx_form_assignments_patient_id ON form_assignments(patient_id);
CREATE INDEX idx_form_assignments_appointment_id ON form_assignments(appointment_id);
CREATE INDEX idx_form_assignments_token ON form_assignments(token);
CREATE INDEX idx_form_assignments_status ON form_assignments(status);
CREATE INDEX idx_form_assignments_patient_created ON form_assignments (patient_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 11. Workflow engine
-- ----------------------------------------------------------------------------

CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  direction workflow_direction NOT NULL,
  status workflow_template_status NOT NULL DEFAULT 'draft',
  terminal_type workflow_terminal_type NOT NULL DEFAULT 'run_sheet',
  at_risk_after_days INTEGER,
  overdue_after_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_templates_org_id ON workflow_templates(org_id);

CREATE TABLE workflow_action_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  action_type action_type NOT NULL,
  offset_minutes INTEGER NOT NULL DEFAULT 0,
  offset_direction TEXT NOT NULL DEFAULT 'before' CHECK (offset_direction IN ('before', 'after')),
  modality_filter appointment_modality,
  form_id UUID REFERENCES forms(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  precondition JSONB,
  parent_action_block_id UUID REFERENCES workflow_action_blocks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_action_blocks_template_id ON workflow_action_blocks(template_id);
CREATE INDEX idx_workflow_action_blocks_parent ON workflow_action_blocks(parent_action_block_id);
CREATE UNIQUE INDEX idx_one_intake_package_per_template
  ON workflow_action_blocks(template_id)
  WHERE action_type = 'intake_package' AND parent_action_block_id IS NULL;

CREATE TABLE type_workflow_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type_id UUID NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
  workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  direction workflow_direction NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT type_workflow_links_appointment_type_id_template_id_direction_key
    UNIQUE (appointment_type_id, workflow_template_id, direction)
);

CREATE INDEX idx_type_workflow_links_type_id ON type_workflow_links(appointment_type_id);
CREATE INDEX idx_type_workflow_links_template_id ON type_workflow_links(workflow_template_id);
CREATE UNIQUE INDEX one_pre_workflow_per_type
  ON type_workflow_links (appointment_type_id)
  WHERE direction = 'pre_appointment';

CREATE TABLE outcome_pathways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  workflow_template_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcome_pathways_org_id ON outcome_pathways(org_id);
CREATE INDEX idx_outcome_pathways_active ON outcome_pathways(org_id) WHERE archived_at IS NULL;

-- Deferred FK: sessions.outcome_pathway_id -> outcome_pathways(id)
ALTER TABLE sessions
  ADD CONSTRAINT sessions_outcome_pathway_id_fkey
  FOREIGN KEY (outcome_pathway_id) REFERENCES outcome_pathways(id);

CREATE TABLE appointment_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  direction workflow_direction NOT NULL,
  status workflow_run_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_runs_appointment_id ON appointment_workflow_runs(appointment_id);
CREATE INDEX idx_workflow_runs_template_id ON appointment_workflow_runs(workflow_template_id);
CREATE INDEX idx_workflow_runs_status ON appointment_workflow_runs(status);

CREATE TABLE appointment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  action_block_id UUID NOT NULL REFERENCES workflow_action_blocks(id) ON DELETE CASCADE,
  status action_status NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  result JSONB,
  workflow_run_id UUID REFERENCES appointment_workflow_runs(id) ON DELETE CASCADE,
  fired_at TIMESTAMPTZ,
  error_message TEXT,
  session_id UUID REFERENCES sessions(id),
  config JSONB,
  form_id UUID REFERENCES forms(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointment_actions_appointment_id ON appointment_actions(appointment_id);
CREATE INDEX idx_appointment_actions_status ON appointment_actions(status);
CREATE INDEX idx_appointment_actions_scheduled_for ON appointment_actions(scheduled_for);
CREATE INDEX idx_appointment_actions_workflow_run_id ON appointment_actions(workflow_run_id);
CREATE INDEX idx_appointment_actions_scan ON appointment_actions(status, scheduled_for);
CREATE INDEX idx_appointment_actions_session
  ON appointment_actions(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_appointment_actions_post_status
  ON appointment_actions(status, scheduled_for) WHERE session_id IS NOT NULL;

CREATE TABLE intake_package_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  journey_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  includes_card_capture BOOLEAN NOT NULL DEFAULT FALSE,
  includes_consent BOOLEAN NOT NULL DEFAULT FALSE,
  form_ids UUID[] NOT NULL DEFAULT '{}',
  card_captured_at TIMESTAMPTZ,
  consent_completed_at TIMESTAMPTZ,
  forms_completed JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_intake_package_journeys_appointment ON intake_package_journeys(appointment_id);
CREATE INDEX idx_intake_package_journeys_token ON intake_package_journeys(journey_token);
CREATE UNIQUE INDEX idx_one_journey_per_appointment ON intake_package_journeys(appointment_id);

-- ----------------------------------------------------------------------------
-- 12. Files library
-- ----------------------------------------------------------------------------

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  uploaded_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_org ON files(org_id);
CREATE INDEX idx_files_active ON files(org_id) WHERE archived_at IS NULL;

CREATE TABLE file_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  session_id UUID REFERENCES sessions(id),
  token TEXT UNIQUE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_file_deliveries_token ON file_deliveries(token);
CREATE INDEX idx_file_deliveries_file ON file_deliveries(file_id);

-- ----------------------------------------------------------------------------
-- 13. Onboarding: PMS & Stripe connections
-- ----------------------------------------------------------------------------

CREATE TABLE pms_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider pms_provider NOT NULL,
  status pms_connection_status NOT NULL,
  imported_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

CREATE TABLE stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  status stripe_connection_status NOT NULL,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

-- ----------------------------------------------------------------------------
-- 14. updated_at triggers (only on tables that carry an updated_at column)
-- ----------------------------------------------------------------------------

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organisations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointment_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workflow_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workflow_action_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON outcome_pathways FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointment_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON forms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON form_fields FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON form_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointment_workflow_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 15. RPC functions (no auth.* usage — kept as-is)
-- ----------------------------------------------------------------------------

-- configure_appointment_type (final form, migration 015)
CREATE OR REPLACE FUNCTION public.configure_appointment_type(
  p_org_id UUID,
  p_appointment_type_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_modality appointment_modality DEFAULT 'telehealth',
  p_default_fee_cents INTEGER DEFAULT 0,
  p_terminal_type workflow_terminal_type DEFAULT 'run_sheet',
  p_includes_card_capture BOOLEAN DEFAULT FALSE,
  p_includes_consent BOOLEAN DEFAULT FALSE,
  p_form_ids UUID[] DEFAULT '{}',
  p_reminders JSONB DEFAULT '[]',
  p_at_risk_after_days INTEGER DEFAULT NULL,
  p_overdue_after_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_appointment_type_id UUID;
  v_workflow_template_id UUID;
  v_link_id UUID;
  v_intake_block_id UUID;
  v_reminder JSONB;
  v_existing_reminder_ids UUID[];
  v_incoming_reminder_ids UUID[];
  v_reminder_id UUID;
  v_deleted_legacy_count INTEGER;
BEGIN
  IF p_appointment_type_id IS NOT NULL THEN
    UPDATE appointment_types SET
      name = COALESCE(p_name, name),
      duration_minutes = p_duration_minutes,
      modality = p_modality,
      default_fee_cents = COALESCE(p_default_fee_cents, default_fee_cents),
      updated_at = NOW()
    WHERE id = p_appointment_type_id AND org_id = p_org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Appointment type not found or does not belong to org';
    END IF;

    v_appointment_type_id := p_appointment_type_id;
  ELSE
    INSERT INTO appointment_types (org_id, name, duration_minutes, modality, default_fee_cents, source)
    VALUES (p_org_id, p_name, p_duration_minutes, p_modality, p_default_fee_cents, 'coviu')
    RETURNING id INTO v_appointment_type_id;
  END IF;

  SELECT twl.workflow_template_id INTO v_workflow_template_id
  FROM type_workflow_links twl
  WHERE twl.appointment_type_id = v_appointment_type_id
    AND twl.direction = 'pre_appointment';

  IF v_workflow_template_id IS NOT NULL THEN
    UPDATE workflow_templates SET
      terminal_type = p_terminal_type,
      at_risk_after_days = p_at_risk_after_days,
      overdue_after_days = p_overdue_after_days,
      status = 'published',
      updated_at = NOW()
    WHERE id = v_workflow_template_id;
  ELSE
    INSERT INTO workflow_templates (org_id, name, description, direction, status, terminal_type, at_risk_after_days, overdue_after_days)
    VALUES (
      p_org_id,
      p_name || ' - Pre-appointment',
      'Auto-generated pre-appointment workflow for ' || p_name,
      'pre_appointment',
      'published',
      p_terminal_type,
      p_at_risk_after_days,
      p_overdue_after_days
    )
    RETURNING id INTO v_workflow_template_id;
  END IF;

  INSERT INTO type_workflow_links (appointment_type_id, workflow_template_id, direction)
  VALUES (v_appointment_type_id, v_workflow_template_id, 'pre_appointment')
  ON CONFLICT (appointment_type_id) WHERE direction = 'pre_appointment'
  DO NOTHING;

  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type NOT IN ('intake_package', 'intake_reminder', 'add_to_runsheet');
  GET DIAGNOSTICS v_deleted_legacy_count = ROW_COUNT;

  SELECT id INTO v_intake_block_id
  FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_package'
    AND parent_action_block_id IS NULL;

  IF v_intake_block_id IS NOT NULL THEN
    UPDATE workflow_action_blocks SET
      config = jsonb_build_object(
        'includes_card_capture', p_includes_card_capture,
        'includes_consent', p_includes_consent,
        'form_ids', to_jsonb(p_form_ids)
      )
    WHERE id = v_intake_block_id;
  ELSE
    INSERT INTO workflow_action_blocks (
      template_id, action_type, offset_minutes, offset_direction,
      sort_order, config, parent_action_block_id
    )
    VALUES (
      v_workflow_template_id, 'intake_package', 0, 'before', 0,
      jsonb_build_object(
        'includes_card_capture', p_includes_card_capture,
        'includes_consent', p_includes_consent,
        'form_ids', to_jsonb(p_form_ids)
      ),
      NULL
    )
    RETURNING id INTO v_intake_block_id;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_existing_reminder_ids
  FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_reminder'
    AND parent_action_block_id = v_intake_block_id;

  v_existing_reminder_ids := COALESCE(v_existing_reminder_ids, '{}');
  v_incoming_reminder_ids := '{}';

  FOR v_reminder IN SELECT * FROM jsonb_array_elements(p_reminders)
  LOOP
    v_reminder_id := (v_reminder->>'id')::UUID;

    IF v_reminder_id IS NOT NULL AND v_reminder_id = ANY(v_existing_reminder_ids) THEN
      UPDATE workflow_action_blocks SET
        offset_minutes = ((v_reminder->>'offset_days')::INTEGER) * 24 * 60,
        config = jsonb_build_object(
          'offset_days', (v_reminder->>'offset_days')::INTEGER,
          'message_body', v_reminder->>'message_body'
        )
      WHERE id = v_reminder_id;

      v_incoming_reminder_ids := v_incoming_reminder_ids || v_reminder_id;
    ELSE
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        sort_order, config, parent_action_block_id
      )
      VALUES (
        v_workflow_template_id, 'intake_reminder',
        ((v_reminder->>'offset_days')::INTEGER) * 24 * 60, 'after',
        10 + (SELECT COUNT(*) FROM jsonb_array_elements(p_reminders)),
        jsonb_build_object(
          'offset_days', (v_reminder->>'offset_days')::INTEGER,
          'message_body', v_reminder->>'message_body'
        ),
        v_intake_block_id
      )
      RETURNING id INTO v_reminder_id;

      v_incoming_reminder_ids := v_incoming_reminder_ids || v_reminder_id;
    END IF;
  END LOOP;

  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_reminder'
    AND parent_action_block_id = v_intake_block_id
    AND id != ALL(v_incoming_reminder_ids);

  IF p_terminal_type = 'run_sheet' THEN
    INSERT INTO workflow_action_blocks (
      template_id, action_type, offset_minutes, offset_direction,
      sort_order, config, parent_action_block_id
    )
    SELECT
      v_workflow_template_id, 'add_to_runsheet', 0, 'before', 100, '{}'::JSONB, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_action_blocks
      WHERE template_id = v_workflow_template_id
        AND action_type = 'add_to_runsheet'
    );
  ELSE
    DELETE FROM workflow_action_blocks
    WHERE template_id = v_workflow_template_id
      AND action_type = 'add_to_runsheet';
  END IF;

  RETURN jsonb_build_object(
    'appointment_type_id', v_appointment_type_id,
    'workflow_template_id', v_workflow_template_id,
    'intake_block_id', v_intake_block_id,
    'legacy_blocks_removed', v_deleted_legacy_count
  );
END;
$$;

-- configure_outcome_pathway (migration 016)
CREATE OR REPLACE FUNCTION public.configure_outcome_pathway(
  p_org_id UUID,
  p_pathway_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_blocks JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pathway_id UUID;
  v_workflow_template_id UUID;
  v_block JSONB;
  v_block_id UUID;
  v_existing_block_ids UUID[];
  v_incoming_block_ids UUID[];
BEGIN
  IF p_pathway_id IS NOT NULL THEN
    UPDATE outcome_pathways SET
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      updated_at = NOW()
    WHERE id = p_pathway_id AND org_id = p_org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Outcome pathway not found or does not belong to org';
    END IF;

    v_pathway_id := p_pathway_id;

    SELECT workflow_template_id INTO v_workflow_template_id
    FROM outcome_pathways
    WHERE id = v_pathway_id;
  ELSE
    INSERT INTO outcome_pathways (org_id, name, description)
    VALUES (p_org_id, p_name, p_description)
    RETURNING id INTO v_pathway_id;
  END IF;

  IF v_workflow_template_id IS NOT NULL THEN
    UPDATE workflow_templates SET
      name = COALESCE(p_name, name) || ' - Post-appointment',
      status = 'published',
      updated_at = NOW()
    WHERE id = v_workflow_template_id;
  ELSE
    INSERT INTO workflow_templates (org_id, name, description, direction, status)
    VALUES (
      p_org_id,
      COALESCE(p_name, 'Pathway') || ' - Post-appointment',
      'Auto-generated post-appointment workflow for ' || COALESCE(p_name, 'pathway'),
      'post_appointment',
      'published'
    )
    RETURNING id INTO v_workflow_template_id;

    UPDATE outcome_pathways
    SET workflow_template_id = v_workflow_template_id
    WHERE id = v_pathway_id;
  END IF;

  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_existing_block_ids
  FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id;

  v_incoming_block_ids := '{}';

  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks)
  LOOP
    v_block_id := (v_block->>'id')::UUID;

    IF v_block_id IS NOT NULL AND v_block_id = ANY(v_existing_block_ids) THEN
      UPDATE workflow_action_blocks SET
        action_type = (v_block->>'action_type')::action_type,
        offset_minutes = (v_block->>'offset_minutes')::INTEGER,
        offset_direction = 'after',
        form_id = (v_block->>'form_id')::UUID,
        config = COALESCE(v_block->'config', '{}'::JSONB),
        sort_order = (v_block->>'sort_order')::INTEGER,
        updated_at = NOW()
      WHERE id = v_block_id;

      v_incoming_block_ids := v_incoming_block_ids || v_block_id;
    ELSE
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        form_id, config, sort_order
      )
      VALUES (
        v_workflow_template_id,
        (v_block->>'action_type')::action_type,
        (v_block->>'offset_minutes')::INTEGER,
        'after',
        (v_block->>'form_id')::UUID,
        COALESCE(v_block->'config', '{}'::JSONB),
        (v_block->>'sort_order')::INTEGER
      )
      RETURNING id INTO v_block_id;

      v_incoming_block_ids := v_incoming_block_ids || v_block_id;
    END IF;
  END LOOP;

  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND id != ALL(v_incoming_block_ids);

  RETURN jsonb_build_object(
    'pathway_id', v_pathway_id,
    'workflow_template_id', v_workflow_template_id,
    'blocks_synced', array_length(v_incoming_block_ids, 1)
  );
END;
$$;

-- confirm_outcome_pathway (final form, migration 018 — on-demand stub appt support)
CREATE OR REPLACE FUNCTION public.confirm_outcome_pathway(
  p_session_id UUID,
  p_pathway_id UUID,
  p_actions JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_ended_at TIMESTAMPTZ;
  v_appointment_id UUID;
  v_workflow_template_id UUID;
  v_workflow_run_id UUID;
  v_action JSONB;
  v_scheduled_for TIMESTAMPTZ;
  v_offset_minutes INTEGER;
  v_action_count INTEGER := 0;
  v_room_id UUID;
  v_location_id UUID;
  v_org_id UUID;
  v_patient_id UUID;
BEGIN
  v_session_ended_at := NOW();

  UPDATE sessions SET
    session_ended_at = v_session_ended_at,
    outcome_pathway_id = p_pathway_id,
    status = 'done',
    updated_at = NOW()
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  SELECT appointment_id, room_id, location_id
  INTO v_appointment_id, v_room_id, v_location_id
  FROM sessions
  WHERE id = p_session_id;

  IF v_appointment_id IS NULL THEN
    SELECT org_id INTO v_org_id FROM locations WHERE id = v_location_id;

    SELECT patient_id INTO v_patient_id
    FROM session_participants
    WHERE session_id = p_session_id
    LIMIT 1;

    INSERT INTO appointments (
      org_id, location_id, room_id, patient_id, scheduled_at, status
    )
    VALUES (
      v_org_id, v_location_id, v_room_id, v_patient_id, v_session_ended_at, 'completed'
    )
    RETURNING id INTO v_appointment_id;

    UPDATE sessions SET appointment_id = v_appointment_id
    WHERE id = p_session_id;
  END IF;

  SELECT workflow_template_id INTO v_workflow_template_id
  FROM outcome_pathways
  WHERE id = p_pathway_id;

  IF v_workflow_template_id IS NULL THEN
    RAISE EXCEPTION 'Pathway has no linked workflow template: %', p_pathway_id;
  END IF;

  INSERT INTO appointment_workflow_runs (
    appointment_id, workflow_template_id, direction, status
  )
  VALUES (
    v_appointment_id, v_workflow_template_id, 'post_appointment', 'active'
  )
  RETURNING id INTO v_workflow_run_id;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    v_offset_minutes := (v_action->>'offset_minutes')::INTEGER;

    IF v_offset_minutes = 0 THEN
      v_scheduled_for := v_session_ended_at + INTERVAL '1 minute';
    ELSE
      v_scheduled_for := v_session_ended_at + (v_offset_minutes || ' minutes')::INTERVAL;
    END IF;

    INSERT INTO appointment_actions (
      appointment_id, session_id, action_block_id, workflow_run_id,
      status, scheduled_for, config, form_id
    )
    VALUES (
      v_appointment_id, p_session_id, (v_action->>'action_block_id')::UUID,
      v_workflow_run_id, 'scheduled', v_scheduled_for,
      COALESCE(v_action->'config', '{}'::JSONB), (v_action->>'form_id')::UUID
    );

    v_action_count := v_action_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'workflow_run_id', v_workflow_run_id,
    'action_count', v_action_count,
    'session_ended_at', v_session_ended_at
  );
END;
$$;

-- save_workflow_blocks (migration 022)
CREATE OR REPLACE FUNCTION public.save_workflow_blocks(
  p_template_id UUID,
  p_blocks JSONB,
  p_deleted_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_block JSONB;
  v_block_id UUID;
  v_existing_offset INTEGER;
  v_new_block_ids UUID[] := '{}';
  v_new_block_offsets INTEGER[] := '{}';
  v_retimed_block_ids UUID[] := '{}';
  v_retimed_offsets INTEGER[] := '{}';
  v_deleted_present UUID[];
  v_run RECORD;
  v_scheduled_for TIMESTAMPTZ;
  v_offset INTEGER;
  v_i INTEGER;
  v_inserted_id UUID;
  v_runs_recalculated INTEGER := 0;
BEGIN
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_deleted_present
  FROM workflow_action_blocks
  WHERE template_id = p_template_id
    AND id = ANY(p_deleted_ids);

  IF array_length(v_deleted_present, 1) > 0 THEN
    DELETE FROM workflow_action_blocks
    WHERE template_id = p_template_id
      AND id = ANY(v_deleted_present);
  END IF;

  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks)
  LOOP
    v_block_id := NULLIF(v_block->>'id', '')::UUID;
    v_offset := (v_block->>'offset_minutes')::INTEGER;

    IF v_block_id IS NOT NULL THEN
      SELECT offset_minutes INTO v_existing_offset
      FROM workflow_action_blocks
      WHERE id = v_block_id AND template_id = p_template_id;

      IF FOUND THEN
        UPDATE workflow_action_blocks SET
          action_type = (v_block->>'action_type')::action_type,
          offset_minutes = v_offset,
          offset_direction = v_block->>'offset_direction',
          config = COALESCE(v_block->'config', '{}'::JSONB),
          precondition = v_block->'precondition',
          form_id = NULLIF(v_block->>'form_id', '')::UUID,
          sort_order = (v_block->>'sort_order')::INTEGER
        WHERE id = v_block_id AND template_id = p_template_id;

        IF v_existing_offset IS DISTINCT FROM v_offset THEN
          v_retimed_block_ids := v_retimed_block_ids || v_block_id;
          v_retimed_offsets := v_retimed_offsets || v_offset;
        END IF;
      END IF;
    ELSE
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        config, precondition, form_id, sort_order
      )
      VALUES (
        p_template_id,
        (v_block->>'action_type')::action_type,
        v_offset,
        v_block->>'offset_direction',
        COALESCE(v_block->'config', '{}'::JSONB),
        v_block->'precondition',
        NULLIF(v_block->>'form_id', '')::UUID,
        (v_block->>'sort_order')::INTEGER
      )
      RETURNING id INTO v_inserted_id;

      v_new_block_ids := v_new_block_ids || v_inserted_id;
      v_new_block_offsets := v_new_block_offsets || v_offset;
    END IF;
  END LOOP;

  FOR v_run IN
    SELECT r.id AS run_id, r.appointment_id, r.direction, a.scheduled_at
    FROM appointment_workflow_runs r
    JOIN appointments a ON a.id = r.appointment_id
    WHERE r.workflow_template_id = p_template_id
      AND r.status = 'active'
  LOOP
    v_runs_recalculated := v_runs_recalculated + 1;

    IF array_length(v_deleted_present, 1) > 0 THEN
      UPDATE appointment_actions SET status = 'cancelled'
      WHERE workflow_run_id = v_run.run_id
        AND action_block_id = ANY(v_deleted_present)
        AND status = 'scheduled';
    END IF;

    IF array_length(v_new_block_ids, 1) > 0 THEN
      FOR v_i IN 1 .. array_length(v_new_block_ids, 1)
      LOOP
        IF v_run.direction = 'pre_appointment' THEN
          v_scheduled_for := v_run.scheduled_at - (v_new_block_offsets[v_i] || ' minutes')::INTERVAL;
        ELSE
          v_scheduled_for := v_run.scheduled_at + (v_new_block_offsets[v_i] || ' minutes')::INTERVAL;
        END IF;

        INSERT INTO appointment_actions (
          appointment_id, action_block_id, workflow_run_id, status, scheduled_for
        )
        VALUES (
          v_run.appointment_id, v_new_block_ids[v_i], v_run.run_id, 'scheduled', v_scheduled_for
        );
      END LOOP;
    END IF;

    IF array_length(v_retimed_block_ids, 1) > 0 THEN
      FOR v_i IN 1 .. array_length(v_retimed_block_ids, 1)
      LOOP
        IF v_run.direction = 'pre_appointment' THEN
          v_scheduled_for := v_run.scheduled_at - (v_retimed_offsets[v_i] || ' minutes')::INTERVAL;
        ELSE
          v_scheduled_for := v_run.scheduled_at + (v_retimed_offsets[v_i] || ' minutes')::INTERVAL;
        END IF;

        UPDATE appointment_actions SET scheduled_for = v_scheduled_for
        WHERE workflow_run_id = v_run.run_id
          AND action_block_id = v_retimed_block_ids[v_i]
          AND status = 'scheduled';
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', COALESCE(array_length(v_deleted_present, 1), 0),
    'inserted', COALESCE(array_length(v_new_block_ids, 1), 0),
    'retimed', COALESCE(array_length(v_retimed_block_ids, 1), 0),
    'in_flight_recalculated', v_runs_recalculated
  );
END;
$$;
