-- 026_guard_credits_ledger.sql
-- Guard: any change to users.credits inserts a matching credit_transactions row
-- Includes a session-local bypass flag to avoid double-logging from app code

-- Bypass flag (per-session GUC). Use: SELECT set_config('app.bypass_credits_trigger','1', true);
-- and later reset to '0' or default.

CREATE OR REPLACE FUNCTION app_enforce_credit_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bypass text;
  delta integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.credits IS DISTINCT FROM OLD.credits THEN
    bypass := current_setting('app.bypass_credits_trigger', true);
    IF COALESCE(bypass, '0') <> '1' THEN
      delta := NEW.credits - OLD.credits;
      INSERT INTO credit_transactions(user_id, description, amount, balance_after)
      VALUES (OLD.id, 'System adjustment', delta, NEW.credits);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_users_credits_ledger ON users;
CREATE TRIGGER trg_users_credits_ledger
AFTER UPDATE OF credits ON users
FOR EACH ROW EXECUTE FUNCTION app_enforce_credit_ledger();


