-- Soft-delete support for users; allow re-registering same email after deletion

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Drop the old global unique constraint on email (name is typically users_email_key)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'u' AND conname = 'users_email_key'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_email_key;
  END IF;
END $$;

-- Create partial unique index: only one active (non-deleted) row per email
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_active
ON users(email)
WHERE deleted_at IS NULL;

-- Helpful index for filtering non-deleted
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);


