-- Add provider_status to sora_video_sessions to persist provider lifecycle state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sora_video_sessions' AND column_name = 'provider_status'
  ) THEN
    ALTER TABLE sora_video_sessions ADD COLUMN provider_status TEXT NULL;
  END IF;
END $$;

-- Optional index to query recent states efficiently
CREATE INDEX IF NOT EXISTS idx_sora_sessions_provider_status_created
  ON sora_video_sessions(provider_status, created_at DESC);


