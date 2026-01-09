-- Add duration_ms to generation_sessions to store total generation time in milliseconds
ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Backfill existing rows where possible
UPDATE generation_sessions
SET duration_ms = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000))
WHERE completed_at IS NOT NULL AND duration_ms IS NULL;

-- Optional index for analytics/ordering
CREATE INDEX IF NOT EXISTS idx_generation_sessions_duration_ms
  ON generation_sessions (duration_ms);


