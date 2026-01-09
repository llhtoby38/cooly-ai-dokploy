-- 013_email_credit_tracking.sql
-- Tracks total credits ever given to each email address to prevent credit farming
-- Users can re-register but can't exceed lifetime credit limit

-- Create table to track total credits given to each email
CREATE TABLE IF NOT EXISTS email_credit_tracking (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    total_credits_given INTEGER NOT NULL DEFAULT 0,
    current_balance INTEGER NOT NULL DEFAULT 0,
    first_registration_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_email_credit_tracking_email ON email_credit_tracking(email);

-- Add comment explaining the purpose
COMMENT ON TABLE email_credit_tracking IS 'Tracks total credits ever given to each email address to prevent credit farming';
COMMENT ON COLUMN email_credit_tracking.email IS 'Email address for tracking';
COMMENT ON COLUMN email_credit_tracking.total_credits_given IS 'Total credits ever given to this email (lifetime max: 10)';
COMMENT ON COLUMN email_credit_tracking.current_balance IS 'Current credit balance for this email';
COMMENT ON COLUMN email_credit_tracking.first_registration_at IS 'When this email first registered';
COMMENT ON COLUMN email_credit_tracking.last_updated_at IS 'Last time credits were updated for this email';
