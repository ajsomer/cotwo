-- ----------------------------------------------------------------------------
-- 020: Standalone Forms
-- Forms become standalone objects with a public token. Submissions can be
-- created without an appointment, get reviewed via a state machine, and carry
-- a server-attributed source.
-- See docs/specs/standalone-forms-spec.md
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- forms: public token + rotation audit columns
-- ----------------------------------------------------------------------------

ALTER TABLE forms
  ADD COLUMN public_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text;

ALTER TABLE forms
  ADD COLUMN public_token_rotated_at TIMESTAMPTZ;

ALTER TABLE forms
  ADD COLUMN public_token_rotated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- form_submissions: source + review state machine
-- ----------------------------------------------------------------------------

ALTER TABLE form_submissions
  ADD COLUMN submission_source TEXT NOT NULL DEFAULT 'entry_flow'
    CHECK (submission_source IN ('entry_flow', 'standalone_public', 'standalone_sms', 'standalone_qr'));

ALTER TABLE form_submissions
  ADD COLUMN review_status TEXT;

-- review_status is set iff the submission is standalone.
ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_source_review_consistency
  CHECK (
    (submission_source = 'entry_flow' AND review_status IS NULL)
    OR
    (submission_source <> 'entry_flow' AND review_status IN ('pending', 'reviewed', 'archived'))
  );

-- Standalone submissions never attach to an appointment.
ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_standalone_no_appointment
  CHECK (submission_source = 'entry_flow' OR appointment_id IS NULL);

ALTER TABLE form_submissions
  ADD COLUMN reviewed_at TIMESTAMPTZ;

ALTER TABLE form_submissions
  ADD COLUMN reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- Indexes
-- The UNIQUE constraint on forms.public_token already creates an index.
-- Partial index for the Readiness inbox query: pending standalone submissions,
-- newest first, ordered for index walk during the per-form join to forms.
-- ----------------------------------------------------------------------------

CREATE INDEX idx_form_submissions_readiness_pending
  ON form_submissions (created_at DESC, form_id)
  WHERE submission_source <> 'entry_flow' AND review_status = 'pending';
