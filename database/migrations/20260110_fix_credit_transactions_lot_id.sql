-- 20260110_fix_credit_transactions_lot_id.sql
-- Ensure lot_id and expires_at columns exist on credit_transactions
-- This fixes an issue where migration 016_credit_lots.sql may have failed silently

-- Add lot_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'credit_transactions'
        AND column_name = 'lot_id'
    ) THEN
        ALTER TABLE public.credit_transactions
        ADD COLUMN lot_id uuid REFERENCES public.credit_lots(id);
    END IF;
END $$;

-- Add expires_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'credit_transactions'
        AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE public.credit_transactions
        ADD COLUMN expires_at timestamptz;
    END IF;
END $$;

-- Add index for lot_id lookups if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id
ON public.credit_transactions(lot_id)
WHERE lot_id IS NOT NULL;
