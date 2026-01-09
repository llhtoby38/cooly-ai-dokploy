-- Rename monthly plan display name from "Limited Time Offer" to "Hobby"

UPDATE subscription_plans
SET display_name = 'Hobby', updated_at = NOW()
WHERE plan_key = 'limited' AND billing_mode = 'monthly';


