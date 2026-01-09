-- Add outputs and aspect_ratio columns to generation_sessions table
-- This ensures the UI can display the correct number of loading slots and aspect ratio

-- Add outputs column with default value of 1
ALTER TABLE generation_sessions ADD COLUMN IF NOT EXISTS outputs INTEGER DEFAULT 1;

-- Add aspect_ratio column to store the aspect ratio (e.g., '16:9', '1:1')
ALTER TABLE generation_sessions ADD COLUMN IF NOT EXISTS aspect_ratio TEXT;

-- Update existing sessions to have outputs = 1 if they don't have a value
UPDATE generation_sessions SET outputs = 1 WHERE outputs IS NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_generation_sessions_outputs ON generation_sessions(outputs);
CREATE INDEX IF NOT EXISTS idx_generation_sessions_aspect_ratio ON generation_sessions(aspect_ratio);
