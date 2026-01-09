-- Application settings / feature flags
-- Simple key -> JSONB value store. Use booleans for feature flags.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: enable free signup credits by default
INSERT INTO app_settings (key, value)
VALUES ('free_signup_credits_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key);


