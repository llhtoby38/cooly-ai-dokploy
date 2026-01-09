-- Add monthly "Limited Time Offer" subscription plan
-- Idempotent upsert; resets Stripe price id if pricing changes so backend can recreate it

INSERT INTO subscription_plans (
  plan_key,
  billing_mode,
  display_name,
  price_cents,
  credits_per_period,
  is_active,
  sort_order
)
VALUES (
  'limited',            -- plan_key (used internally)
  'monthly',            -- billing mode
  'Limited Time Offer', -- customer-facing name
  199,                  -- $1.99
  20000,                -- credits per month
  TRUE,                 -- active
  0                     -- sort to top of monthly plans
)
ON CONFLICT (plan_key, billing_mode) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  price_cents = EXCLUDED.price_cents,
  credits_per_period = EXCLUDED.credits_per_period,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  -- If pricing changed, force Stripe price recreation on next checkout by nulling price id
  stripe_price_id = CASE 
    WHEN subscription_plans.price_cents <> EXCLUDED.price_cents 
      OR subscription_plans.credits_per_period <> EXCLUDED.credits_per_period
    THEN NULL
    ELSE subscription_plans.stripe_price_id
  END,
  updated_at = NOW();


