-- Add B2 storage columns with tool-specific organization
ALTER TABLE images ADD COLUMN IF NOT EXISTS b2_filename TEXT;
ALTER TABLE images ADD COLUMN IF NOT EXISTS b2_url TEXT;
ALTER TABLE images ADD COLUMN IF NOT EXISTS b2_folder TEXT DEFAULT 'generated-content/byteplus-seedream';
ALTER TABLE images ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;
ALTER TABLE images ADD COLUMN IF NOT EXISTS storage_provider TEXT DEFAULT 'byteplus';
ALTER TABLE images ADD COLUMN IF NOT EXISTS generation_tool TEXT DEFAULT 'byteplus-seedream';

-- Add B2 storage columns to videos table
ALTER TABLE videos ADD COLUMN IF NOT EXISTS b2_filename TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS b2_url TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS b2_folder TEXT DEFAULT 'generated-content/google-veo3';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS storage_provider TEXT DEFAULT 'kie';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS generation_tool TEXT DEFAULT 'google-veo3';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_images_generation_tool ON images(generation_tool);
CREATE INDEX IF NOT EXISTS idx_videos_generation_tool ON videos(generation_tool);
CREATE INDEX IF NOT EXISTS idx_images_b2_folder ON images(b2_folder);
CREATE INDEX IF NOT EXISTS idx_videos_b2_folder ON videos(b2_folder);
CREATE INDEX IF NOT EXISTS idx_images_b2_url ON images(b2_url);
CREATE INDEX IF NOT EXISTS idx_videos_b2_url ON videos(b2_url);
CREATE INDEX IF NOT EXISTS idx_images_storage_provider ON images(storage_provider);
CREATE INDEX IF NOT EXISTS idx_videos_storage_provider ON videos(storage_provider);

-- Update existing records to mark them as external storage
UPDATE images SET storage_provider = 'byteplus' WHERE storage_provider IS NULL;
UPDATE videos SET storage_provider = 'kie' WHERE storage_provider IS NULL;
