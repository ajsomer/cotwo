-- ============================================================================
-- Patient Entry Flow Migration
-- ============================================================================
-- Adds phone_verifications table for application-level OTP,
-- verified_at to patient_phone_numbers, and invite_sent to sessions.

-- ----------------------------------------------------------------------------
-- 1. Phone verifications table (application-level OTP, not Supabase Auth)
-- ----------------------------------------------------------------------------

CREATE TABLE phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_phone_verifications_phone ON phone_verifications(phone_number);
CREATE INDEX idx_phone_verifications_session ON phone_verifications(session_id);

-- No RLS on phone_verifications — patient-facing routes use service role client.

-- ----------------------------------------------------------------------------
-- 2. Add verified_at to patient_phone_numbers
-- ----------------------------------------------------------------------------

ALTER TABLE patient_phone_numbers
  ADD COLUMN verified_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 3. Add invite_sent to sessions (for T-10 min invite SMS tracking)
-- ----------------------------------------------------------------------------

ALTER TABLE sessions
  ADD COLUMN invite_sent BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN invite_sent_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 4. Add prep_completed tracking to sessions (for returning patient flow)
-- ----------------------------------------------------------------------------

ALTER TABLE sessions
  ADD COLUMN prep_completed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN card_captured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN device_tested BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 5. Enable realtime on phone_verifications for OTP flow
-- ----------------------------------------------------------------------------

-- phone_verifications does not need realtime — OTP is request/response.

-- ----------------------------------------------------------------------------
-- 6. Add realtime for payment_methods (card capture updates run sheet)
-- ----------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE payment_methods;
