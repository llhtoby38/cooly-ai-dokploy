-- 003_billing.sql
-- Adds credit & billing tables for Stripe integration

-- 1. Add credits column to users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;

-- 2. Table mapping users → Stripe customer ids
CREATE TABLE IF NOT EXISTS stripe_customers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT NOT NULL UNIQUE
);

-- 3. One-time credit purchases via Stripe Checkout
CREATE TABLE IF NOT EXISTS credit_purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_intent TEXT NOT NULL UNIQUE,
    credits_added INTEGER NOT NULL,
    amount_usd_cents INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Recurring subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
