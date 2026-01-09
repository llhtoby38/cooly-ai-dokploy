-- Add USD cost columns to session tables

-- Images (Seedream 3/4) sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='per_image_usd'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN per_image_usd NUMERIC(10,6) NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='session_usd'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN session_usd NUMERIC(12,6) NULL;
  END IF;
END $$;

-- Videos (Seedance) sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='token_usd_per_k'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN token_usd_per_k NUMERIC(10,6) NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='session_usd'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN session_usd NUMERIC(12,6) NULL;
  END IF;
END $$;


