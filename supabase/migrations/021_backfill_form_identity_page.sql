-- ----------------------------------------------------------------------------
-- 021: Backfill the locked identity page into every existing form's schema.
--
-- Every standalone form now has a baked-in `__patient_identity` page at the
-- start of its schema, written into the row at form creation. This migration
-- catches any pre-existing forms whose schema was created before that change.
-- Idempotent — runs only against forms whose schema doesn't already contain
-- the reserved page name.
-- See src/lib/survey/identity-page.ts for the canonical page shape.
-- ----------------------------------------------------------------------------

WITH identity_page AS (
  SELECT jsonb_build_object(
    'name', '__patient_identity',
    'title', 'Your details',
    'elements', jsonb_build_array(
      jsonb_build_object(
        'type', 'html',
        'name', '__identity_intro',
        'html', '<p style="margin:0 0 12px;font-size:14px;color:#8A8985">We need a few details so the clinic knows who you are.</p>'
      ),
      jsonb_build_object(
        'type', 'text',
        'name', '__identity_first_name',
        'title', 'First name',
        'isRequired', true
      ),
      jsonb_build_object(
        'type', 'text',
        'name', '__identity_last_name',
        'title', 'Last name',
        'isRequired', true
      ),
      jsonb_build_object(
        'type', 'text',
        'name', '__identity_date_of_birth',
        'inputType', 'date',
        'title', 'Date of birth',
        'isRequired', true
      ),
      jsonb_build_object(
        'type', 'text',
        'name', '__identity_email',
        'inputType', 'email',
        'title', 'Email',
        'isRequired', true
      )
    )
  ) AS page
)
UPDATE forms
SET schema = jsonb_set(
  CASE
    WHEN schema ? 'pages' THEN schema
    ELSE schema || jsonb_build_object('pages', '[]'::jsonb)
  END,
  '{pages}',
  (SELECT page FROM identity_page)::jsonb || COALESCE(schema->'pages', '[]'::jsonb)
)
WHERE NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(schema->'pages', '[]'::jsonb)) AS p
  WHERE p->>'name' = '__patient_identity'
);
