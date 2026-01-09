-- Detailed per-variant pricing without disturbing existing model_pricing
-- Stores exact rows for Seedance Lite/Pro by resolution, aspect ratio, and duration

CREATE TABLE IF NOT EXISTS video_variant_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,         -- 'seedance-1-0-pro' | 'seedance-1-0-lite' | 'veo-3-fast' | 'veo-3-quality'
  resolution TEXT NOT NULL,        -- '480p' | '720p' | '1080p'
  aspect_ratio TEXT NOT NULL,      -- '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9'
  duration_seconds INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps INTEGER NOT NULL,
  video_tokens NUMERIC(12,4) NOT NULL,
  unit_price_usd NUMERIC(12,8) NOT NULL,
  api_cost_usd NUMERIC(12,4) NOT NULL,
  cost_in_credits NUMERIC(12,2) NOT NULL,  -- API cost * 500
  cooly_credit_charge NUMERIC(12,2) NOT NULL, -- API cost * 1.5 * 500
  final_price_credits INTEGER NOT NULL,    -- rounded to nearest 10
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_video_variant_pricing_key
  ON video_variant_pricing (model_key, resolution, aspect_ratio, duration_seconds)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_video_variant_pricing_lookup
  ON video_variant_pricing (model_key, resolution, aspect_ratio, duration_seconds, is_active);


