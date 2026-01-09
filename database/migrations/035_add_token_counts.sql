-- Add explicit token counters to session tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='completion_tokens'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN completion_tokens BIGINT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='total_tokens'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN total_tokens BIGINT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='completion_tokens'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN completion_tokens BIGINT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='total_tokens'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN total_tokens BIGINT NULL;
  END IF;
END $$;


