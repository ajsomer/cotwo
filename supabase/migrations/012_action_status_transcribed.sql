-- 012_action_status_transcribed.sql
-- Adds 'transcribed' to action_status enum for the Readiness Dashboard form
-- completion handoff. In unintegrated Complete, when a patient completes a form
-- the receptionist manually copies the data into the clinic's PMS. The
-- 'transcribed' status marks that handoff as done.
--
-- Also adds appointment_actions to the Supabase Realtime publication so the
-- Readiness Dashboard can subscribe to action state changes in real time.

ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'transcribed';

ALTER PUBLICATION supabase_realtime ADD TABLE appointment_actions;
