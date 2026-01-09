-- Add missing 9:16 rows for Veo 3.1 pricing (if not present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='veo31_video_pricing') THEN
    INSERT INTO veo31_video_pricing (model_key, resolution, aspect_ratio, price_per_second, credits_per_second)
    VALUES
      ('veo-3-1-quality', '720p', '9:16', 0.10, 10),
      ('veo-3-1-quality', '1080p', '9:16', 0.18, 18),
      ('veo-3-1-fast', '720p', '9:16', 0.05, 5),
      ('veo-3-1-fast', '1080p', '9:16', 0.09, 9)
    ON CONFLICT (model_key, resolution, aspect_ratio) DO NOTHING;
  END IF;
END $$;



