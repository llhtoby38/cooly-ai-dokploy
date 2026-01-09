-- Add Stripe product/price IDs to subscription_plans for reuse

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_product_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_price
  ON subscription_plans (stripe_price_id);


