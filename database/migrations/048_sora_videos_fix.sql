-- Ensure sora_videos has expected columns used by API (original_url, b2_filename, b2_url, file_size)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sora_videos') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_videos' AND column_name='original_url'
    ) THEN
      ALTER TABLE sora_videos ADD COLUMN original_url TEXT NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_videos' AND column_name='b2_filename'
    ) THEN
      ALTER TABLE sora_videos ADD COLUMN b2_filename TEXT NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_videos' AND column_name='b2_url'
    ) THEN
      ALTER TABLE sora_videos ADD COLUMN b2_url TEXT NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_videos' AND column_name='file_size'
    ) THEN
      ALTER TABLE sora_videos ADD COLUMN file_size INTEGER NULL;
    END IF;
  END IF;
END $$;


