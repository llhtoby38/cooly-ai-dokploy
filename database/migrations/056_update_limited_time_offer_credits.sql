-- Update Limited Time Offer monthly plan to 1000 credits
-- Also reset stripe_price_id if credits changed so backend recreates price

UPDATE subscription_plans sp
SET 
  credits_per_period = 1000,
  stripe_price_id = CASE 
    WHEN sp.credits_per_period IS DISTINCT FROM 1000 THEN NULL 
    ELSE sp.stripe_price_id 
  END,
  updated_at = NOW()
WHERE sp.plan_key = 'limited' AND sp.billing_mode = 'monthly';


