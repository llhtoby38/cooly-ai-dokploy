-- Subscription events history table
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  event_type TEXT NOT NULL, -- created, plan_changed, canceled, cancel_scheduled, resumed, resume_scheduled, renewed
  prev_plan_key TEXT,
  new_plan_key TEXT,
  plan_display_name TEXT,
  billing_mode TEXT, -- monthly/yearly if applicable
  amount_cents INTEGER, -- e.g. renewal or proration amount
  credits_delta INTEGER, -- e.g. delta credits granted on upgrade
  source TEXT, -- webhook, portal, admin, system
  metadata JSONB,
  effective_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_user_created ON subscription_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_stripe_sub ON subscription_events(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_type ON subscription_events(event_type);


