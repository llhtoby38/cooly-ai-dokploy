-- Reference pricing tables (no hardcoded values in code)

-- Image per-generation pricing (per image USD)
CREATE TABLE IF NOT EXISTS image_generation_pricing (
  model_key TEXT PRIMARY KEY,
  per_image_usd NUMERIC(10,6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial values (safe to run multiple times with ON CONFLICT)
INSERT INTO image_generation_pricing (model_key, per_image_usd, is_active)
VALUES 
  ('seedream-4', 0.03, TRUE),
  ('seedream-3', 0.03, TRUE)
ON CONFLICT (model_key) DO UPDATE SET
  per_image_usd = EXCLUDED.per_image_usd,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Video token pricing (USD per 1K tokens)
CREATE TABLE IF NOT EXISTS video_token_pricing (
  model_key TEXT PRIMARY KEY,
  token_usd_per_k NUMERIC(10,6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO video_token_pricing (model_key, token_usd_per_k, is_active)
VALUES 
  ('seedance-1-0-pro', 0.0025, TRUE),
  ('seedance-1-0-lite', 0.0018, TRUE)
ON CONFLICT (model_key) DO UPDATE SET
  token_usd_per_k = EXCLUDED.token_usd_per_k,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();


