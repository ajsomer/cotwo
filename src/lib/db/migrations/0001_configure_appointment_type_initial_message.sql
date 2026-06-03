-- 0001_configure_appointment_type_initial_message.sql
--
-- Hand-authored migration (PL/pgSQL function — not managed by drizzle-kit
-- generate/pull, which only track table schema). Applied against the Neon
-- `cotwo` database.
--
-- Adds a configurable initial intake SMS to the Workflow Builder. Redefines
-- configure_appointment_type with a new trailing param `p_initial_message`,
-- stored as `message_body` on the intake_package block config (alongside the
-- existing intake_reminder message_body fields). The initial intake SMS handler
-- reads this so the text the patient receives is what the user configured.
--
-- Appending the param creates a NEW function signature in Postgres (functions
-- are identified by name + arg types), so we DROP the prior 13-arg overload
-- first to avoid two overloads — the configure route calls positionally and
-- must resolve to exactly one function.
--
-- Idempotent: the DROP uses IF EXISTS; CREATE OR REPLACE is safe to re-run.

DROP FUNCTION IF EXISTS public.configure_appointment_type(
  uuid, uuid, text, integer, appointment_modality, integer, workflow_terminal_type,
  boolean, boolean, uuid[], jsonb, integer, integer
);

CREATE OR REPLACE FUNCTION public.configure_appointment_type(
  p_org_id UUID,
  p_appointment_type_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT NULL,
  p_modality appointment_modality DEFAULT 'telehealth',
  p_default_fee_cents INTEGER DEFAULT 0,
  p_terminal_type workflow_terminal_type DEFAULT 'run_sheet',
  p_includes_card_capture BOOLEAN DEFAULT FALSE,
  p_includes_consent BOOLEAN DEFAULT FALSE,
  p_form_ids UUID[] DEFAULT '{}',
  p_reminders JSONB DEFAULT '[]',
  p_at_risk_after_days INTEGER DEFAULT NULL,
  p_overdue_after_days INTEGER DEFAULT NULL,
  p_initial_message TEXT DEFAULT NULL
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
  v_deleted_legacy_count INTEGER;
BEGIN
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

  INSERT INTO type_workflow_links (appointment_type_id, workflow_template_id, direction)
  VALUES (v_appointment_type_id, v_workflow_template_id, 'pre_appointment')
  ON CONFLICT (appointment_type_id) WHERE direction = 'pre_appointment'
  DO NOTHING;

  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type NOT IN ('intake_package', 'intake_reminder', 'add_to_runsheet');
  GET DIAGNOSTICS v_deleted_legacy_count = ROW_COUNT;

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
        'form_ids', to_jsonb(p_form_ids),
        'message_body', p_initial_message
      )
    WHERE id = v_intake_block_id;
  ELSE
    INSERT INTO workflow_action_blocks (
      template_id, action_type, offset_minutes, offset_direction,
      sort_order, config, parent_action_block_id
    )
    VALUES (
      v_workflow_template_id, 'intake_package', 0, 'before', 0,
      jsonb_build_object(
        'includes_card_capture', p_includes_card_capture,
        'includes_consent', p_includes_consent,
        'form_ids', to_jsonb(p_form_ids),
        'message_body', p_initial_message
      ),
      NULL
    )
    RETURNING id INTO v_intake_block_id;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_existing_reminder_ids
  FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_reminder'
    AND parent_action_block_id = v_intake_block_id;

  v_existing_reminder_ids := COALESCE(v_existing_reminder_ids, '{}');
  v_incoming_reminder_ids := '{}';

  FOR v_reminder IN SELECT * FROM jsonb_array_elements(p_reminders)
  LOOP
    v_reminder_id := (v_reminder->>'id')::UUID;

    IF v_reminder_id IS NOT NULL AND v_reminder_id = ANY(v_existing_reminder_ids) THEN
      UPDATE workflow_action_blocks SET
        offset_minutes = ((v_reminder->>'offset_days')::INTEGER) * 24 * 60,
        config = jsonb_build_object(
          'offset_days', (v_reminder->>'offset_days')::INTEGER,
          'message_body', v_reminder->>'message_body'
        )
      WHERE id = v_reminder_id;

      v_incoming_reminder_ids := v_incoming_reminder_ids || v_reminder_id;
    ELSE
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        sort_order, config, parent_action_block_id
      )
      VALUES (
        v_workflow_template_id, 'intake_reminder',
        ((v_reminder->>'offset_days')::INTEGER) * 24 * 60, 'after',
        10 + (SELECT COUNT(*) FROM jsonb_array_elements(p_reminders)),
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

  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND action_type = 'intake_reminder'
    AND parent_action_block_id = v_intake_block_id
    AND id != ALL(v_incoming_reminder_ids);

  IF p_terminal_type = 'run_sheet' THEN
    INSERT INTO workflow_action_blocks (
      template_id, action_type, offset_minutes, offset_direction,
      sort_order, config, parent_action_block_id
    )
    SELECT
      v_workflow_template_id, 'add_to_runsheet', 0, 'before', 100, '{}'::JSONB, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_action_blocks
      WHERE template_id = v_workflow_template_id
        AND action_type = 'add_to_runsheet'
    );
  ELSE
    DELETE FROM workflow_action_blocks
    WHERE template_id = v_workflow_template_id
      AND action_type = 'add_to_runsheet';
  END IF;

  RETURN jsonb_build_object(
    'appointment_type_id', v_appointment_type_id,
    'workflow_template_id', v_workflow_template_id,
    'intake_block_id', v_intake_block_id,
    'legacy_blocks_removed', v_deleted_legacy_count
  );
END;
$$;
