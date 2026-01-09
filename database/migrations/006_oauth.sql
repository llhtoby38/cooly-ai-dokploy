-- 006_oauth.sql
-- Add columns needed to support Google OAuth sign-in and allow null password hashes

-- Allow password-less accounts created via OAuth
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

-- Provider linkage fields (safe to re-run)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS provider_email TEXT,
  ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;


