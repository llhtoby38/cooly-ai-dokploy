-- 030_add_client_key_to_images.sql
-- Adds client_key, created_at, and completed_at columns to images table for complete session tracking

DO $$
BEGIN
  -- Add client_key column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='images' AND column_name='client_key'
  ) THEN
    ALTER TABLE images ADD COLUMN client_key TEXT NULL;
  END IF;

  -- Add created_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='images' AND column_name='created_at'
  ) THEN
    ALTER TABLE images ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;

  -- Add completed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='images' AND column_name='completed_at'
  ) THEN
    ALTER TABLE images ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE NULL;
  END IF;
END $$;

-- Add index for efficient lookups by client_key
CREATE INDEX IF NOT EXISTS idx_images_client_key
  ON images(client_key);

-- Add index for efficient lookups by session_id and client_key
CREATE INDEX IF NOT EXISTS idx_images_session_client_key
  ON images(session_id, client_key);

-- Add index for efficient lookups by created_at
CREATE INDEX IF NOT EXISTS idx_images_created_at
  ON images(created_at);

-- Add index for efficient lookups by completed_at
CREATE INDEX IF NOT EXISTS idx_images_completed_at
  ON images(completed_at);
