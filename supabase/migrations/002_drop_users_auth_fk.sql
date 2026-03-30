-- Remove the FK from users.id → auth.users(id).
-- Prototype does not use Supabase Auth; the constraint blocks seeding.
-- Production team will reinstate when wiring up real auth.

ALTER TABLE users DROP CONSTRAINT users_id_fkey;
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
