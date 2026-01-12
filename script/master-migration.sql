-- ============================================================
-- COOLY AI - MASTER MIGRATION SCRIPT
-- ============================================================
-- This script is IDEMPOTENT - safe to run multiple times
-- Includes all schema changes from the performance optimization
-- and containerization contract work.
--
-- Run via: psql $DATABASE_URL -f script/master-migration.sql
-- Or paste into Supabase SQL Editor
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: CREDIT LOTS SYSTEM
-- From: 016_credit_lots.sql
-- ============================================================

-- 1.1 Create credit_lots table
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

-- 1.2 Credit lots indexes
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_expires
  ON public.credit_lots(user_id, expires_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_remaining
  ON public.credit_lots(user_id) WHERE remaining > 0 AND closed_at IS NULL;

-- 1.3 Add lot_id to credit_transactions
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

-- 1.4 Add expires_at to credit_transactions
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

-- 1.5 Index for lot_id lookups
CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id
  ON public.credit_transactions(lot_id) WHERE lot_id IS NOT NULL;

-- ============================================================
-- SECTION 2: CREDIT RESERVATIONS SYSTEM
-- From: 024_credit_reservations.sql, 20251031 migrations
-- ============================================================

-- 2.1 Create credit_reservations table
CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid,
  session_type text,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','captured','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  captured_at timestamptz,
  released_at timestamptz
);

-- 2.2 Credit reservations indexes
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user
  ON public.credit_reservations(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_credit_reservations_session
  ON public.credit_reservations(session_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires
  ON public.credit_reservations(expires_at) WHERE status = 'pending';

-- 2.3 Add reservation_id to credit_transactions
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

-- 2.4 Index for reservation_id lookups
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation
  ON public.credit_transactions(reservation_id) WHERE reservation_id IS NOT NULL;

-- ============================================================
-- SECTION 3: OUTBOX TABLE (Enqueue-First Pattern)
-- From: 20251101_create_outbox.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed
  ON public.outbox(created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed_created
  ON public.outbox(created_at ASC) WHERE processed_at IS NULL;

-- ============================================================
-- SECTION 4: BILLING SYSTEM FIXES
-- From: 003_billing.sql
-- ============================================================

-- 4.1 Add billing_mode to subscriptions
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
-- SECTION 5: GENERATION SESSIONS COLUMNS
-- From: 20260110_fix_missing_columns.sql, 20251102, 20251230
-- ============================================================

-- 5.1 Add guidance_scale (Seedream 4.0)
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

-- 5.2 Add negative_prompt (Seedream 4.0)
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

-- 5.3 Add seed (Seedream 4.0)
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

-- 5.4 Add error_details
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

-- 5.5 Add timing_breakdown
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generation_sessions'
        AND column_name = 'timing_breakdown'
    ) THEN
        ALTER TABLE public.generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
END $$;

-- 5.6 Add reservation_id to generation_sessions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'generation_sessions'
        AND column_name = 'reservation_id'
    ) THEN
        ALTER TABLE public.generation_sessions ADD COLUMN reservation_id uuid REFERENCES public.credit_reservations(id);
    END IF;
END $$;

-- ============================================================
-- SECTION 6: VIDEO GENERATION SESSIONS COLUMNS
-- From: 20260110_fix_missing_columns.sql
-- ============================================================

-- 6.1 Add resolution (Seedance, Sora2, Veo)
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

-- 6.2 Add video_duration
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

-- 6.3 Add provider_status (Veo)
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

-- 6.4 Add storage_status
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

-- 6.5 Add timing_breakdown to video_generation_sessions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'video_generation_sessions'
        AND column_name = 'timing_breakdown'
    ) THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
END $$;

-- 6.6 Add reservation_id to video_generation_sessions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'video_generation_sessions'
        AND column_name = 'reservation_id'
    ) THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN reservation_id uuid REFERENCES public.credit_reservations(id);
    END IF;
END $$;

-- ============================================================
-- SECTION 7: PROVIDER USAGE LOGS
-- From: 20251230_fix_provider_usage_logs_session_id.sql
-- ============================================================

-- 7.1 Ensure provider_usage_logs table exists
CREATE TABLE IF NOT EXISTS public.provider_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  session_type text,
  provider text NOT NULL,
  endpoint text,
  request_payload jsonb,
  response_payload jsonb,
  latency_ms integer,
  status_code integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7.2 Fix session_id column type if needed (some deployments had varchar)
DO $$
BEGIN
    -- Only run if column exists and is not uuid type
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'provider_usage_logs'
        AND column_name = 'session_id'
        AND data_type != 'uuid'
    ) THEN
        ALTER TABLE public.provider_usage_logs
        ALTER COLUMN session_id TYPE uuid USING session_id::uuid;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Ignore errors if conversion fails
    NULL;
END $$;

-- ============================================================
-- SECTION 8: PERFORMANCE INDEXES
-- From: 20260101_add_performance_indexes.sql
-- ============================================================

-- 8.1 Credit lots indexes
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_active
  ON public.credit_lots(user_id)
  WHERE remaining > 0 AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_credit_lots_expires_remaining
  ON public.credit_lots(expires_at, remaining)
  WHERE closed_at IS NULL;

-- 8.2 Credit reservations indexes
CREATE INDEX IF NOT EXISTS idx_credit_reservations_pending_expires
  ON public.credit_reservations(expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_pending
  ON public.credit_reservations(user_id, created_at DESC)
  WHERE status = 'pending';

-- 8.3 Credit transactions indexes
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON public.credit_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_remaining
  ON public.credit_transactions(lot_id)
  WHERE lot_id IS NOT NULL;

-- 8.4 Generation sessions indexes
CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_status
  ON public.generation_sessions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_status_created
  ON public.generation_sessions(status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_generation_sessions_reservation
  ON public.generation_sessions(reservation_id)
  WHERE reservation_id IS NOT NULL;

-- 8.5 Video generation sessions indexes
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_user_status
  ON public.video_generation_sessions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_status_created
  ON public.video_generation_sessions(status, created_at)
  WHERE status IN ('pending', 'processing', 'uploading');

CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_reservation
  ON public.video_generation_sessions(reservation_id)
  WHERE reservation_id IS NOT NULL;

-- 8.6 Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON public.users(lower(email));

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON public.users(created_at DESC);

-- 8.7 Images indexes
CREATE INDEX IF NOT EXISTS idx_images_session_id
  ON public.images(session_id);

CREATE INDEX IF NOT EXISTS idx_images_user_created
  ON public.images(user_id, created_at DESC);

-- 8.8 Provider usage logs indexes
CREATE INDEX IF NOT EXISTS idx_provider_usage_logs_session
  ON public.provider_usage_logs(session_id, session_type);

CREATE INDEX IF NOT EXISTS idx_provider_usage_logs_created
  ON public.provider_usage_logs(created_at DESC);

-- ============================================================
-- SECTION 9: APP SETTINGS TABLE
-- From: 024_app_settings.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SECTION 10: DATA FIXES
-- ============================================================

-- 10.1 Create credit lots for users who have credits but no active lots
-- This ensures users can use their existing credits
INSERT INTO public.credit_lots (user_id, source, amount, remaining, expires_at)
SELECT
    u.id,
    'adjustment',
    u.credits,
    u.credits,
    NOW() + INTERVAL '365 days'
FROM public.users u
WHERE u.credits > 0
AND NOT EXISTS (
    SELECT 1 FROM public.credit_lots cl
    WHERE cl.user_id = u.id
    AND cl.remaining > 0
    AND cl.closed_at IS NULL
    AND (cl.expires_at > NOW() OR cl.source = 'one_off')
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SECTION 11: VERIFICATION
-- ============================================================

-- Display migration summary
DO $$
DECLARE
    v_credit_lots_count integer;
    v_credit_reservations_count integer;
    v_outbox_count integer;
    v_missing_columns text[];
BEGIN
    SELECT count(*) INTO v_credit_lots_count FROM public.credit_lots;
    SELECT count(*) INTO v_credit_reservations_count FROM public.credit_reservations;
    SELECT count(*) INTO v_outbox_count FROM public.outbox;

    RAISE NOTICE '==========================================';
    RAISE NOTICE 'MIGRATION COMPLETE - SUMMARY';
    RAISE NOTICE '==========================================';
    RAISE NOTICE 'credit_lots rows: %', v_credit_lots_count;
    RAISE NOTICE 'credit_reservations rows: %', v_credit_reservations_count;
    RAISE NOTICE 'outbox rows: %', v_outbox_count;
    RAISE NOTICE '==========================================';
END $$;

COMMIT;

-- ============================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- Run these manually to verify the migration succeeded
-- ============================================================

-- Check all required tables exist
SELECT 'Tables Check' as check_type, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('credit_lots', 'credit_reservations', 'outbox', 'app_settings')
ORDER BY table_name;

-- Check critical columns exist
SELECT 'Columns Check' as check_type, table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
    (table_name = 'credit_transactions' AND column_name IN ('lot_id', 'expires_at', 'reservation_id'))
    OR (table_name = 'subscriptions' AND column_name = 'billing_mode')
    OR (table_name = 'generation_sessions' AND column_name IN ('guidance_scale', 'negative_prompt', 'seed', 'error_details', 'timing_breakdown', 'reservation_id'))
    OR (table_name = 'video_generation_sessions' AND column_name IN ('resolution', 'video_duration', 'provider_status', 'storage_status', 'timing_breakdown', 'reservation_id'))
)
ORDER BY table_name, column_name;

-- Check indexes exist
SELECT 'Indexes Check' as check_type, indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE 'idx_credit_%'
ORDER BY indexname
LIMIT 10;
