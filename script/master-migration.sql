-- ============================================================
-- COOLY AI - MASTER MIGRATION SCRIPT
-- ============================================================
-- This script is IDEMPOTENT - safe to run multiple times
-- Can initialize a fresh database OR update existing databases
--
-- Run via: psql $DATABASE_URL -f script/master-migration.sql
-- Or paste into Supabase SQL Editor
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 0: BASE TABLES (if not exist)
-- These are the core tables that other tables depend on
-- ============================================================

-- 0.1 Users table (core - required for foreign keys)
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

-- 0.2 Add any missing columns to users
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='role') THEN
        ALTER TABLE public.users ADD COLUMN role text DEFAULT 'user';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='credits') THEN
        ALTER TABLE public.users ADD COLUMN credits integer NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='last_login') THEN
        ALTER TABLE public.users ADD COLUMN last_login timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='deleted_at') THEN
        ALTER TABLE public.users ADD COLUMN deleted_at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='google_id') THEN
        ALTER TABLE public.users ADD COLUMN google_id text;
    END IF;
END $$;

-- ============================================================
-- SECTION 1: CREDIT LOTS SYSTEM
-- ============================================================

-- 1.1 Create credit_lots table
CREATE TABLE IF NOT EXISTS public.credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  plan_key text NULL,
  cycle_start timestamptz NULL,
  amount integer NOT NULL DEFAULT 0,
  remaining integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL
);

-- 1.2 Fix any invalid data before adding constraints (only if table exists)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_lots') THEN
        UPDATE public.credit_lots SET source = 'adjustment' WHERE source IS NULL OR source NOT IN ('subscription','one_off','adjustment');
        UPDATE public.credit_lots SET amount = 0 WHERE amount IS NULL OR amount < 0;
        UPDATE public.credit_lots SET remaining = 0 WHERE remaining IS NULL OR remaining < 0;
    END IF;
END $$;

-- 1.3 Add check constraints (ignore if exists or still violates)
DO $$ BEGIN
    ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_source_check
        CHECK (source IN ('subscription','one_off','adjustment'));
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN check_violation THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_amount_check CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN check_violation THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_remaining_check CHECK (remaining >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN check_violation THEN NULL;
END $$;

-- 1.4 Credit lots indexes
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_expires
  ON public.credit_lots(user_id, expires_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_remaining
  ON public.credit_lots(user_id) WHERE remaining > 0 AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_lots_user_active
  ON public.credit_lots(user_id) WHERE remaining > 0 AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_lots_expires_remaining
  ON public.credit_lots(expires_at, remaining) WHERE closed_at IS NULL;

-- ============================================================
-- SECTION 2: CREDIT TRANSACTIONS
-- ============================================================

-- 2.1 Create credit_transactions table if not exists
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  balance_after integer,
  type text NOT NULL,
  description text,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.2 Add lot_id column
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='lot_id') THEN
        ALTER TABLE public.credit_transactions ADD COLUMN lot_id uuid;
    END IF;
END $$;

-- 2.3 Add foreign key for lot_id (ignore if exists)
DO $$ BEGIN
    ALTER TABLE public.credit_transactions
        ADD CONSTRAINT credit_transactions_lot_id_fkey
        FOREIGN KEY (lot_id) REFERENCES public.credit_lots(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2.4 Add expires_at column
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='expires_at') THEN
        ALTER TABLE public.credit_transactions ADD COLUMN expires_at timestamptz;
    END IF;
END $$;

-- 2.5 Add reservation_id column (will add FK after credit_reservations table)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='reservation_id') THEN
        ALTER TABLE public.credit_transactions ADD COLUMN reservation_id uuid;
    END IF;
END $$;

-- 2.6 Credit transactions indexes
CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id
  ON public.credit_transactions(lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON public.credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation
  ON public.credit_transactions(reservation_id) WHERE reservation_id IS NOT NULL;

-- ============================================================
-- SECTION 3: CREDIT RESERVATIONS SYSTEM
-- ============================================================

-- 3.1 Create credit_reservations table
CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid,
  session_type text,
  amount integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  captured_at timestamptz,
  released_at timestamptz
);

-- 3.2 Fix any invalid status values before adding constraint (only if table exists)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_reservations') THEN
        UPDATE public.credit_reservations SET status = 'released'
        WHERE status IS NULL OR status NOT IN ('pending', 'captured', 'released');
    END IF;
END $$;

-- 3.3 Add check constraints (with data cleanup)
DO $$ BEGIN
    ALTER TABLE public.credit_reservations ADD CONSTRAINT credit_reservations_amount_check CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN check_violation THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.credit_reservations ADD CONSTRAINT credit_reservations_status_check
        CHECK (status IN ('pending','captured','released'));
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN check_violation THEN NULL;
END $$;

-- 3.4 Credit reservations indexes
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user
  ON public.credit_reservations(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_credit_reservations_session
  ON public.credit_reservations(session_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires
  ON public.credit_reservations(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_credit_reservations_pending_expires
  ON public.credit_reservations(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_pending
  ON public.credit_reservations(user_id, created_at DESC) WHERE status = 'pending';

-- 3.5 Add FK from credit_transactions to credit_reservations
DO $$ BEGIN
    ALTER TABLE public.credit_transactions
        ADD CONSTRAINT credit_transactions_reservation_id_fkey
        FOREIGN KEY (reservation_id) REFERENCES public.credit_reservations(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- SECTION 4: OUTBOX TABLE (Enqueue-First Pattern)
-- ============================================================

-- 4.1 Create outbox table
CREATE TABLE IF NOT EXISTS public.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

-- 4.2 Add missing columns to outbox if table existed with different schema
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='processed_at') THEN
        ALTER TABLE public.outbox ADD COLUMN processed_at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='error') THEN
        ALTER TABLE public.outbox ADD COLUMN error text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='event_type') THEN
        ALTER TABLE public.outbox ADD COLUMN event_type text NOT NULL DEFAULT 'unknown';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='payload') THEN
        ALTER TABLE public.outbox ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';
    END IF;
END $$;

-- 4.3 Outbox indexes
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed
  ON public.outbox(created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed_created
  ON public.outbox(created_at ASC) WHERE processed_at IS NULL;

-- ============================================================
-- SECTION 5: SUBSCRIPTIONS TABLE
-- ============================================================

-- 5.1 Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  plan_id text,
  billing_mode text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5.2 Add billing_mode column if missing
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='billing_mode') THEN
        ALTER TABLE public.subscriptions ADD COLUMN billing_mode text;
    END IF;
END $$;

-- ============================================================
-- SECTION 6: GENERATION SESSIONS TABLE
-- ============================================================

-- 6.1 Create generation_sessions table
CREATE TABLE IF NOT EXISTS public.generation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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

-- 6.2 Add all missing columns to generation_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='guidance_scale') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN guidance_scale NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='negative_prompt') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN negative_prompt TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='seed') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN seed BIGINT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='error_details') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN error_details JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='timing_breakdown') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN reservation_id uuid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='client_key') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN client_key text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='input_settings') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN input_settings JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='outputs') THEN
        ALTER TABLE public.generation_sessions ADD COLUMN outputs JSONB;
    END IF;
END $$;

-- 6.3 Add FK for reservation_id
DO $$ BEGIN
    ALTER TABLE public.generation_sessions
        ADD CONSTRAINT generation_sessions_reservation_id_fkey
        FOREIGN KEY (reservation_id) REFERENCES public.credit_reservations(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6.4 Generation sessions indexes
CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_status
  ON public.generation_sessions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_sessions_status_created
  ON public.generation_sessions(status, created_at) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_generation_sessions_reservation
  ON public.generation_sessions(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generation_sessions_client_key
  ON public.generation_sessions(client_key) WHERE client_key IS NOT NULL;

-- ============================================================
-- SECTION 7: VIDEO GENERATION SESSIONS TABLE
-- ============================================================

-- 7.1 Create video_generation_sessions table
CREATE TABLE IF NOT EXISTS public.video_generation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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

-- 7.2 Add all missing columns to video_generation_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='resolution') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN resolution TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='video_duration') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN video_duration INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='provider_status') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN provider_status TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='storage_status') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN storage_status TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='timing_breakdown') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN reservation_id uuid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='client_key') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN client_key text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='b2_url') THEN
        ALTER TABLE public.video_generation_sessions ADD COLUMN b2_url text;
    END IF;
END $$;

-- 7.3 Add FK for reservation_id
DO $$ BEGIN
    ALTER TABLE public.video_generation_sessions
        ADD CONSTRAINT video_generation_sessions_reservation_id_fkey
        FOREIGN KEY (reservation_id) REFERENCES public.credit_reservations(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7.4 Video generation sessions indexes
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_user_status
  ON public.video_generation_sessions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_status_created
  ON public.video_generation_sessions(status, created_at) WHERE status IN ('pending', 'processing', 'uploading');
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_reservation
  ON public.video_generation_sessions(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_client_key
  ON public.video_generation_sessions(client_key) WHERE client_key IS NOT NULL;

-- ============================================================
-- SECTION 8: IMAGES TABLE
-- ============================================================

-- 8.1 Create images table
CREATE TABLE IF NOT EXISTS public.images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.generation_sessions(id) ON DELETE CASCADE,
  url text,
  b2_url text,
  storage_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8.2 Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='client_key') THEN
        ALTER TABLE public.images ADD COLUMN client_key text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='b2_url') THEN
        ALTER TABLE public.images ADD COLUMN b2_url text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='storage_status') THEN
        ALTER TABLE public.images ADD COLUMN storage_status text;
    END IF;
END $$;

-- 8.3 Images indexes
CREATE INDEX IF NOT EXISTS idx_images_session_id ON public.images(session_id);
CREATE INDEX IF NOT EXISTS idx_images_user_created ON public.images(user_id, created_at DESC);

-- ============================================================
-- SECTION 9: PROVIDER USAGE LOGS
-- ============================================================

-- 9.1 Create provider_usage_logs table
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

-- 9.2 Provider usage logs indexes
CREATE INDEX IF NOT EXISTS idx_provider_usage_logs_session
  ON public.provider_usage_logs(session_id, session_type);
CREATE INDEX IF NOT EXISTS idx_provider_usage_logs_created
  ON public.provider_usage_logs(created_at DESC);

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
-- SECTION 11: STRIPE CUSTOMERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stripe_customers (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE
);

-- ============================================================
-- SECTION 12: CREDIT PURCHASES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_purchases (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_payment_intent text UNIQUE,
  credits_added integer NOT NULL,
  amount_usd_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SECTION 13: ADDITIONAL INDEXES FOR PERFORMANCE
-- ============================================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users(lower(email));
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON public.users(google_id) WHERE google_id IS NOT NULL;

-- ============================================================
-- SECTION 14: DATA FIXES
-- ============================================================

-- 14.1 Create credit lots for users who have credits but no active lots
-- Wrapped in DO block to handle missing tables/columns gracefully
DO $$
BEGIN
    -- Only run if both tables exist and have the required columns
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_lots')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='credits')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_lots' AND column_name='user_id')
    THEN
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

COMMIT;

-- ============================================================
-- VERIFICATION (safe queries that won't fail)
-- ============================================================

-- Count tables
SELECT 'Tables created' as status, count(*) as count
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE';

-- List critical columns
SELECT 'Critical columns' as status, table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
    (table_name = 'credit_transactions' AND column_name IN ('lot_id', 'reservation_id'))
    OR (table_name = 'subscriptions' AND column_name = 'billing_mode')
    OR (table_name = 'outbox' AND column_name = 'processed_at')
    OR (table_name = 'generation_sessions' AND column_name IN ('guidance_scale', 'reservation_id'))
    OR (table_name = 'video_generation_sessions' AND column_name IN ('resolution', 'reservation_id'))
    OR (table_name = 'credit_lots' AND column_name = 'user_id')
    OR (table_name = 'credit_reservations' AND column_name = 'status')
)
ORDER BY table_name, column_name;
