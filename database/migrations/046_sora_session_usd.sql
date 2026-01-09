-- Add USD columns to sora_video_sessions for pricing transparency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sora_video_sessions' AND column_name='per_second_usd'
  ) THEN
    ALTER TABLE sora_video_sessions ADD COLUMN per_second_usd NUMERIC(10, 4) NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sora_video_sessions' AND column_name='session_usd'
  ) THEN
    ALTER TABLE sora_video_sessions ADD COLUMN session_usd NUMERIC(10, 4) NULL;
  END IF;
END $$;


