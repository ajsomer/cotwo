-- ============================================================================
-- 016_post_appointment_workflows.sql
--
-- Post-appointment workflow engine support.
--
-- Changes:
--   1. Add 'task' to action_type enum
--   2. Add archived_at to outcome_pathways (soft delete)
--   3. Add outcome_pathway_id to sessions
--   4. Add session_id, resolved_at, resolved_by, resolution_note to appointment_actions
--   5. Indexes for post-appointment queries
--   6. configure_outcome_pathway() RPC (editor save)
--   7. confirm_outcome_pathway() RPC (Process flow atomic write)
--
-- IMPORTANT: ALTER TYPE ADD VALUE cannot be used in the same transaction as
-- rows that reference the new value. Seed data using action_type = 'task'
-- must go in seed.sql, not this migration.
-- ============================================================================


-- ============================================================================
-- 1. Add 'task' to action_type enum
-- ============================================================================

ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'task';


-- ============================================================================
-- 2. Add archived_at to outcome_pathways
-- ============================================================================

ALTER TABLE outcome_pathways ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;


-- ============================================================================
-- 3. Add outcome_pathway_id to sessions
-- ============================================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS outcome_pathway_id UUID REFERENCES outcome_pathways(id);


-- ============================================================================
-- 4. Add post-appointment columns to appointment_actions
-- ============================================================================

-- Links post-appointment actions to their originating session.
-- NULL for pre-appointment actions. This is the partition key: session_id IS NOT NULL = post.
ALTER TABLE appointment_actions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id);

-- Config snapshot: full resolved config JSONB at instantiation time.
-- For post-appointment, this is the source of truth (not workflow_action_blocks.config).
-- NULL for pre-appointment actions (which read config from workflow_action_blocks).
ALTER TABLE appointment_actions ADD COLUMN IF NOT EXISTS config JSONB;

-- Form reference for deliver_form actions (stored directly, not inside config).
-- NULL for non-form actions and pre-appointment actions.
ALTER TABLE appointment_actions ADD COLUMN IF NOT EXISTS form_id UUID REFERENCES forms(id);

-- Task resolution fields
ALTER TABLE appointment_actions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE appointment_actions ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);
ALTER TABLE appointment_actions ADD COLUMN IF NOT EXISTS resolution_note TEXT;


-- ============================================================================
-- 5. Indexes
-- ============================================================================

-- Engine dispatch: find post-appointment actions by session
CREATE INDEX IF NOT EXISTS idx_appointment_actions_session
  ON appointment_actions(session_id)
  WHERE session_id IS NOT NULL;

-- Readiness dashboard: post-appointment actions by status + scheduled time
CREATE INDEX IF NOT EXISTS idx_appointment_actions_post_status
  ON appointment_actions(status, scheduled_for)
  WHERE session_id IS NOT NULL;

-- Outcome pathway lookup: active (non-archived) pathways per org
CREATE INDEX IF NOT EXISTS idx_outcome_pathways_active
  ON outcome_pathways(org_id)
  WHERE archived_at IS NULL;


-- ============================================================================
-- 6. configure_outcome_pathway() RPC
--
-- Atomic multi-table save for the pathway editor. Mirrors
-- configure_appointment_type() from migration 014.
--
-- Handles both create (new pathway) and update (existing) in one call.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.configure_outcome_pathway(
  p_org_id UUID,
  p_pathway_id UUID DEFAULT NULL,  -- NULL = create new
  p_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  -- Action blocks: JSONB array of objects, each with:
  --   id (uuid or null for new), action_type, offset_minutes,
  --   form_id (uuid or null), config (jsonb), sort_order (int)
  p_blocks JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pathway_id UUID;
  v_workflow_template_id UUID;
  v_block JSONB;
  v_block_id UUID;
  v_existing_block_ids UUID[];
  v_incoming_block_ids UUID[];
BEGIN
  -- =========================================================================
  -- Step 1: Upsert outcome_pathways row
  -- =========================================================================
  IF p_pathway_id IS NOT NULL THEN
    UPDATE outcome_pathways SET
      name = COALESCE(p_name, name),
      description = COALESCE(p_description, description),
      updated_at = NOW()
    WHERE id = p_pathway_id AND org_id = p_org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Outcome pathway not found or does not belong to org';
    END IF;

    v_pathway_id := p_pathway_id;

    -- Get existing template
    SELECT workflow_template_id INTO v_workflow_template_id
    FROM outcome_pathways
    WHERE id = v_pathway_id;
  ELSE
    INSERT INTO outcome_pathways (org_id, name, description)
    VALUES (p_org_id, p_name, p_description)
    RETURNING id INTO v_pathway_id;
  END IF;

  -- =========================================================================
  -- Step 2: Upsert workflow_templates row
  -- =========================================================================
  IF v_workflow_template_id IS NOT NULL THEN
    UPDATE workflow_templates SET
      name = COALESCE(p_name, name) || ' - Post-appointment',
      status = 'published',
      updated_at = NOW()
    WHERE id = v_workflow_template_id;
  ELSE
    INSERT INTO workflow_templates (org_id, name, description, direction, status)
    VALUES (
      p_org_id,
      COALESCE(p_name, 'Pathway') || ' - Post-appointment',
      'Auto-generated post-appointment workflow for ' || COALESCE(p_name, 'pathway'),
      'post_appointment',
      'published'
    )
    RETURNING id INTO v_workflow_template_id;

    -- Link template to pathway
    UPDATE outcome_pathways
    SET workflow_template_id = v_workflow_template_id
    WHERE id = v_pathway_id;
  END IF;

  -- =========================================================================
  -- Step 3: Sync workflow_action_blocks
  -- =========================================================================
  -- Collect existing block IDs for this template
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_existing_block_ids
  FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id;

  v_incoming_block_ids := '{}';

  -- Upsert each incoming block
  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks)
  LOOP
    v_block_id := (v_block->>'id')::UUID;

    IF v_block_id IS NOT NULL AND v_block_id = ANY(v_existing_block_ids) THEN
      -- Update existing block
      UPDATE workflow_action_blocks SET
        action_type = (v_block->>'action_type')::action_type,
        offset_minutes = (v_block->>'offset_minutes')::INTEGER,
        offset_direction = 'after',
        form_id = (v_block->>'form_id')::UUID,
        config = COALESCE(v_block->'config', '{}'::JSONB),
        sort_order = (v_block->>'sort_order')::INTEGER,
        updated_at = NOW()
      WHERE id = v_block_id;

      v_incoming_block_ids := v_incoming_block_ids || v_block_id;
    ELSE
      -- Create new block
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        form_id, config, sort_order
      )
      VALUES (
        v_workflow_template_id,
        (v_block->>'action_type')::action_type,
        (v_block->>'offset_minutes')::INTEGER,
        'after',
        (v_block->>'form_id')::UUID,
        COALESCE(v_block->'config', '{}'::JSONB),
        (v_block->>'sort_order')::INTEGER
      )
      RETURNING id INTO v_block_id;

      v_incoming_block_ids := v_incoming_block_ids || v_block_id;
    END IF;
  END LOOP;

  -- Delete blocks that are no longer in the incoming set
  DELETE FROM workflow_action_blocks
  WHERE template_id = v_workflow_template_id
    AND id != ALL(v_incoming_block_ids);

  -- =========================================================================
  -- Return
  -- =========================================================================
  RETURN jsonb_build_object(
    'pathway_id', v_pathway_id,
    'workflow_template_id', v_workflow_template_id,
    'blocks_synced', array_length(v_incoming_block_ids, 1)
  );
END;
$$;


-- ============================================================================
-- 7. confirm_outcome_pathway() RPC
--
-- Atomic write for the Process flow confirmation. Called when the receptionist
-- selects a pathway, customises actions, and clicks Confirm.
--
-- In a single transaction:
--   - Sets session_ended_at, outcome_pathway_id, status=done on sessions
--   - Creates appointment_workflow_runs row
--   - Creates appointment_actions rows with config snapshots
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_outcome_pathway(
  p_session_id UUID,
  p_pathway_id UUID,
  -- Actions: JSONB array of objects, each with:
  --   action_block_id (uuid), action_type (text), offset_minutes (int),
  --   config (jsonb - full resolved snapshot), form_id (uuid or null)
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
  SELECT appointment_id INTO v_appointment_id
  FROM sessions
  WHERE id = p_session_id;

  IF v_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Session has no linked appointment: %', p_session_id;
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
