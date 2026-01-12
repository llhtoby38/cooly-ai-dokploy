-- ============================================================
-- COOLY AI - MASTER MIGRATION SCRIPT
-- ============================================================
-- This script is IDEMPOTENT - safe to run multiple times
-- Can initialize a fresh database OR update existing databases
-- All operations wrapped in exception handlers for safety
--
-- Run via: psql $DATABASE_URL -f script/master-migration.sql
-- Or paste into Supabase SQL Editor
-- ============================================================

BEGIN;

-- ============================================================
-- HELPER: Safe index creation function
-- ============================================================
CREATE OR REPLACE FUNCTION safe_create_index(p_sql text) RETURNS void AS $$
BEGIN
    EXECUTE p_sql;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Index skipped: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 0: BASE TABLES
-- ============================================================

-- 0.1 Users table
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text,
  role text DEFAULT 'user',
  credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_login timestamptz,
  deleted_at timestamptz,
  google_id text
);

-- 0.2 Add missing columns to users
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='role') THEN
        ALTER TABLE public.users ADD COLUMN role text DEFAULT 'user';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='credits') THEN
        ALTER TABLE public.users ADD COLUMN credits integer NOT NULL DEFAULT 0;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='last_login') THEN
        ALTER TABLE public.users ADD COLUMN last_login timestamptz;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='deleted_at') THEN
        ALTER TABLE public.users ADD COLUMN deleted_at timestamptz;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='google_id') THEN
        ALTER TABLE public.users ADD COLUMN google_id text;
    END IF;
END $$;

-- ============================================================
-- SECTION 1: CREDIT LOTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'adjustment',
  plan_key text NULL,
  cycle_start timestamptz NULL,
  amount integer NOT NULL DEFAULT 0,
  remaining integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL
);

-- Add FK if not exists (safe)
DO $$ BEGIN
    ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN undefined_column THEN NULL;
END $$;

-- Fix data
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_lots' AND column_name='source') THEN
        UPDATE public.credit_lots SET source = 'adjustment' WHERE source IS NULL OR source NOT IN ('subscription','one_off','adjustment');
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Constraints (safe)
DO $$ BEGIN
    ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_source_check CHECK (source IN ('subscription','one_off','adjustment'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_lots_user_expires ON public.credit_lots(user_id, expires_at) WHERE closed_at IS NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_lots_user_remaining ON public.credit_lots(user_id) WHERE remaining > 0 AND closed_at IS NULL');

-- ============================================================
-- SECTION 2: CREDIT TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  balance_after integer,
  type text NOT NULL DEFAULT 'debit',
  description text,
  reference_id text,
  lot_id uuid,
  expires_at timestamptz,
  reservation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK if not exists
DO $$ BEGIN
    ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='lot_id') THEN
        ALTER TABLE public.credit_transactions ADD COLUMN lot_id uuid;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='expires_at') THEN
        ALTER TABLE public.credit_transactions ADD COLUMN expires_at timestamptz;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='reservation_id') THEN
        ALTER TABLE public.credit_transactions ADD COLUMN reservation_id uuid;
    END IF;
END $$;

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id ON public.credit_transactions(lot_id) WHERE lot_id IS NOT NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON public.credit_transactions(user_id, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation ON public.credit_transactions(reservation_id) WHERE reservation_id IS NOT NULL');

-- ============================================================
-- SECTION 3: CREDIT RESERVATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid,
  session_type text,
  amount integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  captured_at timestamptz,
  released_at timestamptz
);

-- Add FK if not exists
DO $$ BEGIN
    ALTER TABLE public.credit_reservations ADD CONSTRAINT credit_reservations_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fix data: convert invalid statuses
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_reservations' AND column_name='status') THEN
        -- Convert 'pending' to 'reserved' (old naming)
        UPDATE public.credit_reservations SET status = 'reserved' WHERE status = 'pending';
        -- Mark any other invalid statuses as released
        UPDATE public.credit_reservations SET status = 'released' WHERE status IS NULL OR status NOT IN ('reserved', 'expired', 'captured', 'released');
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Drop old constraint if exists (might have wrong values)
DO $$ BEGIN
    ALTER TABLE public.credit_reservations DROP CONSTRAINT IF EXISTS credit_reservations_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add correct constraint (reserved, expired, captured, released)
DO $$ BEGIN
    ALTER TABLE public.credit_reservations ADD CONSTRAINT credit_reservations_status_check CHECK (status IN ('reserved','expired','captured','released'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Indexes (safe) - use 'reserved' not 'pending'
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_reservations_user ON public.credit_reservations(user_id) WHERE status = ''reserved''');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_reservations_session ON public.credit_reservations(session_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires ON public.credit_reservations(expires_at) WHERE status = ''reserved''');

-- Add FK from credit_transactions to credit_reservations
DO $$ BEGIN
    ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_reservation_id_fkey
        FOREIGN KEY (reservation_id) REFERENCES public.credit_reservations(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add FK from credit_transactions to credit_lots
DO $$ BEGIN
    ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_lot_id_fkey
        FOREIGN KEY (lot_id) REFERENCES public.credit_lots(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- SECTION 4: OUTBOX TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'unknown',
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='processed_at') THEN
        ALTER TABLE public.outbox ADD COLUMN processed_at timestamptz;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='error') THEN
        ALTER TABLE public.outbox ADD COLUMN error text;
    END IF;
END $$;

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON public.outbox(created_at) WHERE processed_at IS NULL');

-- ============================================================
-- SECTION 5: SUBSCRIPTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  plan_id text,
  billing_mode text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='billing_mode') THEN
        ALTER TABLE public.subscriptions ADD COLUMN billing_mode text;
    END IF;
END $$;

-- ============================================================
-- SECTION 6: GENERATION SESSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.generation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prompt text,
  status text NOT NULL DEFAULT 'pending',
  model text,
  provider text,
  aspect_ratio text,
  resolution text,
  width integer,
  height integer,
  num_outputs integer DEFAULT 1,
  credit_cost integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='guidance_scale') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN guidance_scale NUMERIC;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='negative_prompt') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN negative_prompt TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='seed') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN seed BIGINT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='error_details') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN error_details JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='timing_breakdown') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN reservation_id uuid;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='client_key') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN client_key text;
    END IF;
END $$;

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_status ON public.generation_sessions(user_id, status, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_status_created ON public.generation_sessions(status, created_at) WHERE status IN (''pending'', ''processing'')');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_reservation ON public.generation_sessions(reservation_id) WHERE reservation_id IS NOT NULL');

-- ============================================================
-- SECTION 7: VIDEO GENERATION SESSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_generation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prompt text,
  status text NOT NULL DEFAULT 'pending',
  model text,
  provider text,
  aspect_ratio text,
  duration integer,
  credit_cost integer,
  error_message text,
  video_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='resolution') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN resolution TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='video_duration') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN video_duration INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='provider_status') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN provider_status TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='storage_status') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN storage_status TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN reservation_id uuid;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='b2_url') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN b2_url text;
    END IF;
END $$;

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_user_status ON public.video_generation_sessions(user_id, status, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_status_created ON public.video_generation_sessions(status, created_at) WHERE status IN (''pending'', ''processing'')');

-- ============================================================
-- SECTION 8: IMAGES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid,
  url text,
  b2_url text,
  storage_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_session_id ON public.images(session_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_user_created ON public.images(user_id, created_at DESC)');

-- ============================================================
-- SECTION 9: PROVIDER USAGE LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  session_type text,
  provider text NOT NULL DEFAULT 'unknown',
  endpoint text,
  request_payload jsonb,
  response_payload jsonb,
  latency_ms integer,
  status_code integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes (safe)
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_provider_usage_logs_session ON public.provider_usage_logs(session_id, session_type)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_provider_usage_logs_created ON public.provider_usage_logs(created_at DESC)');

-- ============================================================
-- SECTION 10: APP SETTINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SECTION 11: STRIPE CUSTOMERS TABLE (safe - don't fail on FK issues)
-- ============================================================

DO $$ BEGIN
    CREATE TABLE IF NOT EXISTS public.stripe_customers (
      user_id uuid PRIMARY KEY,
      stripe_customer_id text NOT NULL UNIQUE
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'stripe_customers table skipped: %', SQLERRM;
END $$;

-- ============================================================
-- SECTION 12: CREDIT PURCHASES TABLE (safe)
-- ============================================================

DO $$ BEGIN
    CREATE TABLE IF NOT EXISTS public.credit_purchases (
      id serial PRIMARY KEY,
      user_id uuid NOT NULL,
      stripe_payment_intent text UNIQUE,
      credits_added integer NOT NULL,
      amount_usd_cents integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'credit_purchases table skipped: %', SQLERRM;
END $$;

-- ============================================================
-- SECTION 13: USERS INDEXES (safe)
-- ============================================================

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users(lower(email))');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_users_google_id ON public.users(google_id) WHERE google_id IS NOT NULL');

-- ============================================================
-- SECTION 14: DATA FIXES
-- ============================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_lots')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='credits')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_lots' AND column_name='user_id')
    THEN
        INSERT INTO public.credit_lots (user_id, source, amount, remaining, expires_at)
        SELECT u.id, 'adjustment', u.credits, u.credits, NOW() + INTERVAL '365 days'
        FROM public.users u
        WHERE u.credits > 0
        AND NOT EXISTS (
            SELECT 1 FROM public.credit_lots cl
            WHERE cl.user_id = u.id AND cl.remaining > 0 AND cl.closed_at IS NULL
        )
        ON CONFLICT DO NOTHING;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Data fix skipped: %', SQLERRM;
END $$;

-- ============================================================
-- SECTION 15: DEFAULT APP SETTINGS
-- ============================================================

INSERT INTO public.app_settings (key, value) VALUES
  ('free_signup_credits_enabled', 'true'),
  ('default_free_credits', '10')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- CLEANUP: Drop helper function
-- ============================================================

DROP FUNCTION IF EXISTS safe_create_index(text);

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 'Migration complete' as status, count(*) as tables_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
    (table_name = 'credit_transactions' AND column_name IN ('lot_id', 'reservation_id'))
    OR (table_name = 'subscriptions' AND column_name = 'billing_mode')
    OR (table_name = 'outbox' AND column_name = 'processed_at')
    OR (table_name = 'generation_sessions' AND column_name IN ('guidance_scale', 'reservation_id'))
    OR (table_name = 'video_generation_sessions' AND column_name IN ('resolution', 'reservation_id'))
)
ORDER BY table_name, column_name;
