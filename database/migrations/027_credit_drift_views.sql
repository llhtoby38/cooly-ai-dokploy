-- 027_credit_drift_views.sql
-- Views to detect drift between users.credits and last ledger or lots table

CREATE OR REPLACE VIEW credit_drift AS
SELECT
  u.id AS user_id,
  u.email,
  u.credits AS user_credits,
  (
    SELECT balance_after
    FROM credit_transactions ct
    WHERE ct.user_id = u.id
    ORDER BY ct.created_at DESC
    LIMIT 1
  ) AS last_tx_balance
FROM users u
WHERE u.credits <> COALESCE((
  SELECT balance_after FROM credit_transactions ct
  WHERE ct.user_id = u.id
  ORDER BY ct.created_at DESC LIMIT 1
), u.credits);

CREATE OR REPLACE VIEW lots_drift AS
SELECT u.id AS user_id, u.email, u.credits AS user_credits,
       ect.current_balance AS lots_balance, ect.last_updated_at
FROM users u
JOIN email_credit_tracking ect ON ect.email = u.email
WHERE u.credits IS DISTINCT FROM ect.current_balance;


