-- 029_add_client_key_to_sessions.sql
-- Adds client_key column to generation_sessions for frontend-backend session matching

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='client_key'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN client_key TEXT NULL;
  END IF;
END $$;

-- Add index for efficient lookups by client_key
CREATE INDEX IF NOT EXISTS idx_generation_sessions_client_key
  ON generation_sessions(client_key);

-- Add index for efficient lookups by user_id and client_key
CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_client_key
  ON generation_sessions(user_id, client_key);
