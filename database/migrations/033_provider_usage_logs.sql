-- Provider usage logs for tracking token/usage metrics per request
CREATE TABLE IF NOT EXISTS provider_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id BIGINT NULL,
  task_id TEXT NULL,
  provider TEXT NOT NULL,
  model TEXT NULL,
  endpoint TEXT NULL,
  usage JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_user_created
  ON provider_usage_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_usage_session
  ON provider_usage_logs(session_id);


