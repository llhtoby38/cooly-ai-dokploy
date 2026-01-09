-- Drop NOT NULL on legacy 'url' column if present to avoid insert failures when unused
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sora_videos' AND column_name='url' AND is_nullable='NO'
  ) THEN
    ALTER TABLE sora_videos ALTER COLUMN url DROP NOT NULL;
  END IF;
END $$;


