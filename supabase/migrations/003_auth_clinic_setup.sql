-- ============================================================================
-- Auth & Clinic Setup Migration
-- ============================================================================
-- Adds clinic_owner role, reinstates auth FK, creates user trigger,
-- and sets up org-logos storage bucket.

-- ----------------------------------------------------------------------------
-- 1. Add clinic_owner to user_role enum
-- ----------------------------------------------------------------------------

ALTER TYPE user_role ADD VALUE 'clinic_owner';

-- ----------------------------------------------------------------------------
-- 2. Clean up seed users that have no matching auth.users record,
--    then reinstate the FK from users.id → auth.users.id
-- ----------------------------------------------------------------------------

DELETE FROM users WHERE id NOT IN (SELECT id FROM auth.users);

ALTER TABLE users ALTER COLUMN id DROP DEFAULT;

ALTER TABLE users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 3. Auto-create users record when a new auth user signs up
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. Org-logos storage bucket (public read, authenticated upload)
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Public read org logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');

-- Authenticated users can upload
CREATE POLICY "Authenticated upload org logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'org-logos'
    AND auth.role() = 'authenticated'
  );

-- Authenticated users can update their uploads
CREATE POLICY "Authenticated update org logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'org-logos'
    AND auth.role() = 'authenticated'
  );
