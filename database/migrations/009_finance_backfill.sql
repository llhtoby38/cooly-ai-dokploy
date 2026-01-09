-- Backfill finance_ledger from existing historical data

-- 1) One-off purchases -> income
INSERT INTO finance_ledger (id, created_at, user_id, side, category, amount_cents, source, external_id, metadata)
SELECT gen_random_uuid(), COALESCE(cp.created_at, NOW()), cp.user_id, 'income', 'one_off',
       COALESCE(cp.amount_usd_cents, 0), 'backfill',
       'backfill:purchase:' || cp.id::text,
       json_build_object('purchase_id', cp.id, 'credits', cp.credits_added)
FROM credit_purchases cp
LEFT JOIN finance_ledger fl
  ON fl.category = 'one_off' AND fl.external_id = ('backfill:purchase:' || cp.id::text)
WHERE fl.id IS NULL;

-- 2) Subscriptions -> income
-- Use subscription_events created/renewed and join price from subscription_plans by (plan_key, billing_mode)
INSERT INTO finance_ledger (id, created_at, user_id, side, category, amount_cents, source, external_id, metadata)
SELECT gen_random_uuid(), se.created_at, se.user_id, 'income', 'subscription',
       COALESCE(sp.price_cents, 0), 'backfill',
       'backfill:subevent:' || se.id::text,
       json_build_object('subscription_event_id', se.id, 'event_type', se.event_type, 'plan_key', COALESCE(se.new_plan_key, se.prev_plan_key), 'billing_mode', sp.billing_mode)
FROM subscription_events se
LEFT JOIN subscription_plans sp ON sp.plan_key = COALESCE(se.new_plan_key, se.prev_plan_key)
                                AND (
                                  sp.billing_mode = se.billing_mode
                                  OR se.billing_mode IS NULL
                                )
LEFT JOIN finance_ledger fl
  ON fl.category = 'subscription' AND fl.external_id = ('backfill:subevent:' || se.id::text)
WHERE fl.id IS NULL
  AND se.event_type IN ('created','renewed');

-- 3) Optional: Seed costs from model usage if you have a historical table.
-- This is left as a no-op because usage history tables vary. You can add queries like:
-- INSERT INTO finance_ledger (... side='cost', category='provider_api', amount_cents, quantity, unit, model_key, provider, ...)
-- SELECT ... FROM your_generation_history ... JOIN model_pricing ...;


