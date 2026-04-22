-- ============================================================================
-- 018_ondemand_outcome_pathway.sql
--
-- Fix confirm_outcome_pathway() to support on-demand sessions (no appointment).
-- When the session has no appointment_id, auto-create a stub appointment using
-- the session's room, location, and patient so the existing workflow run /
-- readiness dashboard pipeline works unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_outcome_pathway(
  p_session_id UUID,
  p_pathway_id UUID,
  p_actions JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_ended_at TIMESTAMPTZ;
  v_appointment_id UUID;
  v_workflow_template_id UUID;
  v_workflow_run_id UUID;
  v_action JSONB;
  v_scheduled_for TIMESTAMPTZ;
  v_offset_minutes INTEGER;
  v_action_count INTEGER := 0;
  -- For on-demand stub appointment creation
  v_room_id UUID;
  v_location_id UUID;
  v_org_id UUID;
  v_patient_id UUID;
BEGIN
  -- =========================================================================
  -- Step 1: Update session — set ended_at, pathway, status
  -- =========================================================================
  v_session_ended_at := NOW();

  UPDATE sessions SET
    session_ended_at = v_session_ended_at,
    outcome_pathway_id = p_pathway_id,
    status = 'done',
    updated_at = NOW()
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  -- =========================================================================
  -- Step 2: Look up appointment_id from session
  -- =========================================================================
  SELECT appointment_id, room_id, location_id
  INTO v_appointment_id, v_room_id, v_location_id
  FROM sessions
  WHERE id = p_session_id;

  -- =========================================================================
  -- Step 2b: On-demand session — create a stub appointment
  -- =========================================================================
  IF v_appointment_id IS NULL THEN
    -- Resolve org_id from location
    SELECT org_id INTO v_org_id
    FROM locations
    WHERE id = v_location_id;

    -- Resolve patient from session_participants
    SELECT patient_id INTO v_patient_id
    FROM session_participants
    WHERE session_id = p_session_id
    LIMIT 1;

    INSERT INTO appointments (
      org_id, location_id, room_id, patient_id,
      scheduled_at, status
    )
    VALUES (
      v_org_id, v_location_id, v_room_id, v_patient_id,
      v_session_ended_at, 'completed'
    )
    RETURNING id INTO v_appointment_id;

    -- Link the session to the new appointment
    UPDATE sessions SET appointment_id = v_appointment_id
    WHERE id = p_session_id;
  END IF;

  -- =========================================================================
  -- Step 3: Look up workflow_template_id from pathway
  -- =========================================================================
  SELECT workflow_template_id INTO v_workflow_template_id
  FROM outcome_pathways
  WHERE id = p_pathway_id;

  IF v_workflow_template_id IS NULL THEN
    RAISE EXCEPTION 'Pathway has no linked workflow template: %', p_pathway_id;
  END IF;

  -- =========================================================================
  -- Step 4: Create appointment_workflow_runs row
  -- =========================================================================
  INSERT INTO appointment_workflow_runs (
    appointment_id, workflow_template_id, direction, status
  )
  VALUES (
    v_appointment_id,
    v_workflow_template_id,
    'post_appointment',
    'active'
  )
  RETURNING id INTO v_workflow_run_id;

  -- =========================================================================
  -- Step 5: Create appointment_actions rows
  -- =========================================================================
  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    v_offset_minutes := (v_action->>'offset_minutes')::INTEGER;

    -- Zero-offset buffer: add 1 minute for same-day actions
    IF v_offset_minutes = 0 THEN
      v_scheduled_for := v_session_ended_at + INTERVAL '1 minute';
    ELSE
      v_scheduled_for := v_session_ended_at + (v_offset_minutes || ' minutes')::INTERVAL;
    END IF;

    INSERT INTO appointment_actions (
      appointment_id,
      session_id,
      action_block_id,
      workflow_run_id,
      status,
      scheduled_for,
      config,
      form_id
    )
    VALUES (
      v_appointment_id,
      p_session_id,
      (v_action->>'action_block_id')::UUID,
      v_workflow_run_id,
      'scheduled',
      v_scheduled_for,
      COALESCE(v_action->'config', '{}'::JSONB),
      (v_action->>'form_id')::UUID
    );

    v_action_count := v_action_count + 1;
  END LOOP;

  -- =========================================================================
  -- Return
  -- =========================================================================
  RETURN jsonb_build_object(
    'workflow_run_id', v_workflow_run_id,
    'action_count', v_action_count,
    'session_ended_at', v_session_ended_at
  );
END;
$$;
