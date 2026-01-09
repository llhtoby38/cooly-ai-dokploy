-- Add timing_breakdown JSONB column to track detailed performance metrics
-- This allows breakdown of total time into: API calls, image/video transfer, DB ops, overhead

ALTER TABLE generation_sessions
ADD COLUMN IF NOT EXISTS timing_breakdown JSONB;

ALTER TABLE video_generation_sessions
ADD COLUMN IF NOT EXISTS timing_breakdown JSONB;

ALTER TABLE sora_video_sessions
ADD COLUMN IF NOT EXISTS timing_breakdown JSONB;

ALTER TABLE veo31_video_sessions
ADD COLUMN IF NOT EXISTS timing_breakdown JSONB;

-- Add indexes for querying timing data
CREATE INDEX IF NOT EXISTS idx_gen_sessions_timing_breakdown
  ON generation_sessions USING gin (timing_breakdown);

CREATE INDEX IF NOT EXISTS idx_video_gen_sessions_timing_breakdown
  ON video_generation_sessions USING gin (timing_breakdown);

CREATE INDEX IF NOT EXISTS idx_sora_video_sessions_timing_breakdown
  ON sora_video_sessions USING gin (timing_breakdown);

CREATE INDEX IF NOT EXISTS idx_veo31_video_sessions_timing_breakdown
  ON veo31_video_sessions USING gin (timing_breakdown);

-- Example timing_breakdown structure:
-- {
--   "totalMs": 28000,
--   "providerApiMs": 20000,
--   "videoTransferMs": 5000,
--   "dbOpsMs": 100,
--   "overheadMs": 2900
-- }

COMMENT ON COLUMN generation_sessions.timing_breakdown IS 'Detailed timing breakdown in milliseconds: API calls, transfers, DB ops, overhead';
COMMENT ON COLUMN video_generation_sessions.timing_breakdown IS 'Detailed timing breakdown in milliseconds: API calls, transfers, DB ops, overhead';
COMMENT ON COLUMN sora_video_sessions.timing_breakdown IS 'Detailed timing breakdown in milliseconds: API calls, transfers, DB ops, overhead';
COMMENT ON COLUMN veo31_video_sessions.timing_breakdown IS 'Detailed timing breakdown in milliseconds: API calls, transfers, DB ops, overhead';
