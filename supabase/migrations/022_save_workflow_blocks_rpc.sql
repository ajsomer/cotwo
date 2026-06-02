-- 022_save_workflow_blocks_rpc.sql
--
-- Makes the bulk action-block save atomic. Previously the route at
-- /api/workflows/[id]/blocks ran delete → update → insert → in-flight
-- recalculation as a sequence of separate service-role calls with a
-- `-- BEGIN TRANSACTION` comment but NO real transaction. A failure partway
-- left blocks/actions partially updated with no rollback.
--
-- This RPC runs the whole save inside one plpgsql function (a single
-- transaction): a failure anywhere rolls the entire save back.
--
-- Depends on: 016_post_appointment_workflows.sql (workflow_action_blocks,
-- appointment_workflow_runs, appointment_actions).

CREATE OR REPLACE FUNCTION public.save_workflow_blocks(
  p_template_id UUID,
  p_blocks JSONB,        -- array of { id?, action_type, offset_minutes,
                         --            offset_direction, config, precondition,
                         --            form_id?, sort_order }
  p_deleted_ids UUID[]   -- ids the client removed
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_block JSONB;
  v_block_id UUID;
  v_existing_offset INTEGER;
  v_new_block_ids UUID[] := '{}';     -- ids inserted this call (need new actions)
  v_new_block_offsets INTEGER[] := '{}';
  v_retimed_block_ids UUID[] := '{}'; -- existing ids whose offset changed
  v_retimed_offsets INTEGER[] := '{}';
  v_deleted_present UUID[];
  v_run RECORD;
  v_scheduled_for TIMESTAMPTZ;
  v_offset INTEGER;
  v_i INTEGER;
  v_inserted_id UUID;
  v_runs_recalculated INTEGER := 0;
BEGIN
  -- Only act on deleted ids that actually belong to this template.
  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_deleted_present
  FROM workflow_action_blocks
  WHERE template_id = p_template_id
    AND id = ANY(p_deleted_ids);

  -- 1. Delete removed blocks.
  IF array_length(v_deleted_present, 1) > 0 THEN
    DELETE FROM workflow_action_blocks
    WHERE template_id = p_template_id
      AND id = ANY(v_deleted_present);
  END IF;

  -- 2/3. Update existing blocks; insert new ones. Track which were retimed
  --      (offset changed) and which are brand new — both drive in-flight
  --      recalculation below.
  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks)
  LOOP
    v_block_id := NULLIF(v_block->>'id', '')::UUID;
    v_offset := (v_block->>'offset_minutes')::INTEGER;

    IF v_block_id IS NOT NULL THEN
      -- Existing block (only if it belongs to this template).
      SELECT offset_minutes INTO v_existing_offset
      FROM workflow_action_blocks
      WHERE id = v_block_id AND template_id = p_template_id;

      IF FOUND THEN
        UPDATE workflow_action_blocks SET
          action_type = (v_block->>'action_type')::action_type,
          offset_minutes = v_offset,
          offset_direction = v_block->>'offset_direction',
          config = COALESCE(v_block->'config', '{}'::JSONB),
          precondition = v_block->'precondition',
          form_id = NULLIF(v_block->>'form_id', '')::UUID,
          sort_order = (v_block->>'sort_order')::INTEGER
        WHERE id = v_block_id AND template_id = p_template_id;

        IF v_existing_offset IS DISTINCT FROM v_offset THEN
          v_retimed_block_ids := v_retimed_block_ids || v_block_id;
          v_retimed_offsets := v_retimed_offsets || v_offset;
        END IF;
      END IF;
    ELSE
      -- New block.
      INSERT INTO workflow_action_blocks (
        template_id, action_type, offset_minutes, offset_direction,
        config, precondition, form_id, sort_order
      )
      VALUES (
        p_template_id,
        (v_block->>'action_type')::action_type,
        v_offset,
        v_block->>'offset_direction',
        COALESCE(v_block->'config', '{}'::JSONB),
        v_block->'precondition',
        NULLIF(v_block->>'form_id', '')::UUID,
        (v_block->>'sort_order')::INTEGER
      )
      RETURNING id INTO v_inserted_id;

      v_new_block_ids := v_new_block_ids || v_inserted_id;
      v_new_block_offsets := v_new_block_offsets || v_offset;
    END IF;
  END LOOP;

  -- 4. Recalculate in-flight runs for this template.
  FOR v_run IN
    SELECT r.id AS run_id, r.appointment_id, r.direction, a.scheduled_at
    FROM appointment_workflow_runs r
    JOIN appointments a ON a.id = r.appointment_id
    WHERE r.workflow_template_id = p_template_id
      AND r.status = 'active'
  LOOP
    v_runs_recalculated := v_runs_recalculated + 1;

    -- 4a. Cancel scheduled actions for deleted blocks.
    IF array_length(v_deleted_present, 1) > 0 THEN
      UPDATE appointment_actions SET status = 'cancelled'
      WHERE workflow_run_id = v_run.run_id
        AND action_block_id = ANY(v_deleted_present)
        AND status = 'scheduled';
    END IF;

    -- 4b. Schedule actions for newly inserted blocks.
    IF array_length(v_new_block_ids, 1) > 0 THEN
      FOR v_i IN 1 .. array_length(v_new_block_ids, 1)
      LOOP
        IF v_run.direction = 'pre_appointment' THEN
          v_scheduled_for := v_run.scheduled_at - (v_new_block_offsets[v_i] || ' minutes')::INTERVAL;
        ELSE
          v_scheduled_for := v_run.scheduled_at + (v_new_block_offsets[v_i] || ' minutes')::INTERVAL;
        END IF;

        INSERT INTO appointment_actions (
          appointment_id, action_block_id, workflow_run_id, status, scheduled_for
        )
        VALUES (
          v_run.appointment_id, v_new_block_ids[v_i], v_run.run_id,
          'scheduled', v_scheduled_for
        );
      END LOOP;
    END IF;

    -- 4c. Retime scheduled actions for blocks whose offset changed.
    IF array_length(v_retimed_block_ids, 1) > 0 THEN
      FOR v_i IN 1 .. array_length(v_retimed_block_ids, 1)
      LOOP
        IF v_run.direction = 'pre_appointment' THEN
          v_scheduled_for := v_run.scheduled_at - (v_retimed_offsets[v_i] || ' minutes')::INTERVAL;
        ELSE
          v_scheduled_for := v_run.scheduled_at + (v_retimed_offsets[v_i] || ' minutes')::INTERVAL;
        END IF;

        UPDATE appointment_actions SET scheduled_for = v_scheduled_for
        WHERE workflow_run_id = v_run.run_id
          AND action_block_id = v_retimed_block_ids[v_i]
          AND status = 'scheduled';
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', COALESCE(array_length(v_deleted_present, 1), 0),
    'inserted', COALESCE(array_length(v_new_block_ids, 1), 0),
    'retimed', COALESCE(array_length(v_retimed_block_ids, 1), 0),
    'in_flight_recalculated', v_runs_recalculated
  );
END;
$$;
