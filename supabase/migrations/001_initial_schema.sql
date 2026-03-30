-- ============================================================================
-- Coviu Platform: Initial Schema Migration
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('practice_manager', 'receptionist', 'clinician');
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time');
CREATE TYPE room_type AS ENUM ('clinical', 'reception', 'shared', 'triage');
CREATE TYPE appointment_modality AS ENUM ('telehealth', 'in_person');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE session_status AS ENUM ('queued', 'waiting', 'checked_in', 'in_session', 'complete', 'done');
CREATE TYPE workflow_direction AS ENUM ('pre_appointment', 'post_appointment');
CREATE TYPE action_type AS ENUM ('send_sms', 'deliver_form', 'capture_card', 'send_reminder', 'send_nudge', 'send_session_link', 'send_resource', 'send_proms', 'send_rebooking_nudge');
CREATE TYPE action_status AS ENUM ('pending', 'sent', 'completed', 'failed', 'skipped');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded');
CREATE TYPE stripe_routing AS ENUM ('location', 'clinician');

-- ----------------------------------------------------------------------------
-- Org Hierarchy
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_location_id ON rooms(location_id);
CREATE INDEX idx_rooms_link_token ON rooms(link_token);

-- ----------------------------------------------------------------------------
-- Users & Staff Assignments
-- ----------------------------------------------------------------------------

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
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

-- Junction: which rooms a clinician is assigned to
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
-- Patients
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
-- Scheduling
-- ----------------------------------------------------------------------------

CREATE TABLE appointment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  modality appointment_modality NOT NULL DEFAULT 'telehealth',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  default_fee_cents INTEGER NOT NULL DEFAULT 0,
  pms_external_id TEXT,
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
  scheduled_at TIMESTAMPTZ NOT NULL,
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
-- Note: expression index on timestamptz::date requires immutable cast.
-- Using a simple composite index instead; the date filter will use scheduled_at range scan.
CREATE INDEX idx_appointments_location_scheduled ON appointments(location_id, scheduled_at);

-- ----------------------------------------------------------------------------
-- Sessions
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_appointment_id ON sessions(appointment_id);
CREATE INDEX idx_sessions_room_id ON sessions(room_id);
CREATE INDEX idx_sessions_location_id ON sessions(location_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_location_created ON sessions(location_id, created_at);
CREATE INDEX idx_sessions_entry_token ON sessions(entry_token);

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
-- Payments
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
-- Workflow Engine (Complete tier only)
-- ----------------------------------------------------------------------------

CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  direction workflow_direction NOT NULL,
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
  form_id UUID,
  config JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_action_blocks_template_id ON workflow_action_blocks(template_id);

CREATE TABLE type_workflow_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type_id UUID NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
  workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('pre', 'post')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(appointment_type_id, workflow_template_id, phase)
);

CREATE INDEX idx_type_workflow_links_type_id ON type_workflow_links(appointment_type_id);
CREATE INDEX idx_type_workflow_links_template_id ON type_workflow_links(workflow_template_id);

CREATE TABLE outcome_pathways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  workflow_template_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcome_pathways_org_id ON outcome_pathways(org_id);

CREATE TABLE appointment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  action_block_id UUID NOT NULL REFERENCES workflow_action_blocks(id) ON DELETE CASCADE,
  status action_status NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointment_actions_appointment_id ON appointment_actions(appointment_id);
CREATE INDEX idx_appointment_actions_status ON appointment_actions(status);
CREATE INDEX idx_appointment_actions_scheduled_for ON appointment_actions(scheduled_for);

-- ----------------------------------------------------------------------------
-- Forms (Complete tier only)
-- ----------------------------------------------------------------------------

CREATE TABLE forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_forms_org_id ON forms(org_id);

-- Add FK from workflow_action_blocks.form_id now that forms table exists
ALTER TABLE workflow_action_blocks
  ADD CONSTRAINT fk_workflow_action_blocks_form
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE SET NULL;

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_submissions_form_id ON form_submissions(form_id);
CREATE INDEX idx_form_submissions_patient_id ON form_submissions(patient_id);
CREATE INDEX idx_form_submissions_appointment_id ON form_submissions(appointment_id);

-- ----------------------------------------------------------------------------
-- Updated_at trigger function
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables with updated_at column
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

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinician_room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_action_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE type_workflow_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_pathways ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

-- Helper: get org IDs the current user belongs to (via staff_assignments -> locations -> organisations)
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT DISTINCT o.id
  FROM staff_assignments sa
  JOIN locations l ON sa.location_id = l.id
  JOIN organisations o ON l.org_id = o.id
  WHERE sa.user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get location IDs the current user is assigned to
CREATE OR REPLACE FUNCTION public.user_location_ids()
RETURNS SETOF UUID AS $$
  SELECT location_id
  FROM staff_assignments
  WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Organisations: staff can see their own org(s)
CREATE POLICY "Staff can view their organisations"
  ON organisations FOR SELECT
  USING (id IN (SELECT public.user_org_ids()));

-- Locations: staff can see locations in their org(s)
CREATE POLICY "Staff can view locations in their org"
  ON locations FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

-- Rooms: staff can see rooms at locations in their org(s)
CREATE POLICY "Staff can view rooms in their org"
  ON rooms FOR SELECT
  USING (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Users: staff can see other users in their org(s)
CREATE POLICY "Staff can view users in their org"
  ON users FOR SELECT
  USING (id IN (
    SELECT sa.user_id FROM staff_assignments sa
    WHERE sa.location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    )
  ));

-- Staff assignments: staff can see assignments in their org(s)
CREATE POLICY "Staff can view assignments in their org"
  ON staff_assignments FOR SELECT
  USING (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Clinician room assignments: staff can see room assignments in their org(s)
CREATE POLICY "Staff can view room assignments in their org"
  ON clinician_room_assignments FOR SELECT
  USING (staff_assignment_id IN (
    SELECT id FROM staff_assignments WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    )
  ));

-- Patients: staff can see patients in their org(s)
CREATE POLICY "Staff can view patients in their org"
  ON patients FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can insert patients in their org"
  ON patients FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update patients in their org"
  ON patients FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

-- Patient phone numbers: follow patient access
CREATE POLICY "Staff can view patient phones in their org"
  ON patient_phone_numbers FOR SELECT
  USING (patient_id IN (
    SELECT id FROM patients WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can insert patient phones in their org"
  ON patient_phone_numbers FOR INSERT
  WITH CHECK (patient_id IN (
    SELECT id FROM patients WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Payment methods: follow patient access
CREATE POLICY "Staff can view payment methods in their org"
  ON payment_methods FOR SELECT
  USING (patient_id IN (
    SELECT id FROM patients WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can insert payment methods in their org"
  ON payment_methods FOR INSERT
  WITH CHECK (patient_id IN (
    SELECT id FROM patients WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Appointment types: org-scoped
CREATE POLICY "Staff can view appointment types in their org"
  ON appointment_types FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

-- Appointments: org-scoped
CREATE POLICY "Staff can view appointments in their org"
  ON appointments FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can insert appointments in their org"
  ON appointments FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update appointments in their org"
  ON appointments FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

-- Sessions: location-scoped
CREATE POLICY "Staff can view sessions at their locations"
  ON sessions FOR SELECT
  USING (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can insert sessions at their locations"
  ON sessions FOR INSERT
  WITH CHECK (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can update sessions at their locations"
  ON sessions FOR UPDATE
  USING (location_id IN (
    SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Session participants: follow session access
CREATE POLICY "Staff can view session participants"
  ON session_participants FOR SELECT
  USING (session_id IN (
    SELECT id FROM sessions WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    )
  ));

CREATE POLICY "Staff can insert session participants"
  ON session_participants FOR INSERT
  WITH CHECK (session_id IN (
    SELECT id FROM sessions WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    )
  ));

-- Payments: follow session/appointment access
CREATE POLICY "Staff can view payments in their org"
  ON payments FOR SELECT
  USING (
    appointment_id IN (SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids()))
    OR session_id IN (SELECT id FROM sessions WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    ))
  );

CREATE POLICY "Staff can insert payments in their org"
  ON payments FOR INSERT
  WITH CHECK (
    appointment_id IN (SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids()))
    OR session_id IN (SELECT id FROM sessions WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    ))
  );

CREATE POLICY "Staff can update payments in their org"
  ON payments FOR UPDATE
  USING (
    appointment_id IN (SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids()))
    OR session_id IN (SELECT id FROM sessions WHERE location_id IN (
      SELECT id FROM locations WHERE org_id IN (SELECT public.user_org_ids())
    ))
  );

-- Workflow templates: org-scoped
CREATE POLICY "Staff can view workflow templates in their org"
  ON workflow_templates FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

-- Workflow action blocks: follow template access
CREATE POLICY "Staff can view workflow action blocks in their org"
  ON workflow_action_blocks FOR SELECT
  USING (template_id IN (
    SELECT id FROM workflow_templates WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Type workflow links: follow appointment type access
CREATE POLICY "Staff can view type workflow links in their org"
  ON type_workflow_links FOR SELECT
  USING (appointment_type_id IN (
    SELECT id FROM appointment_types WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Outcome pathways: org-scoped
CREATE POLICY "Staff can view outcome pathways in their org"
  ON outcome_pathways FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

-- Appointment actions: follow appointment access
CREATE POLICY "Staff can view appointment actions in their org"
  ON appointment_actions FOR SELECT
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Forms: org-scoped
CREATE POLICY "Staff can view forms in their org"
  ON forms FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

-- Form fields: follow form access
CREATE POLICY "Staff can view form fields in their org"
  ON form_fields FOR SELECT
  USING (form_id IN (
    SELECT id FROM forms WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Form submissions: follow form access
CREATE POLICY "Staff can view form submissions in their org"
  ON form_submissions FOR SELECT
  USING (form_id IN (
    SELECT id FROM forms WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can insert form submissions in their org"
  ON form_submissions FOR INSERT
  WITH CHECK (form_id IN (
    SELECT id FROM forms WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- NOTE: Patient-facing routes (entry flow, waiting room, payment) do not use
-- staff auth context. They use phone OTP via Supabase Auth. For the prototype,
-- patient-facing server actions use the service_role key to bypass RLS.
-- Production would add token-scoped anonymous policies gated by entry_token.

-- ----------------------------------------------------------------------------
-- Realtime: enable for run sheet tables
-- ----------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE session_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
