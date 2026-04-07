-- 011_action_status_firing.sql
-- Adds 'firing' to action_status enum for the claim pattern in the workflow
-- execution engine. When the daily scan picks up scheduled actions, it
-- atomically sets status to 'firing' before executing the handler. This
-- prevents double-firing if scans overlap.
--
-- Also adds a composite index on (status, scheduled_for) to support the
-- daily scan query: WHERE status = 'scheduled' AND scheduled_for <= NOW().

ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'firing';

CREATE INDEX idx_appointment_actions_scan
  ON appointment_actions(status, scheduled_for);
