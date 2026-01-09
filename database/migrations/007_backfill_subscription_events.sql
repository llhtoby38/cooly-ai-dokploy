-- Backfill subscription_events from existing tables

-- 1) Created events: first row per stripe_subscription_id
WITH first_rows AS (
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.stripe_subscription_id ORDER BY s.created_at ASC) AS rn
  FROM subscriptions s
)
INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, amount_cents, credits_delta, source, metadata, effective_at, created_at)
SELECT fr.user_id, fr.stripe_subscription_id, 'created', NULL, fr.plan_id, sp.display_name, sp.billing_mode, NULL, NULL, 'backfill', json_build_object('status', fr.status), fr.created_at, fr.created_at
FROM first_rows fr
LEFT JOIN subscription_plans sp ON sp.plan_key = fr.plan_id
WHERE fr.rn = 1;

-- 2) Plan change events: detect changes by LAG()
WITH changes AS (
  SELECT s.*, LAG(s.plan_id) OVER (PARTITION BY s.stripe_subscription_id ORDER BY s.created_at ASC) AS prev_plan
  FROM subscriptions s
)
INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, amount_cents, credits_delta, source, metadata, effective_at, created_at)
SELECT c.user_id, c.stripe_subscription_id, 'plan_changed', c.prev_plan, c.plan_id,
       sp_new.display_name, sp_new.billing_mode, NULL,
       (COALESCE(sp_new.credits_per_period,0) - COALESCE(sp_prev.credits_per_period,0)) AS credits_delta,
       'backfill', json_build_object('status', c.status), c.created_at, c.created_at
FROM changes c
LEFT JOIN subscription_plans sp_prev ON sp_prev.plan_key = c.prev_plan
LEFT JOIN subscription_plans sp_new ON sp_new.plan_key = c.plan_id
WHERE c.prev_plan IS NOT NULL AND c.prev_plan <> c.plan_id;

-- 3) Canceled events: status transitions to 'cancelled'
WITH status_changes AS (
  SELECT s.*, LAG(s.status) OVER (PARTITION BY s.stripe_subscription_id ORDER BY s.created_at ASC) AS prev_status
  FROM subscriptions s
)
INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, amount_cents, credits_delta, source, metadata, effective_at, created_at)
SELECT sc.user_id, sc.stripe_subscription_id, 'canceled', sc.plan_id, sc.plan_id, sp.display_name, sp.billing_mode, NULL, NULL, 'backfill', json_build_object('prev_status', sc.prev_status, 'status', sc.status), sc.created_at, sc.created_at
FROM status_changes sc
LEFT JOIN subscription_plans sp ON sp.plan_key = sc.plan_id
WHERE sc.status = 'cancelled' AND (sc.prev_status IS DISTINCT FROM 'cancelled');

-- 4) Renewed events: infer from credit_transactions subscription credit logs
INSERT INTO subscription_events (user_id, stripe_subscription_id, event_type, prev_plan_key, new_plan_key, plan_display_name, billing_mode, amount_cents, credits_delta, source, metadata, effective_at, created_at)
SELECT ct.user_id, sub_at.stripe_subscription_id, 'renewed', sub_at.plan_id, sub_at.plan_id, sp.display_name, sp.billing_mode, NULL, NULL,
       'backfill', json_build_object('credit_tx_id', ct.id, 'description', ct.description), ct.created_at, ct.created_at
FROM credit_transactions ct
LEFT JOIN LATERAL (
  SELECT s.plan_id, s.stripe_subscription_id
  FROM subscriptions s
  WHERE s.user_id = ct.user_id AND s.created_at <= ct.created_at
  ORDER BY s.created_at DESC
  LIMIT 1
) sub_at ON TRUE
LEFT JOIN subscription_plans sp ON sp.plan_key = sub_at.plan_id
WHERE LOWER(ct.description) LIKE '%subscription credit%';


