-- Add reference image fields for Seedream 4.0 image sessions
-- Stores a single first image URL for convenience and an array of URLs for multi-image reference

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS ref_image_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS ref_image_urls JSONB NULL;

-- Optional: lightweight GIN index for JSONB contains queries (future-proofing)
CREATE INDEX IF NOT EXISTS idx_generation_sessions_ref_image_urls
  ON generation_sessions USING GIN (ref_image_urls);


