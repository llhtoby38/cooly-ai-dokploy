-- Add duration_ms column to video_generation_sessions table
-- This stores the total time in milliseconds for a session to complete

ALTER TABLE video_generation_sessions ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Backfill existing completed sessions with duration
UPDATE video_generation_sessions
SET duration_ms = EXTRACT(EPOCH FROM (completed_at - created_at))*1000
WHERE status = 'completed' AND completed_at IS NOT NULL AND created_at IS NOT NULL AND (duration_ms IS NULL OR duration_ms <= 0);

-- Add index for performance on duration_ms
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_duration_ms ON video_generation_sessions(duration_ms);
