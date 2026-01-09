-- Add client_key column to video_generation_sessions for frontend-backend session matching (Seedance)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='client_key'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN client_key TEXT NULL;
  END IF;
END $$;

-- Index for lookups by client_key
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_client_key
  ON video_generation_sessions(client_key);

-- Composite index for per-user lookups by client_key
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_user_client_key
  ON video_generation_sessions(user_id, client_key);


