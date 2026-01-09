-- Add input_settings JSONB snapshot of prompt panel for exact reuse
ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS input_settings JSONB NULL;

-- Optional: index for querying by keys if needed later
CREATE INDEX IF NOT EXISTS idx_generation_sessions_input_settings_gin
  ON generation_sessions USING GIN (input_settings);


