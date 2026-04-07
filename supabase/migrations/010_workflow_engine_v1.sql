-- 010_workflow_engine_v1.sql
-- Augments existing workflow tables for the workflow engine spec (v1).
-- Retains all existing tables: workflow_templates, workflow_action_blocks,
-- type_workflow_links, outcome_pathways, appointment_actions.
-- Adds: appointment_workflow_runs, new columns, extended enums, write policies.
--
-- Depends on: 009_align_workflow_direction_naming.sql (type_workflow_links.direction
-- is now workflow_direction enum, not TEXT phase).

-- ============================================================================
-- 1. Extend enums
-- ============================================================================

-- action_type: add verify_contact and send_file (spec requirements).
-- Existing values kept: send_sms, deliver_form, capture_card, send_reminder,
-- send_nudge, send_session_link, send_resource, send_proms, send_rebooking_nudge.
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'verify_contact';
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'send_file';

-- action_status: add scheduled, opened, captured, verified, cancelled.
-- Existing values kept: pending, sent, completed, failed, skipped.
--
-- Convention: new workflow-engine-spawned action rows should use 'scheduled'
-- as the initial status. 'pending' is reserved for backwards compatibility
-- with pre-existing rows and non-workflow contexts (e.g. payment statuses
-- use 'pending' in their own enum). Engine implementation must follow this
-- convention — always INSERT with status = 'scheduled', never 'pending'.
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'opened';
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'captured';
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'verified';
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ============================================================================
-- 2. Add status to workflow_templates
-- ============================================================================

CREATE TYPE workflow_template_status AS ENUM ('draft', 'published', 'archived');

ALTER TABLE workflow_templates
  ADD COLUMN status workflow_template_status NOT NULL DEFAULT 'draft';

-- ============================================================================
-- 3. Add precondition to workflow_action_blocks
-- ============================================================================

-- JSONB column storing the per-action firing condition.
-- null = "Always fires" (default, no precondition).
--
-- NOTE: There is no DB-level validation of the precondition shape.
-- Application code is the source of truth for precondition structure.
-- The constraint is NOT enforced at the schema layer. Valid shapes:
--   null                                              → always fires
--   { "type": "form_not_completed", "form_id": "uuid" }
--   { "type": "card_not_on_file" }
--   { "type": "contact_not_verified" }
--   { "type": "no_future_appointment" }
-- Future developers: validate in application code, not here.
ALTER TABLE workflow_action_blocks
  ADD COLUMN precondition JSONB;

-- ============================================================================
-- 4. Add missing columns to appointment_types
-- ============================================================================

-- Source tracking for PMS-synced vs Coviu-created types.
-- When source = 'pms', name and duration_minutes are read-only in the UI
-- and overwritten on PMS sync. All other fields remain editable.
CREATE TYPE appointment_type_source AS ENUM ('coviu', 'pms');

ALTER TABLE appointment_types
  ADD COLUMN source appointment_type_source NOT NULL DEFAULT 'coviu',
  ADD COLUMN pms_provider TEXT;

-- ============================================================================
-- 5. Enforce one pre-workflow per appointment type
-- ============================================================================

-- Partial unique index: at most one row with direction = 'pre_appointment'
-- per appointment type. Post-workflows have no cardinality constraint
-- (multiple outcome pathways can link to different post-workflow templates).
--
-- Uses the workflow_direction enum value after 009_align_workflow_direction_naming.sql
-- converted type_workflow_links.direction from TEXT to workflow_direction.
CREATE UNIQUE INDEX one_pre_workflow_per_type
  ON type_workflow_links (appointment_type_id)
  WHERE direction = 'pre_appointment';

-- ============================================================================
-- 6. Create appointment_workflow_runs (parent execution tracker)
-- ============================================================================

-- Reuses workflow_direction enum ('pre_appointment' / 'post_appointment') for
-- the direction column, matching workflow_templates.direction and
-- type_workflow_links.direction. One enum, one set of values, everywhere.
CREATE TYPE workflow_run_status AS ENUM ('active', 'complete', 'cancelled');

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

-- ============================================================================
-- 7. Add workflow_run FK and execution columns to appointment_actions
-- ============================================================================

-- workflow_run_id is nullable: pre-existing rows predate workflow runs and will
-- have NULL. New rows created by the workflow engine will always reference a run.
ALTER TABLE appointment_actions
  ADD COLUMN workflow_run_id UUID REFERENCES appointment_workflow_runs(id) ON DELETE CASCADE,
  ADD COLUMN fired_at TIMESTAMPTZ,
  ADD COLUMN error_message TEXT;

CREATE INDEX idx_appointment_actions_workflow_run_id ON appointment_actions(workflow_run_id);

-- ============================================================================
-- 8. Triggers and RLS for appointment_workflow_runs
-- ============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointment_workflow_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE appointment_workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view workflow runs in their org"
  ON appointment_workflow_runs FOR SELECT
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can insert workflow runs in their org"
  ON appointment_workflow_runs FOR INSERT
  WITH CHECK (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can update workflow runs in their org"
  ON appointment_workflow_runs FOR UPDATE
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- ============================================================================
-- 9. Add missing write policies for existing workflow tables
-- ============================================================================

-- workflow_templates: need INSERT/UPDATE/DELETE for practice managers
CREATE POLICY "Staff can insert workflow templates in their org"
  ON workflow_templates FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update workflow templates in their org"
  ON workflow_templates FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can delete workflow templates in their org"
  ON workflow_templates FOR DELETE
  USING (org_id IN (SELECT public.user_org_ids()));

-- workflow_action_blocks: need INSERT/UPDATE/DELETE for editing workflows
CREATE POLICY "Staff can insert workflow action blocks in their org"
  ON workflow_action_blocks FOR INSERT
  WITH CHECK (template_id IN (
    SELECT id FROM workflow_templates WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can update workflow action blocks in their org"
  ON workflow_action_blocks FOR UPDATE
  USING (template_id IN (
    SELECT id FROM workflow_templates WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can delete workflow action blocks in their org"
  ON workflow_action_blocks FOR DELETE
  USING (template_id IN (
    SELECT id FROM workflow_templates WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- type_workflow_links: need INSERT/DELETE for attaching workflows to types
CREATE POLICY "Staff can insert type workflow links in their org"
  ON type_workflow_links FOR INSERT
  WITH CHECK (appointment_type_id IN (
    SELECT id FROM appointment_types WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can delete type workflow links in their org"
  ON type_workflow_links FOR DELETE
  USING (appointment_type_id IN (
    SELECT id FROM appointment_types WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- outcome_pathways: need INSERT/UPDATE/DELETE
CREATE POLICY "Staff can insert outcome pathways in their org"
  ON outcome_pathways FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update outcome pathways in their org"
  ON outcome_pathways FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can delete outcome pathways in their org"
  ON outcome_pathways FOR DELETE
  USING (org_id IN (SELECT public.user_org_ids()));

-- appointment_actions: need INSERT/UPDATE for engine execution
CREATE POLICY "Staff can insert appointment actions in their org"
  ON appointment_actions FOR INSERT
  WITH CHECK (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

CREATE POLICY "Staff can update appointment actions in their org"
  ON appointment_actions FOR UPDATE
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- appointment_types: need INSERT/UPDATE/DELETE for managing types
CREATE POLICY "Staff can insert appointment types in their org"
  ON appointment_types FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update appointment types in their org"
  ON appointment_types FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can delete appointment types in their org"
  ON appointment_types FOR DELETE
  USING (org_id IN (SELECT public.user_org_ids()));
