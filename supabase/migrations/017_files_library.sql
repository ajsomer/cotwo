-- ============================================================================
-- Files library: org-scoped PDF uploads, delivery tracking, storage bucket
-- ============================================================================

-- Files table (soft-delete via archived_at)
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  uploaded_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_org ON files(org_id);
CREATE INDEX idx_files_active ON files(org_id) WHERE archived_at IS NULL;

-- File deliveries (tracking sends to patients)
CREATE TABLE file_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  session_id UUID REFERENCES sessions(id),
  token TEXT UNIQUE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_file_deliveries_token ON file_deliveries(token);
CREATE INDEX idx_file_deliveries_file ON file_deliveries(file_id);

-- ============================================================================
-- RLS: files
-- ============================================================================
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view files in their org"
  ON files FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can insert files in their org"
  ON files FOR INSERT
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Staff can update files in their org"
  ON files FOR UPDATE
  USING (org_id IN (SELECT public.user_org_ids()));

-- No DELETE policy — files are soft-deleted via archived_at UPDATE, never hard-deleted.

-- ============================================================================
-- RLS: file_deliveries
-- file_deliveries are created by the workflow engine (service role, bypasses RLS)
-- and read by staff for tracking. Patient access goes through the /api/files/view
-- route which uses the service role client.
-- ============================================================================
ALTER TABLE file_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view file deliveries for files in their org"
  ON file_deliveries FOR SELECT
  USING (file_id IN (
    SELECT id FROM files WHERE org_id IN (SELECT public.user_org_ids())
  ));

-- No INSERT policy needed. file_deliveries are created exclusively by the
-- workflow engine via the service role client, which bypasses RLS entirely.

-- ============================================================================
-- Supabase Storage bucket with server-enforced constraints
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-files',
  'clinic-files',
  false,
  10485760,                          -- 10 MB
  ARRAY['application/pdf']::text[]   -- PDF only
);

-- Storage policies: org-scoped via folder name convention ({org_id}/{file_id}.pdf)
CREATE POLICY "Staff can upload files to their org folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'clinic-files'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM organisations
      WHERE id IN (SELECT public.user_org_ids())
    )
  );

CREATE POLICY "Staff can read files in their org folder"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'clinic-files'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM organisations
      WHERE id IN (SELECT public.user_org_ids())
    )
  );

CREATE POLICY "Staff can delete files in their org folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'clinic-files'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM organisations
      WHERE id IN (SELECT public.user_org_ids())
    )
  );
