-- 013_intake_package_enums.sql
--
-- Enum additions for the Intake Package Workflow Engine (v2) spec.
-- Split into a separate migration because Postgres cannot use newly added
-- enum values within the same transaction (required for the partial unique
-- index and RPC function in 014).
--
-- Depends on: 012_action_status_transcribed.sql

-- New action types for the intake package model
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'intake_package';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'intake_reminder';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'add_to_runsheet';

-- 'dropped' status for reminders that don't fit short-lead bookings
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'dropped';
