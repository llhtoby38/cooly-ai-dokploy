-- Pricing configuration for subscriptions, one-off packages, and model credit costs

-- Subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key TEXT NOT NULL,
  billing_mode TEXT NOT NULL,
  display_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  credits_per_period INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_plans_key_mode
  ON subscription_plans (plan_key, billing_mode);

-- Seed with current plans if missing
INSERT INTO subscription_plans (plan_key, billing_mode, display_name, price_cents, credits_per_period, sort_order)
VALUES
  ('starter','monthly','Starter', 900, 4500, 1),
  ('essential','monthly','Essential', 2000, 15000, 2),
  ('pro','monthly','Pro', 5900, 32000, 3),
  ('premium','monthly','Premium', 9900, 60000, 4),
  ('starter','yearly','Starter', 8640, 4500, 1),
  ('essential','yearly','Essential', 19200, 15000, 2),
  ('pro','yearly','Pro', 56640, 32000, 3),
  ('premium','yearly','Premium', 95040, 60000, 4)
ON CONFLICT (plan_key, billing_mode) DO NOTHING;

-- One-off credit packages
CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with current packages if missing
INSERT INTO credit_packages (display_name, credits, price_cents, sort_order)
VALUES
  ('1000 Credits', 1000, 300, 1),
  ('2000 Credits', 2000, 500, 2),
  ('3000 Credits', 3000, 700, 3),
  ('4000 Credits', 4000, 900, 4)
ON CONFLICT DO NOTHING;

-- Per-model pricing for credit costs
CREATE TABLE IF NOT EXISTS model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  unit TEXT NOT NULL,
  credit_cost_per_unit INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_model_pricing_model_key ON model_pricing(model_key);

-- Minimal seeds (adjust in admin UI later)
INSERT INTO model_pricing (model_key, display_name, operation, unit, credit_cost_per_unit)
VALUES
  ('seedream-4', 'Seedream 4.0', 'image', 'image', 1),
  ('seedream-3', 'Seedream 3.0', 'image', 'image', 1),
  ('seedance-1-pro', 'Seedance 1.0 Pro', 'video', 'second', 1),
  ('seedance-1-lite', 'Seedance 1.0 Lite', 'video', 'second', 1),
  ('veo-3-fast', 'Google Veo 3 Fast', 'video', 'second', 1),
  ('veo-3-quality', 'Google Veo 3 Quality', 'video', 'second', 1)
ON CONFLICT DO NOTHING;


