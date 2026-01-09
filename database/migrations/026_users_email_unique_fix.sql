-- Make users email uniqueness compatible with soft delete and case-insensitive

-- Drop previous unique index/constraint variants if they exist
DROP INDEX IF EXISTS users_email_unique;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'u' AND conname = 'users_email_key'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_email_key;
  END IF;
END $$;

-- Partial unique index on lower(email) for active users only
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower_active
ON users ((lower(email)))
WHERE deleted_at IS NULL;


