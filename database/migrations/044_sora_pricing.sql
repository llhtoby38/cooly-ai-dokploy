-- Add credit_cost to sora_video_sessions if missing and create pricing reference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sora_video_sessions' AND column_name='credit_cost'
  ) THEN
    ALTER TABLE sora_video_sessions ADD COLUMN credit_cost INTEGER NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sora_video_pricing') THEN
    CREATE TABLE sora_video_pricing (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_key TEXT NOT NULL,
      resolution TEXT NOT NULL,
      price_per_second NUMERIC(10, 4) NOT NULL,
      credits_per_second INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (model_key, resolution)
    );
  END IF;
END $$;

-- Ensure credits_per_second exists even if table was created before this migration version
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sora_video_pricing') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sora_video_pricing' AND column_name='credits_per_second'
    ) THEN
      ALTER TABLE sora_video_pricing ADD COLUMN credits_per_second INTEGER NOT NULL DEFAULT 0;
    END IF;
  END IF;
END $$;

-- Seed baseline pricing (can be adjusted in DB)
INSERT INTO sora_video_pricing (model_key, resolution, price_per_second, credits_per_second)
VALUES
  ('sora-2', '720p', 0.10, 10),
  ('sora-2-pro', '720p', 0.30, 30),
  ('sora-2-pro', '1080p', 0.50, 50)
ON CONFLICT (model_key, resolution) DO NOTHING;

-- Backfill credits_per_second from price_per_second when missing
UPDATE sora_video_pricing
SET credits_per_second = ROUND(price_per_second * 100)::int
WHERE credits_per_second IS NULL OR credits_per_second = 0;


