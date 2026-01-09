-- Image per-variant pricing table (simple per-output rows by model)
-- Allows different models to have distinct per-output prices and rounded charges

CREATE TABLE IF NOT EXISTS image_variant_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,          -- e.g., 'seedream-3'
  api_cost_usd NUMERIC(12,4) NOT NULL,           -- provider cost per output
  cooly_credit_charge NUMERIC(12,2) NOT NULL,    -- api_cost_usd * 1.5 * 500
  final_price_credits INTEGER NOT NULL,          -- rounded to nearest 10 (display/charge)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_image_variant_pricing_model
  ON image_variant_pricing (model_key)
  WHERE is_active = TRUE;


