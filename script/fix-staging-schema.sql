-- fix-staging-schema.sql
-- Run this manually on staging database to fix all missing tables/columns
-- Connect via: psql postgresql://user:pass@host:port/dbname -f script/fix-staging-schema.sql

BEGIN;

-- ============================================================
-- 1. Create credit_lots table (from 016_credit_lots.sql)
-- ============================================================
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

-- ============================================================
-- 2. Add lot_id to credit_transactions (from 016_credit_lots.sql)
-- ============================================================
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

-- Add expires_at to credit_transactions
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

CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id ON public.credit_transactions(lot_id) WHERE lot_id IS NOT NULL;

-- ============================================================
-- 3. Create credit_reservations table (from 20251031 migrations)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid,
  session_type text,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','expired','captured','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  captured_at timestamptz,
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_user ON public.credit_reservations(user_id) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_credit_reservations_session ON public.credit_reservations(session_id);

-- ============================================================
-- 4. Add reservation_id to credit_transactions
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'credit_transactions'
        AND column_name = 'reservation_id'
    ) THEN
        ALTER TABLE public.credit_transactions ADD COLUMN reservation_id uuid REFERENCES public.credit_reservations(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation ON public.credit_transactions(reservation_id) WHERE reservation_id IS NOT NULL;

-- ============================================================
-- 5. Add billing_mode to subscriptions (from 003_billing.sql fix)
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'subscriptions'
        AND column_name = 'billing_mode'
    ) THEN
        ALTER TABLE public.subscriptions ADD COLUMN billing_mode TEXT;
    END IF;
END $$;

-- ============================================================
-- 6. Add columns to generation_sessions (from 20260110_fix_missing_columns.sql)
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generation_sessions'
        AND column_name = 'guidance_scale'
    ) THEN
        ALTER TABLE public.generation_sessions ADD COLUMN guidance_scale NUMERIC;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generation_sessions'
        AND column_name = 'negative_prompt'
    ) THEN
        ALTER TABLE public.generation_sessions ADD COLUMN negative_prompt TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generation_sessions'
        AND column_name = 'seed'
    ) THEN
        ALTER TABLE public.generation_sessions ADD COLUMN seed BIGINT;
    END IF;
END $$;

-- ============================================================
-- 7. Add columns to video_generation_sessions
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'video_generation_sessions'
        AND column_name = 'resolution'
    ) THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN resolution TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'video_generation_sessions'
        AND column_name = 'video_duration'
    ) THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN video_duration INTEGER;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'video_generation_sessions'
        AND column_name = 'provider_status'
    ) THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN provider_status TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'video_generation_sessions'
        AND column_name = 'storage_status'
    ) THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN storage_status TEXT;
    END IF;
END $$;

-- ============================================================
-- 8. Create outbox table (from 20251101_create_outbox.sql)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON public.outbox(created_at) WHERE processed_at IS NULL;

-- ============================================================
-- 9. Add error_details to generation_sessions
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generation_sessions'
        AND column_name = 'error_details'
    ) THEN
        ALTER TABLE public.generation_sessions ADD COLUMN error_details JSONB;
    END IF;
END $$;

-- ============================================================
-- 10. Create credit lots for users who have credits but no lots
-- ============================================================
INSERT INTO credit_lots (user_id, source, amount, remaining, expires_at)
SELECT
    u.id,
    'adjustment',
    u.credits,
    u.credits,
    NOW() + INTERVAL '365 days'
FROM users u
WHERE u.credits > 0
AND NOT EXISTS (
    SELECT 1 FROM credit_lots cl
    WHERE cl.user_id = u.id
    AND cl.remaining > 0
    AND cl.closed_at IS NULL
    AND (cl.expires_at > NOW() OR cl.source = 'one_off')
);

-- ============================================================
-- Verification queries
-- ============================================================
\echo '=========================================='
\echo 'Schema fix complete! Verification:'
\echo '=========================================='

-- Check tables exist
SELECT 'credit_lots' as table_name, count(*) as rows FROM credit_lots
UNION ALL
SELECT 'credit_reservations', count(*) FROM credit_reservations
UNION ALL
SELECT 'outbox', count(*) FROM outbox;

-- Check columns exist
SELECT
    table_name,
    column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
    (table_name = 'credit_transactions' AND column_name IN ('lot_id', 'expires_at', 'reservation_id'))
    OR (table_name = 'subscriptions' AND column_name = 'billing_mode')
    OR (table_name = 'generation_sessions' AND column_name IN ('guidance_scale', 'negative_prompt', 'seed'))
    OR (table_name = 'video_generation_sessions' AND column_name IN ('resolution', 'video_duration', 'provider_status', 'storage_status'))
)
ORDER BY table_name, column_name;

COMMIT;
