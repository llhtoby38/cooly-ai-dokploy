-- 015_seedance_ref_image.sql
-- Add reference image URL column for video_generation_sessions (used by Seedance)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='ref_image_url'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN ref_image_url TEXT NULL;
  END IF;
END $$;


