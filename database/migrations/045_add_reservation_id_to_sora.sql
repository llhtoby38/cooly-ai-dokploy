-- Add reservation_id to sora_video_sessions if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sora_video_sessions' AND column_name='reservation_id'
  ) THEN
    ALTER TABLE sora_video_sessions ADD COLUMN reservation_id UUID NULL;
  END IF;
END $$;


