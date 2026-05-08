-- PMS connections
CREATE TYPE pms_provider AS ENUM ('cliniko', 'halaxy', 'nookal', 'power_diary', 'gentu');
CREATE TYPE pms_connection_status AS ENUM ('connected', 'skipped', 'pending');

CREATE TABLE pms_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider pms_provider NOT NULL,
  status pms_connection_status NOT NULL,
  imported_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

-- Stripe connections (setup-step record, distinct from locations.stripe_account_id)
CREATE TYPE stripe_connection_status AS ENUM ('connected', 'skipped');

CREATE TABLE stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  status stripe_connection_status NOT NULL,
  stripe_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

-- Onboarding stage on users
CREATE TYPE onboarding_stage AS ENUM ('not_started', 'test_session_sent', 'call_active', 'call_completed');
ALTER TABLE users ADD COLUMN onboarding_stage onboarding_stage NOT NULL DEFAULT 'not_started';
ALTER TABLE users ADD COLUMN has_seen_patient_journey BOOLEAN NOT NULL DEFAULT false;

-- Onboarding demo flag on sessions
ALTER TABLE sessions ADD COLUMN is_onboarding_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_sessions_onboarding_demo ON sessions(is_onboarding_demo) WHERE is_onboarding_demo = true;

-- Platform demo flag on forms
ALTER TABLE forms ADD COLUMN is_platform_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_forms_platform_demo ON forms(org_id) WHERE is_platform_demo = false;

-- RLS: new tables scoped via staff_assignments → locations.org_id
ALTER TABLE pms_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read org pms_connections"
  ON pms_connections FOR SELECT
  USING (org_id IN (
    SELECT l.org_id FROM staff_assignments sa
    JOIN locations l ON l.id = sa.location_id
    WHERE sa.user_id = auth.uid()
  ));

CREATE POLICY "Staff can read org stripe_connections"
  ON stripe_connections FOR SELECT
  USING (org_id IN (
    SELECT l.org_id FROM staff_assignments sa
    JOIN locations l ON l.id = sa.location_id
    WHERE sa.user_id = auth.uid()
  ));
