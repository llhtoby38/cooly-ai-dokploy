-- 006_seedream_resolution_dims.sql
-- Ensure schema stores Seedream 4.0 resolution and per-image dimensions

-- generation_sessions: add resolution column to persist final WxH (e.g., 3136x1344)
ALTER TABLE IF EXISTS generation_sessions
  ADD COLUMN IF NOT EXISTS resolution TEXT;

-- images: add width/height columns to persist detected dimensions per image
ALTER TABLE IF EXISTS images
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER;


