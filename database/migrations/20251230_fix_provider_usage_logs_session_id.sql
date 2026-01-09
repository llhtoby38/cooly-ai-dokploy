-- Fix provider_usage_logs.session_id type to match generation_sessions.id (uuid)
-- The column was incorrectly defined as bigint but generation_sessions uses uuid

ALTER TABLE provider_usage_logs
ALTER COLUMN session_id TYPE uuid USING session_id::uuid;

-- Add comment for clarity
COMMENT ON COLUMN provider_usage_logs.session_id IS 'References generation_sessions.id (uuid)';
