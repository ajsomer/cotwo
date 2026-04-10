-- 014_intake_package_workflow.sql
--
-- Implements the Intake Package Workflow Engine (v2) spec.
-- Enum additions are in 013_intake_package_enums.sql (must commit separately
-- so Postgres can use the new enum values in this transaction).
--
-- Changes:
--   1. New workflow_terminal_type enum + terminal_type column on workflow_templates
--   2. At-risk/overdue threshold columns on workflow_templates
--   3. Parent-child relationship on workflow_action_blocks (for reminders)
--   4. Unique partial index: one intake_package per template
--   5. appointments.scheduled_at becomes nullable (for collection_only workflows)
--   6. New intake_package_journeys table
--   7. Appointments created_at index (for collection-only sorting)
--   8. RLS policies for intake_package_journeys
--   9. configure_appointment_type RPC function (atomic multi-table save)
--
-- Depends on: 013_intake_package_enums.sql

-- ============================================================================
-- 1. Terminal type on workflow_templates
-- ============================================================================

CREATE TYPE workflow_terminal_type AS ENUM ('run_sheet', 'collection_only');

ALTER TABLE workflow_templates
  ADD COLUMN terminal_type workflow_terminal_type NOT NULL DEFAULT 'run_sheet';

COMMENT ON COLUMN workflow_templates.terminal_type IS
  'run_sheet: workflow ends by creating a session on the run sheet. '
  'collection_only: workflow terminates when the intake package is complete, '
  'no session created. Determines whether add_to_runsheet action block exists.';

-- ============================================================================
-- 2. At-risk and overdue thresholds on workflow_templates
-- ============================================================================

ALTER TABLE workflow_templates
  ADD COLUMN at_risk_after_days INTEGER,
  ADD COLUMN overdue_after_days INTEGER;

COMMENT ON COLUMN workflow_templates.at_risk_after_days IS
  'Days after intake package sent. NULL = no configured threshold (fallback only).';
COMMENT ON COLUMN workflow_templates.overdue_after_days IS
  'Days after intake package sent. NULL = no configured threshold (fallback only). '
  'Must be > at_risk_after_days when both are set (enforced in application code).';

-- ============================================================================
-- 3. Parent-child relationship on workflow_action_blocks
-- ============================================================================

ALTER TABLE workflow_action_blocks
  ADD COLUMN parent_action_block_id UUID REFERENCES workflow_action_blocks(id) ON DELETE CASCADE;

CREATE INDEX idx_workflow_action_blocks_parent
  ON workflow_action_blocks(parent_action_block_id);

-- ============================================================================
-- 4. Unique partial index: one intake_package per template
-- ============================================================================

-- Enforces that each workflow template has at most one intake_package action
-- block. intake_reminder blocks have a parent and are excluded by the filter.
CREATE UNIQUE INDEX idx_one_intake_package_per_template
  ON workflow_action_blocks(template_id)
  WHERE action_type = 'intake_package' AND parent_action_block_id IS NULL;

-- ============================================================================
-- 5. appointments.scheduled_at becomes nullable
-- ============================================================================

ALTER TABLE appointments ALTER COLUMN scheduled_at DROP NOT NULL;

COMMENT ON COLUMN appointments.scheduled_at IS
  'NULL for appointments on collection_only workflows (no appointment date/time). '
  'Required for run_sheet workflows (enforced in application code, not DB constraint).';

-- ============================================================================
-- 6. intake_package_journeys table
-- ============================================================================

CREATE TABLE intake_package_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  journey_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  -- Valid statuses: 'in_progress', 'completed'
  includes_card_capture BOOLEAN NOT NULL DEFAULT FALSE,
  includes_consent BOOLEAN NOT NULL DEFAULT FALSE,
  form_ids UUID[] NOT NULL DEFAULT '{}',
  card_captured_at TIMESTAMPTZ,
  consent_completed_at TIMESTAMPTZ,
  forms_completed JSONB NOT NULL DEFAULT '{}',
  -- Shape: { "<form_uuid>": "<ISO timestamp>" }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

COMMENT ON COLUMN intake_package_journeys.patient_id IS
  'The verified patient identity — the person who tapped the link and was resolved '
  'via phone OTP. This is NOT a mirror of appointments.patient_id. It matters for '
  'multi-contact resolution: one phone number may map to multiple patients in the '
  'org, and this column captures who was actually selected at verification time.';

COMMENT ON COLUMN intake_package_journeys.status IS
  'in_progress: patient has not completed all items. '
  'completed: all configured items done. Flipped by application code, not trigger.';

CREATE INDEX idx_intake_package_journeys_appointment
  ON intake_package_journeys(appointment_id);

CREATE INDEX idx_intake_package_journeys_token
  ON intake_package_journeys(journey_token);

-- One journey per appointment (enforced at DB level)
CREATE UNIQUE INDEX idx_one_journey_per_appointment
  ON intake_package_journeys(appointment_id);

-- ============================================================================
-- 7. Appointments created_at index
-- ============================================================================

-- For collection-only appointment sorting on the readiness dashboard.
CREATE INDEX IF NOT EXISTS idx_appointments_created_at
  ON appointments(created_at);

-- ============================================================================
-- 8. RLS policies for intake_package_journeys
-- ============================================================================

ALTER TABLE intake_package_journeys ENABLE ROW LEVEL SECURITY;

-- Staff can view journeys for appointments in their org
CREATE POLICY "Staff can view intake package journeys in their org"
  ON intake_package_journeys FOR SELECT
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Staff can insert journeys (engine creates them via service role, but policy
-- is needed for non-service-role contexts)
CREATE POLICY "Staff can insert intake package journeys in their org"
  ON intake_package_journeys FOR INSERT
  WITH CHECK (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Staff can update journeys in their org (for completion status updates)
CREATE POLICY "Staff can update intake package journeys in their org"
  ON intake_package_journeys FOR UPDATE
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Staff can delete journeys in their org (cascade from appointment delete)
CREATE POLICY "Staff can delete intake package journeys in their org"
  ON intake_package_journeys FOR DELETE
  USING (appointment_id IN (
    SELECT id FROM appointments WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- Add to Supabase Realtime publication for dashboard live updates
ALTER PUBLICATION supabase_realtime ADD TABLE intake_package_journeys;

-- ============================================================================
-- 9. configure_appointment_type RPC function
-- ============================================================================

-- Atomic multi-table save for the appointment type configuration editor.
-- Handles both create (new appointment type) and update (existing) in one call.
-- All writes happen in a single transaction — if any step fails, everything
-- rolls back. No partial state.
--
-- Called from: POST /api/appointment-types/configure (Phase 6 of execution plan)

CREATE OR REPLACE FUNCTION public.configure_appointment_type(
  p_org_id UUID,
  p_appointment_type_id UUID DEFAULT NULL,  -- NULL = create new
  -- Details
  p_name TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_modality appointment_modality DEFAULT 'telehealth',
  p_default_fee_cents INTEGER DEFAULT 0,
  -- On completion
  p_terminal_type workflow_terminal_type DEFAULT 'run_sheet',
  -- Intake package
  p_includes_card_capture BOOLEAN DEFAULT FALSE,
  p_includes_consent BOOLEAN DEFAULT FALSE,
  p_form_ids UUID[] DEFAULT '{}',
  -- Reminders (JSONB array of objects: [{ "id": "uuid-or-null", "offset_days": 3, "message_body": "..." }])
  p_reminders JSONB DEFAULT '[]',
  -- Urgency
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
BEGIN
  -- =========================================================================
  -- Step 1: Upsert appointment_types row
  -- =========================================================================
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

  -- =========================================================================
  -- Step 2: Upsert workflow_templates row
  -- =========================================================================
  -- Find existing template via type_workflow_links
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

  -- =========================================================================
  -- Step 3: Upsert type_workflow_links row
  -- =========================================================================
  INSERT INTO type_workflow_links (appointment_type_id, workflow_template_id, direction)
  VALUES (v_appointment_type_id, v_workflow_template_id, 'pre_appointment')
  ON CONFLICT (appointment_type_id) WHERE direction = 'pre_appointment'
  DO NOTHING;
  -- The link already exists if we found v_workflow_template_id in step 2

  -- =========================================================================
  -- Step 4: Upsert intake_package action block
  -- =========================================================================
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
      v_workflow_template_id,
      'intake_package',
      0,
      'before',
      0,
      jsonb_build_object(
        'includes_card_capture', p_includes_card_capture,
        'includes_consent', p_includes_consent,
        'form_ids', to_jsonb(p_form_ids)
      ),
      NULL
    )
    RETURNING id INTO v_intake_block_id;
  END IF;

  -- =========================================================================
  -- Step 5: Sync intake_reminder action blocks
  -- =========================================================================
  -- Collect existing reminder IDs for this template
  SELECT ARRAY_AGG(id) INTO v_existing_reminder_ids
  FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_reminder'
    AND parent_action_block_id = v_intake_block_id;

  v_existing_reminder_ids := COALESCE(v_existing_reminder_ids, '{}');
  v_incoming_reminder_ids := '{}';

  -- Upsert each incoming reminder
  FOR v_reminder IN SELECT * FROM jsonb_array_elements(p_reminders)
  LOOP
    v_reminder_id := (v_reminder->>'id')::UUID;

    IF v_reminder_id IS NOT NULL AND v_reminder_id = ANY(v_existing_reminder_ids) THEN
      -- Update existing reminder
      UPDATE workflow_action_blocks SET
        offset_minutes = ((v_reminder->>'offset_days')::INTEGER) * 24 * 60,
        config = jsonb_build_object(
          'offset_days', (v_reminder->>'offset_days')::INTEGER,
          'message_body', v_reminder->>'message_body'
        )
      WHERE id = v_reminder_id;

      v_incoming_reminder_ids := v_incoming_reminder_ids || v_reminder_id;
    ELSE
      -- Create new reminder
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        sort_order, config, parent_action_block_id
      )
      VALUES (
        v_workflow_template_id,
        'intake_reminder',
        ((v_reminder->>'offset_days')::INTEGER) * 24 * 60,
        'after',  -- reminders fire after the intake package send time
        10 + (SELECT COUNT(*) FROM jsonb_array_elements(p_reminders)),  -- after intake_package (sort_order 0)
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

  -- Delete reminders that are no longer in the incoming set
  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_reminder'
    AND parent_action_block_id = v_intake_block_id
    AND id != ALL(v_incoming_reminder_ids);

  -- =========================================================================
  -- Step 6: Sync add_to_runsheet action block
  -- =========================================================================
  IF p_terminal_type = 'run_sheet' THEN
    -- Ensure exactly one add_to_runsheet block exists
    INSERT INTO workflow_action_blocks (
      template_id, action_type, offset_minutes, offset_direction,
      sort_order, config, parent_action_block_id
    )
    SELECT
      v_workflow_template_id,
      'add_to_runsheet',
      0,
      'before',
      100,  -- always last
      '{}'::JSONB,
      NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_action_blocks
      WHERE template_id = v_workflow_template_id
        AND action_type = 'add_to_runsheet'
    );
  ELSE
    -- Remove add_to_runsheet block if switching to collection_only
    DELETE FROM workflow_action_blocks
    WHERE template_id = v_workflow_template_id
      AND action_type = 'add_to_runsheet';
  END IF;

  -- =========================================================================
  -- Return
  -- =========================================================================
  RETURN jsonb_build_object(
    'appointment_type_id', v_appointment_type_id,
    'workflow_template_id', v_workflow_template_id,
    'intake_block_id', v_intake_block_id
  );
END;
$$;
