-- 006_video_tables.sql
-- Ensure tables for video generation exist and are compatible with URL-only storage

-- Create video_generation_sessions if it doesn't exist
CREATE TABLE IF NOT EXISTS video_generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT,
  aspect_ratio TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  task_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Helpful index for history queries
CREATE INDEX IF NOT EXISTS idx_video_sessions_user_created
  ON video_generation_sessions(user_id, created_at DESC);

-- Create videos table if it doesn't exist
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES video_generation_sessions(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  filename TEXT NULL,
  local_path TEXT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful index for join
CREATE INDEX IF NOT EXISTS idx_videos_session_id ON videos(session_id);

-- Add optional HD URL column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='videos' AND column_name='hd_url'
  ) THEN
    ALTER TABLE videos ADD COLUMN hd_url TEXT NULL;
  END IF;
END $$;

-- Ensure generation_sessions includes model, status, completed_at for image flows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='model'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN model TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='status'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN status TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='completed_at'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN completed_at TIMESTAMPTZ NULL;
  END IF;
END $$;

-- Make sure URL-only storage works even if older columns had NOT NULL constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='videos' AND column_name='filename'
  ) THEN
    EXECUTE 'ALTER TABLE videos ALTER COLUMN filename DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='videos' AND column_name='local_path'
  ) THEN
    EXECUTE 'ALTER TABLE videos ALTER COLUMN local_path DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='videos' AND column_name='file_size'
  ) THEN
    EXECUTE 'ALTER TABLE videos ALTER COLUMN file_size SET DEFAULT 0';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='videos' AND column_name='original_url'
  ) THEN
    EXECUTE 'ALTER TABLE videos ALTER COLUMN original_url SET NOT NULL';
  END IF;
END $$;


