-- 004_billing_uuid_fix.sql
-- Supabase uses UUID primary keys for users.
-- This migration recreates billing tables with uuid foreign keys.

-- 1. Ensure credits column exists (noop if already added)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;

-- 2. Drop prior integer-based tables if they were partially created (safe if they don't exist)
DROP TABLE IF EXISTS stripe_customers CASCADE;
DROP TABLE IF EXISTS credit_purchases CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;

-- 3. Re-create tables using UUID references
CREATE TABLE stripe_customers (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT NOT NULL UNIQUE
);

CREATE TABLE credit_purchases (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_intent TEXT NOT NULL UNIQUE,
    credits_added INTEGER NOT NULL,
    amount_usd_cents INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
