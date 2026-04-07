-- ----------------------------------------------------------------------------
-- 007: Forms V1 — SurveyJS integration
-- Adds schema + status columns to forms, creates form_assignments table
-- ----------------------------------------------------------------------------

-- Add schema column (stores full SurveyJS JSON definition)
ALTER TABLE forms ADD COLUMN schema JSONB NOT NULL DEFAULT '{}';

-- Add status column (draft/published/archived lifecycle)
ALTER TABLE forms ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'published', 'archived'));

-- ----------------------------------------------------------------------------
-- Form assignments: tracks that a form was sent to a patient
-- ----------------------------------------------------------------------------

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

-- Updated_at trigger
CREATE TRIGGER set_updated_at BEFORE UPDATE ON form_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE form_assignments ENABLE ROW LEVEL SECURITY;

-- Form assignments: org-scoped via forms.org_id
CREATE POLICY "Staff can view form assignments in their org"
  ON form_assignments FOR SELECT
  USING (form_id IN (
    SELECT id FROM forms WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can insert form assignments in their org"
  ON form_assignments FOR INSERT
  WITH CHECK (form_id IN (
    SELECT id FROM forms WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can update form assignments in their org"
  ON form_assignments FOR UPDATE
  USING (form_id IN (
    SELECT id FROM forms WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Forms: add INSERT/UPDATE/DELETE policies (only SELECT exists from 001)
CREATE POLICY "Staff can insert forms in their org"
  ON forms FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update forms in their org"
  ON forms FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can delete forms in their org"
  ON forms FOR DELETE
  USING (org_id IN (SELECT public.user_org_ids()));
