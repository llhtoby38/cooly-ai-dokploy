-- Add token_usage JSONB columns to session tables to store provider usage per request
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='token_usage'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN token_usage JSONB NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='token_usage'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN token_usage JSONB NULL;
  END IF;
END $$;

-- Optional: GIN indexes for analytics (safe to skip if not needed)
CREATE INDEX IF NOT EXISTS idx_generation_sessions_token_usage ON generation_sessions USING GIN (token_usage);
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_token_usage ON video_generation_sessions USING GIN (token_usage);


