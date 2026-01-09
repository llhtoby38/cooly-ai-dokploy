-- 016_credit_lots.sql
-- Introduce per-lot credit tracking with expiries

-- Create credit_lots table
CREATE TABLE IF NOT EXISTS public.credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('subscription','one_off','adjustment')),
  plan_key text NULL,
  cycle_start timestamptz NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  remaining integer NOT NULL CHECK (remaining >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_lots_user_expires ON public.credit_lots(user_id, expires_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_remaining ON public.credit_lots(user_id) WHERE remaining > 0 AND closed_at IS NULL;

-- Add lot_id column to credit_transactions (separate statement for reliability)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'credit_transactions'
        AND column_name = 'lot_id'
    ) THEN
        ALTER TABLE public.credit_transactions ADD COLUMN lot_id uuid REFERENCES public.credit_lots(id);
    END IF;
END $$;

-- Add expires_at column to credit_transactions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'credit_transactions'
        AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE public.credit_transactions ADD COLUMN expires_at timestamptz;
    END IF;
END $$;

-- Add index for lot_id lookups
CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id ON public.credit_transactions(lot_id) WHERE lot_id IS NOT NULL;
