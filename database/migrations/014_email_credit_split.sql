-- 014_email_credit_split.sql
-- Split email credit tracking into free vs purchased balances

BEGIN;

-- Add separate balance columns
ALTER TABLE email_credit_tracking
  ADD COLUMN IF NOT EXISTS free_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_balance INTEGER NOT NULL DEFAULT 0;

-- Backfill initial values based on existing data
-- Assumptions:
--  - total_credits_given represents lifetime FREE credits granted (max 10)
--  - current_balance is the total current balance (free + paid)
--  - We estimate current free balance as min(total_credits_given, current_balance)
--  - Purchased balance becomes the remainder
UPDATE email_credit_tracking
SET 
  free_balance = GREATEST(LEAST(COALESCE(total_credits_given, 0), COALESCE(current_balance, 0)), 0),
  paid_balance = GREATEST(COALESCE(current_balance, 0) - GREATEST(LEAST(COALESCE(total_credits_given, 0), COALESCE(current_balance, 0)), 0), 0),
  last_updated_at = NOW();

-- Add explanatory comments
COMMENT ON COLUMN email_credit_tracking.free_balance IS 'Remaining FREE credits for this email (subset of total_credits_given)';
COMMENT ON COLUMN email_credit_tracking.paid_balance IS 'Remaining PURCHASED credits for this email';

COMMIT;


