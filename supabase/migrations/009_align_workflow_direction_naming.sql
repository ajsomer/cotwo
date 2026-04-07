-- 009_align_workflow_direction_naming.sql
-- Aligns type_workflow_links.phase with the workflow_direction enum used by
-- workflow_templates.direction. After this migration, the entire codebase uses
-- a single convention for the pre/post workflow concept:
--   workflow_direction enum: 'pre_appointment' / 'post_appointment'
--
-- Before: type_workflow_links.phase TEXT CHECK ('pre', 'post')
-- After:  type_workflow_links.direction workflow_direction ('pre_appointment', 'post_appointment')

-- ============================================================================
-- 1. Drop the existing unique constraint and CHECK constraint on phase
-- ============================================================================

-- Resolve constraint names dynamically via pg_constraint to avoid dependence
-- on Postgres auto-naming (which truncates long names unpredictably).

-- Drop the UNIQUE constraint on (appointment_type_id, workflow_template_id, phase)
DO $$
DECLARE
  _constraint_name TEXT;
BEGIN
  SELECT c.conname INTO _constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'type_workflow_links'::regclass
    AND c.contype = 'u'
    AND a.attname = 'phase'
  LIMIT 1;

  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE type_workflow_links DROP CONSTRAINT %I', _constraint_name);
  END IF;
END $$;

-- Drop the CHECK constraint on phase (phase IN ('pre', 'post'))
DO $$
DECLARE
  _constraint_name TEXT;
BEGIN
  SELECT c.conname INTO _constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'type_workflow_links'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%phase%'
  LIMIT 1;

  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE type_workflow_links DROP CONSTRAINT %I', _constraint_name);
  END IF;
END $$;

-- ============================================================================
-- 2. Update existing rows to use workflow_direction values
-- ============================================================================

UPDATE type_workflow_links SET phase = 'pre_appointment' WHERE phase = 'pre';
UPDATE type_workflow_links SET phase = 'post_appointment' WHERE phase = 'post';

-- ============================================================================
-- 3. Rename column from phase to direction
-- ============================================================================

ALTER TABLE type_workflow_links RENAME COLUMN phase TO direction;

-- ============================================================================
-- 4. Change column type from TEXT to workflow_direction enum
-- ============================================================================

ALTER TABLE type_workflow_links
  ALTER COLUMN direction TYPE workflow_direction USING direction::workflow_direction;

-- ============================================================================
-- 5. Recreate the unique constraint with the new column name
-- ============================================================================

ALTER TABLE type_workflow_links
  ADD CONSTRAINT type_workflow_links_appointment_type_id_template_id_direction_key
  UNIQUE (appointment_type_id, workflow_template_id, direction);

-- ============================================================================
-- 6. Update RLS policy that references this table
-- ============================================================================

-- The existing SELECT policy on type_workflow_links does not reference the phase
-- column, so no RLS changes are needed. The policy filters on appointment_type_id
-- only (see 001_initial_schema.sql line 624).
