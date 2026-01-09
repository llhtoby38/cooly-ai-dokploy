-- Ensure sora_videos has b2_url and backfill from legacy url column if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sora_videos') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_videos' AND column_name='b2_url'
    ) THEN
      ALTER TABLE sora_videos ADD COLUMN b2_url TEXT NULL;
    END IF;
    -- Backfill from legacy column name if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_videos' AND column_name='url'
    ) THEN
      UPDATE sora_videos SET b2_url = COALESCE(b2_url, url);
    END IF;
  END IF;
END $$;


