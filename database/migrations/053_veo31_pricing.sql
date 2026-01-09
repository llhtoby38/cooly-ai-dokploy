-- Veo 3.1 dedicated pricing table (similar to Sora)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='veo31_video_pricing') THEN
    CREATE TABLE veo31_video_pricing (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_key TEXT NOT NULL,
      resolution TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      price_per_second NUMERIC(10, 4) NOT NULL,
      credits_per_second INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (model_key, resolution, aspect_ratio)
    );
  END IF;
END $$;

-- Seed baseline pricing (adjust as needed)
INSERT INTO veo31_video_pricing (model_key, resolution, aspect_ratio, price_per_second, credits_per_second)
VALUES
  ('veo-3-1-quality', '720p', '16:9', 0.10, 10),
  ('veo-3-1-quality', '1080p', '16:9', 0.18, 18),
  ('veo-3-1-fast', '720p', '16:9', 0.05, 5),
  ('veo-3-1-fast', '1080p', '16:9', 0.09, 9)
ON CONFLICT (model_key, resolution, aspect_ratio) DO NOTHING;



