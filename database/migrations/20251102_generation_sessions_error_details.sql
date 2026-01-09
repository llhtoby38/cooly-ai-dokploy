ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS error_details JSONB;

COMMENT ON COLUMN generation_sessions.error_details IS 'Provider failure snapshot (status code, message, refund info, etc).';



