-- ============================================================
-- COOLY AI - MASTER MIGRATION SCRIPT
-- ============================================================
-- This script is IDEMPOTENT - safe to run multiple times
-- Can initialize a fresh database OR update existing databases
-- All operations wrapped in exception handlers for safety
--
-- Generated from analysis of 77+ migration files
-- Run via: psql $DATABASE_URL -f script/master-migration.sql
-- Or paste into Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
-- SECTION 1: USERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT,
  role VARCHAR(20) DEFAULT 'user',
  credits INTEGER NOT NULL DEFAULT 0,
  provider TEXT DEFAULT 'local',
  provider_email TEXT,
  google_id TEXT,
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns to users (idempotent)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='role') THEN
        ALTER TABLE public.users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='credits') THEN
        ALTER TABLE public.users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='provider') THEN
        ALTER TABLE public.users ADD COLUMN provider TEXT DEFAULT 'local';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='provider_email') THEN
        ALTER TABLE public.users ADD COLUMN provider_email TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='google_id') THEN
        ALTER TABLE public.users ADD COLUMN google_id TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='last_login_at') THEN
        ALTER TABLE public.users ADD COLUMN last_login_at TIMESTAMPTZ;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='deleted_at') THEN
        ALTER TABLE public.users ADD COLUMN deleted_at TIMESTAMPTZ;
    END IF;
END $$;

-- Allow password-less accounts (for OAuth)
DO $$ BEGIN
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Handle email uniqueness with soft delete support
-- Drop old unique constraints
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND contype = 'u' AND conname = 'users_email_key') THEN
        ALTER TABLE users DROP CONSTRAINT users_email_key;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP INDEX IF EXISTS users_email_unique;

-- Create partial unique index for active users (case-insensitive)
SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower_active ON users ((lower(email))) WHERE deleted_at IS NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL');

-- ============================================================
-- SECTION 2: STRIPE CUSTOMERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stripe_customers (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT NOT NULL UNIQUE
);

-- ============================================================
-- SECTION 3: CREDIT PURCHASES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_purchases (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_intent TEXT NOT NULL UNIQUE,
    credits_added INTEGER NOT NULL,
    amount_usd_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 4: SUBSCRIPTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    billing_mode TEXT,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='billing_mode') THEN
        ALTER TABLE public.subscriptions ADD COLUMN billing_mode TEXT;
    END IF;
END $$;

-- ============================================================
-- SECTION 5: SUBSCRIPTION EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  event_type TEXT NOT NULL,
  prev_plan_key TEXT,
  new_plan_key TEXT,
  plan_display_name TEXT,
  billing_mode TEXT,
  amount_cents INTEGER,
  credits_delta INTEGER,
  source TEXT,
  metadata JSONB,
  effective_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_subscription_events_user_created ON subscription_events(user_id, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_subscription_events_stripe_sub ON subscription_events(stripe_subscription_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_subscription_events_type ON subscription_events(event_type)');

-- ============================================================
-- SECTION 6: GENERATION SESSIONS TABLE (Image Generation)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT,
  model TEXT,
  status TEXT DEFAULT 'processing',
  resolution TEXT,
  aspect_ratio TEXT,
  outputs INTEGER DEFAULT 1,
  credit_cost INTEGER DEFAULT 1,
  duration_ms INTEGER,
  guidance_scale NUMERIC,
  negative_prompt TEXT,
  seed BIGINT,
  ref_image_url TEXT,
  ref_image_urls JSONB,
  input_settings JSONB,
  token_usage JSONB,
  completion_tokens BIGINT,
  total_tokens BIGINT,
  per_image_usd NUMERIC(10,6),
  session_usd NUMERIC(12,6),
  error_details JSONB,
  timing_breakdown JSONB,
  reservation_id UUID,
  client_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add missing columns to generation_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='model') THEN
        ALTER TABLE generation_sessions ADD COLUMN model TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='status') THEN
        ALTER TABLE generation_sessions ADD COLUMN status TEXT DEFAULT 'processing';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='completed_at') THEN
        ALTER TABLE generation_sessions ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='resolution') THEN
        ALTER TABLE generation_sessions ADD COLUMN resolution TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='aspect_ratio') THEN
        ALTER TABLE generation_sessions ADD COLUMN aspect_ratio TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='outputs') THEN
        ALTER TABLE generation_sessions ADD COLUMN outputs INTEGER DEFAULT 1;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='credit_cost') THEN
        ALTER TABLE generation_sessions ADD COLUMN credit_cost INTEGER DEFAULT 1;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='duration_ms') THEN
        ALTER TABLE generation_sessions ADD COLUMN duration_ms INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='guidance_scale') THEN
        ALTER TABLE generation_sessions ADD COLUMN guidance_scale NUMERIC;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='negative_prompt') THEN
        ALTER TABLE generation_sessions ADD COLUMN negative_prompt TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='seed') THEN
        ALTER TABLE generation_sessions ADD COLUMN seed BIGINT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='ref_image_url') THEN
        ALTER TABLE generation_sessions ADD COLUMN ref_image_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='ref_image_urls') THEN
        ALTER TABLE generation_sessions ADD COLUMN ref_image_urls JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='input_settings') THEN
        ALTER TABLE generation_sessions ADD COLUMN input_settings JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='token_usage') THEN
        ALTER TABLE generation_sessions ADD COLUMN token_usage JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='completion_tokens') THEN
        ALTER TABLE generation_sessions ADD COLUMN completion_tokens BIGINT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='total_tokens') THEN
        ALTER TABLE generation_sessions ADD COLUMN total_tokens BIGINT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='per_image_usd') THEN
        ALTER TABLE generation_sessions ADD COLUMN per_image_usd NUMERIC(10,6);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='session_usd') THEN
        ALTER TABLE generation_sessions ADD COLUMN session_usd NUMERIC(12,6);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='error_details') THEN
        ALTER TABLE generation_sessions ADD COLUMN error_details JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='timing_breakdown') THEN
        ALTER TABLE generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE generation_sessions ADD COLUMN reservation_id UUID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='generation_sessions' AND column_name='client_key') THEN
        ALTER TABLE generation_sessions ADD COLUMN client_key TEXT;
    END IF;
END $$;

-- Generation sessions indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_created ON generation_sessions(user_id, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_outputs ON generation_sessions(outputs)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_aspect_ratio ON generation_sessions(aspect_ratio)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_duration_ms ON generation_sessions(duration_ms)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_ref_image_urls ON generation_sessions USING GIN (ref_image_urls)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_input_settings_gin ON generation_sessions USING GIN (input_settings)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_token_usage ON generation_sessions USING GIN (token_usage)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_reservation_id ON generation_sessions(reservation_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_client_key ON generation_sessions(client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_generation_sessions_user_client_key ON generation_sessions(user_id, client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_gen_sessions_timing_breakdown ON generation_sessions USING gin (timing_breakdown)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_gen_sessions_status_created ON generation_sessions(status, created_at) WHERE status IN (''processing'', ''pending'')');

-- ============================================================
-- SECTION 7: IMAGES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  b2_filename TEXT,
  b2_url TEXT,
  b2_folder TEXT DEFAULT 'generated-content/byteplus-seedream',
  file_size BIGINT DEFAULT 0,
  storage_provider TEXT DEFAULT 'byteplus',
  storage_status TEXT,
  generation_tool TEXT DEFAULT 'byteplus-seedream',
  client_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add missing columns to images
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='width') THEN
        ALTER TABLE images ADD COLUMN width INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='height') THEN
        ALTER TABLE images ADD COLUMN height INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='b2_filename') THEN
        ALTER TABLE images ADD COLUMN b2_filename TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='b2_url') THEN
        ALTER TABLE images ADD COLUMN b2_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='b2_folder') THEN
        ALTER TABLE images ADD COLUMN b2_folder TEXT DEFAULT 'generated-content/byteplus-seedream';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='file_size') THEN
        ALTER TABLE images ADD COLUMN file_size BIGINT DEFAULT 0;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='storage_provider') THEN
        ALTER TABLE images ADD COLUMN storage_provider TEXT DEFAULT 'byteplus';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='storage_status') THEN
        ALTER TABLE images ADD COLUMN storage_status TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='generation_tool') THEN
        ALTER TABLE images ADD COLUMN generation_tool TEXT DEFAULT 'byteplus-seedream';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='client_key') THEN
        ALTER TABLE images ADD COLUMN client_key TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='created_at') THEN
        ALTER TABLE images ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='images' AND column_name='completed_at') THEN
        ALTER TABLE images ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;
END $$;

-- Images indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_session_id ON images(session_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_generation_tool ON images(generation_tool)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_b2_folder ON images(b2_folder)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_b2_url ON images(b2_url)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_storage_provider ON images(storage_provider)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_client_key ON images(client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_session_client_key ON images(session_id, client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_images_completed_at ON images(completed_at)');

-- ============================================================
-- SECTION 8: VIDEO GENERATION SESSIONS TABLE (Seedance)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.video_generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT,
  aspect_ratio TEXT,
  resolution TEXT,
  video_duration INTEGER,
  status TEXT NOT NULL DEFAULT 'processing',
  storage_status VARCHAR(50) DEFAULT 'pending',
  provider_status TEXT,
  task_id TEXT,
  credit_cost INTEGER DEFAULT 5,
  duration_ms INTEGER,
  ref_image_url TEXT,
  start_frame_url TEXT,
  end_frame_url TEXT,
  token_usage JSONB,
  completion_tokens BIGINT,
  total_tokens BIGINT,
  token_usd_per_k NUMERIC(10,6),
  session_usd NUMERIC(12,6),
  timing_breakdown JSONB,
  reservation_id UUID,
  client_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add missing columns to video_generation_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='resolution') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN resolution TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='video_duration') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN video_duration INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='storage_status') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN storage_status VARCHAR(50) DEFAULT 'pending';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='provider_status') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN provider_status TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='credit_cost') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN credit_cost INTEGER DEFAULT 5;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='duration_ms') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN duration_ms INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='ref_image_url') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN ref_image_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='start_frame_url') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN start_frame_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='end_frame_url') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN end_frame_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='token_usage') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN token_usage JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='completion_tokens') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN completion_tokens BIGINT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='total_tokens') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN total_tokens BIGINT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='token_usd_per_k') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN token_usd_per_k NUMERIC(10,6);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='session_usd') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN session_usd NUMERIC(12,6);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='timing_breakdown') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN reservation_id UUID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='video_generation_sessions' AND column_name='client_key') THEN
        ALTER TABLE video_generation_sessions ADD COLUMN client_key TEXT;
    END IF;
END $$;

-- Video generation sessions indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_sessions_user_created ON video_generation_sessions(user_id, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_sessions_storage_status ON video_generation_sessions(storage_status)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_sessions_start_frame_url ON video_generation_sessions(start_frame_url)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_sessions_end_frame_url ON video_generation_sessions(end_frame_url)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_token_usage ON video_generation_sessions USING GIN (token_usage)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_duration_ms ON video_generation_sessions(duration_ms)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_client_key ON video_generation_sessions(client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_user_client_key ON video_generation_sessions(user_id, client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_vgs_status_created_at ON video_generation_sessions(status, created_at)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_gen_sessions_timing_breakdown ON video_generation_sessions USING gin (timing_breakdown)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_sessions_status_created ON video_generation_sessions(status, created_at) WHERE status IN (''processing'', ''pending'')');

-- ============================================================
-- SECTION 9: VIDEOS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES video_generation_sessions(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  filename TEXT,
  local_path TEXT,
  hd_url TEXT,
  b2_filename TEXT,
  b2_url TEXT,
  b2_folder TEXT DEFAULT 'generated-content/google-veo3',
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_provider TEXT DEFAULT 'kie',
  generation_tool TEXT DEFAULT 'google-veo3',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns to videos
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='hd_url') THEN
        ALTER TABLE videos ADD COLUMN hd_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='b2_filename') THEN
        ALTER TABLE videos ADD COLUMN b2_filename TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='b2_url') THEN
        ALTER TABLE videos ADD COLUMN b2_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='b2_folder') THEN
        ALTER TABLE videos ADD COLUMN b2_folder TEXT DEFAULT 'generated-content/google-veo3';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='storage_provider') THEN
        ALTER TABLE videos ADD COLUMN storage_provider TEXT DEFAULT 'kie';
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='videos' AND column_name='generation_tool') THEN
        ALTER TABLE videos ADD COLUMN generation_tool TEXT DEFAULT 'google-veo3';
    END IF;
END $$;

-- Make nullable columns flexible
DO $$ BEGIN
    ALTER TABLE videos ALTER COLUMN filename DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE videos ALTER COLUMN local_path DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Videos indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_videos_session_id ON videos(session_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_videos_generation_tool ON videos(generation_tool)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_videos_b2_folder ON videos(b2_folder)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_videos_b2_url ON videos(b2_url)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_videos_storage_provider ON videos(storage_provider)');

-- ============================================================
-- SECTION 10: SORA VIDEO SESSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sora_video_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT,
  aspect_ratio TEXT,
  resolution TEXT,
  video_duration INTEGER,
  status TEXT NOT NULL DEFAULT 'processing',
  provider_status TEXT,
  credit_cost INTEGER,
  per_second_usd NUMERIC(10, 4),
  session_usd NUMERIC(10, 4),
  timing_breakdown JSONB,
  reservation_id UUID,
  client_key TEXT,
  task_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add missing columns to sora_video_sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_sessions' AND column_name='credit_cost') THEN
        ALTER TABLE sora_video_sessions ADD COLUMN credit_cost INTEGER;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_sessions' AND column_name='per_second_usd') THEN
        ALTER TABLE sora_video_sessions ADD COLUMN per_second_usd NUMERIC(10, 4);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_sessions' AND column_name='session_usd') THEN
        ALTER TABLE sora_video_sessions ADD COLUMN session_usd NUMERIC(10, 4);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_sessions' AND column_name='provider_status') THEN
        ALTER TABLE sora_video_sessions ADD COLUMN provider_status TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_sessions' AND column_name='timing_breakdown') THEN
        ALTER TABLE sora_video_sessions ADD COLUMN timing_breakdown JSONB;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_sessions' AND column_name='reservation_id') THEN
        ALTER TABLE sora_video_sessions ADD COLUMN reservation_id UUID;
    END IF;
END $$;

-- Sora sessions indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_sessions_user_created ON sora_video_sessions(user_id, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_sessions_client_key ON sora_video_sessions(client_key)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_sessions_task_id ON sora_video_sessions(task_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_sessions_provider_status_created ON sora_video_sessions(provider_status, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_video_sessions_timing_breakdown ON sora_video_sessions USING gin (timing_breakdown)');

-- ============================================================
-- SECTION 11: SORA VIDEOS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sora_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sora_video_sessions(id) ON DELETE CASCADE,
  original_url TEXT,
  b2_filename TEXT,
  b2_url TEXT,
  storage_provider TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns to sora_videos
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_videos' AND column_name='original_url') THEN
        ALTER TABLE sora_videos ADD COLUMN original_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_videos' AND column_name='b2_filename') THEN
        ALTER TABLE sora_videos ADD COLUMN b2_filename TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_videos' AND column_name='b2_url') THEN
        ALTER TABLE sora_videos ADD COLUMN b2_url TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_videos' AND column_name='file_size') THEN
        ALTER TABLE sora_videos ADD COLUMN file_size INTEGER;
    END IF;
END $$;

-- Drop NOT NULL on legacy 'url' column if present
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sora_videos' AND column_name='url' AND is_nullable='NO') THEN
        ALTER TABLE sora_videos ALTER COLUMN url DROP NOT NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_videos_session ON sora_videos(session_id)');

-- ============================================================
-- SECTION 12: SORA VIDEO PRICING TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sora_video_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  resolution TEXT NOT NULL,
  price_per_second NUMERIC(10, 4) NOT NULL,
  credits_per_second INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_key, resolution)
);

-- Add missing column
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sora_video_pricing' AND column_name='credits_per_second') THEN
        ALTER TABLE sora_video_pricing ADD COLUMN credits_per_second INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Seed baseline pricing
INSERT INTO sora_video_pricing (model_key, resolution, price_per_second, credits_per_second)
VALUES
  ('sora-2', '720p', 0.10, 10),
  ('sora-2-pro', '720p', 0.30, 30),
  ('sora-2-pro', '1080p', 0.50, 50)
ON CONFLICT (model_key, resolution) DO NOTHING;

-- ============================================================
-- SECTION 13: VEO 3.1 VIDEO SESSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.veo31_video_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT,
  aspect_ratio TEXT,
  resolution TEXT,
  video_duration INTEGER,
  status TEXT NOT NULL DEFAULT 'processing',
  provider_status TEXT,
  credit_cost INTEGER,
  token_usage JSONB,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  token_usd_per_k NUMERIC,
  session_usd NUMERIC,
  timing_breakdown JSONB,
  reservation_id UUID,
  client_key TEXT,
  task_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Veo31 sessions indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_veo31_sessions_user_created ON veo31_video_sessions(user_id, created_at DESC)');
SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS ux_veo31_sessions_client_key ON veo31_video_sessions(client_key) WHERE client_key IS NOT NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_veo31_sessions_task_id ON veo31_video_sessions(task_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_veo31_sessions_model ON veo31_video_sessions(model)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_veo31_video_sessions_timing_breakdown ON veo31_video_sessions USING gin (timing_breakdown)');

-- ============================================================
-- SECTION 14: VEO 3.1 VIDEOS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.veo31_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES veo31_video_sessions(id) ON DELETE CASCADE,
  original_url TEXT,
  b2_filename TEXT,
  b2_url TEXT,
  storage_provider TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_veo31_videos_session ON veo31_videos(session_id)');

-- ============================================================
-- SECTION 15: VEO 3.1 VIDEO PRICING TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.veo31_video_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  resolution TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  price_per_second NUMERIC(10, 4) NOT NULL,
  credits_per_second INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_key, resolution, aspect_ratio)
);

-- Seed Veo31 pricing
INSERT INTO veo31_video_pricing (model_key, resolution, aspect_ratio, price_per_second, credits_per_second)
VALUES
  ('veo-3-1-quality', '720p', '16:9', 0.10, 10),
  ('veo-3-1-quality', '1080p', '16:9', 0.18, 18),
  ('veo-3-1-fast', '720p', '16:9', 0.05, 5),
  ('veo-3-1-fast', '1080p', '16:9', 0.09, 9),
  ('veo-3-1-quality', '720p', '9:16', 0.10, 10),
  ('veo-3-1-quality', '1080p', '9:16', 0.18, 18),
  ('veo-3-1-fast', '720p', '9:16', 0.05, 5),
  ('veo-3-1-fast', '1080p', '9:16', 0.09, 9)
ON CONFLICT (model_key, resolution, aspect_ratio) DO NOTHING;

-- ============================================================
-- SECTION 16: CREDIT LOTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('subscription','one_off','adjustment')),
  plan_key TEXT,
  cycle_start TIMESTAMPTZ,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_lots_user_expires ON credit_lots(user_id, expires_at) WHERE closed_at IS NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_lots_user_remaining ON credit_lots(user_id) WHERE remaining > 0 AND closed_at IS NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_lots_user_active ON credit_lots(user_id, expires_at, amount)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_lots_expiry ON credit_lots(expires_at, amount)');

-- ============================================================
-- SECTION 17: CREDIT RESERVATIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'reserved',
  session_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

-- Fix status values and add constraint
DO $$ BEGIN
    UPDATE credit_reservations SET status = 'reserved' WHERE status = 'pending';
    UPDATE credit_reservations SET status = 'released' WHERE status IS NULL OR status NOT IN ('reserved', 'expired', 'captured', 'released');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE credit_reservations DROP CONSTRAINT IF EXISTS credit_reservations_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE credit_reservations ADD CONSTRAINT credit_reservations_status_check CHECK (status IN ('reserved','expired','captured','released'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_status ON credit_reservations(user_id, status)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_reservations_created ON credit_reservations(created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_reservations_active ON credit_reservations(expires_at, status) WHERE status = ''reserved''');

-- ============================================================
-- SECTION 18: CREDIT TRANSACTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  lot_id UUID,
  reservation_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='lot_id') THEN
        ALTER TABLE credit_transactions ADD COLUMN lot_id UUID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='reservation_id') THEN
        ALTER TABLE credit_transactions ADD COLUMN reservation_id UUID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='expires_at') THEN
        ALTER TABLE credit_transactions ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add FK constraints (safe)
DO $$ BEGIN
    ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES credit_lots(id);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE credit_transactions ADD CONSTRAINT fk_credit_transactions_reservation FOREIGN KEY (reservation_id) REFERENCES credit_reservations(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_lot_id ON credit_transactions(lot_id) WHERE lot_id IS NOT NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation_id ON credit_transactions(reservation_id)');

-- ============================================================
-- SECTION 19: OUTBOX TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  reservation_id UUID,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  dispatch_attempts INT NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  error TEXT
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='processed_at') THEN
        ALTER TABLE outbox ADD COLUMN processed_at TIMESTAMPTZ;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbox' AND column_name='error') THEN
        ALTER TABLE outbox ADD COLUMN error TEXT;
    END IF;
END $$;

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_outbox_dispatched_created ON outbox(dispatched_at, created_at)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(created_at) WHERE dispatched_at IS NULL');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_outbox_failed_attempts ON outbox(dispatch_attempts, created_at) WHERE dispatched_at IS NULL AND dispatch_attempts > 3');

-- ============================================================
-- SECTION 20: PENDING GENERATIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id UUID,
  session_id UUID REFERENCES generation_sessions(id) ON DELETE SET NULL,
  tool VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  input_settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '60 minutes'
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_pending_generations_user_id ON pending_generations(user_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_pending_generations_reservation_id ON pending_generations(reservation_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_pending_generations_session_id ON pending_generations(session_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_pending_generations_status_expires ON pending_generations(status, expires_at)');

-- Add unique constraint on reservation_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_pending_generations_reservation_id') THEN
        ALTER TABLE pending_generations ADD CONSTRAINT uq_pending_generations_reservation_id UNIQUE (reservation_id);
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Function to update updated_at
CREATE OR REPLACE FUNCTION set_pending_generations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_pending_generations_updated_at ON pending_generations;
CREATE TRIGGER trg_pending_generations_updated_at BEFORE UPDATE ON pending_generations FOR EACH ROW EXECUTE FUNCTION set_pending_generations_updated_at();

-- ============================================================
-- SECTION 21: PASSWORD RESET TOKENS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)');

-- ============================================================
-- SECTION 22: DELETED EMAILS BLACKLIST TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deleted_emails (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT DEFAULT 'user_deleted_account'
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_deleted_emails_email ON deleted_emails(email)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_deleted_emails_deleted_at ON deleted_emails(deleted_at)');

-- ============================================================
-- SECTION 23: EMAIL CREDIT TRACKING TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_credit_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  total_credits_given INTEGER NOT NULL DEFAULT 0,
  current_balance INTEGER NOT NULL DEFAULT 0,
  free_balance INTEGER NOT NULL DEFAULT 0,
  paid_balance INTEGER NOT NULL DEFAULT 0,
  first_registration_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_credit_tracking' AND column_name='free_balance') THEN
        ALTER TABLE email_credit_tracking ADD COLUMN free_balance INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_credit_tracking' AND column_name='paid_balance') THEN
        ALTER TABLE email_credit_tracking ADD COLUMN paid_balance INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_email_credit_tracking_email ON email_credit_tracking(email)');

-- ============================================================
-- SECTION 24: PROVIDER USAGE LOGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID,
  task_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  endpoint TEXT,
  usage JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_provider_usage_user_created ON provider_usage_logs(user_id, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_provider_usage_session ON provider_usage_logs(session_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_provider_usage_provider_model ON provider_usage_logs(provider, model, created_at DESC)');

-- ============================================================
-- SECTION 25: APP SETTINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key)');

-- Seed default settings
INSERT INTO app_settings (key, value) VALUES ('free_signup_credits_enabled', 'true') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 26: ADMIN ACTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_admin_actions_action ON admin_actions(action)');

-- ============================================================
-- SECTION 27: FINANCE LEDGER TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  side TEXT NOT NULL CHECK (side IN ('income','cost')),
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  quantity NUMERIC,
  unit TEXT,
  model_key TEXT,
  provider TEXT,
  source TEXT,
  external_id TEXT,
  metadata JSONB
);

SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_finance_ledger_created ON finance_ledger(created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_finance_ledger_category ON finance_ledger(category, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_finance_ledger_model ON finance_ledger(model_key, created_at DESC)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_finance_ledger_provider ON finance_ledger(provider, created_at DESC)');
SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS uniq_finance_external ON finance_ledger(category, external_id) WHERE external_id IS NOT NULL');

-- ============================================================
-- SECTION 28: TEMPLATES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  public BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_tool_slug ON templates(tool, slug)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_templates_public ON templates(public)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at DESC)');

-- Template updated_at function and trigger
CREATE OR REPLACE FUNCTION set_updated_at_templates()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_templates_set_updated_at ON templates;
CREATE TRIGGER trg_templates_set_updated_at BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION set_updated_at_templates();

-- ============================================================
-- SECTION 29: PRICING CONFIGURATION TABLES
-- ============================================================

-- Subscription Plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key TEXT NOT NULL,
  billing_mode TEXT NOT NULL,
  display_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  credits_per_period INTEGER NOT NULL,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_plans_key_mode ON subscription_plans (plan_key, billing_mode)');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_price ON subscription_plans (stripe_price_id)');

-- Add missing columns
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_plans' AND column_name='stripe_product_id') THEN
        ALTER TABLE subscription_plans ADD COLUMN stripe_product_id TEXT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscription_plans' AND column_name='stripe_price_id') THEN
        ALTER TABLE subscription_plans ADD COLUMN stripe_price_id TEXT;
    END IF;
END $$;

-- Seed subscription plans
INSERT INTO subscription_plans (plan_key, billing_mode, display_name, price_cents, credits_per_period, sort_order)
VALUES
  ('limited','monthly','Hobby', 199, 1000, 0),
  ('starter','monthly','Starter', 900, 4500, 1),
  ('essential','monthly','Essential', 2000, 15000, 2),
  ('pro','monthly','Pro', 5900, 32000, 3),
  ('premium','monthly','Premium', 9900, 60000, 4),
  ('starter','yearly','Starter', 8640, 4500, 1),
  ('essential','yearly','Essential', 19200, 15000, 2),
  ('pro','yearly','Pro', 56640, 32000, 3),
  ('premium','yearly','Premium', 95040, 60000, 4)
ON CONFLICT (plan_key, billing_mode) DO NOTHING;

-- Credit Packages
CREATE TABLE IF NOT EXISTS public.credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO credit_packages (display_name, credits, price_cents, sort_order)
VALUES
  ('1000 Credits', 1000, 300, 1),
  ('2000 Credits', 2000, 500, 2),
  ('3000 Credits', 3000, 700, 3),
  ('4000 Credits', 4000, 900, 4)
ON CONFLICT DO NOTHING;

-- Model Pricing
CREATE TABLE IF NOT EXISTS public.model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  unit TEXT NOT NULL,
  credit_cost_per_unit INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS ux_model_pricing_model_key ON model_pricing(model_key)');

INSERT INTO model_pricing (model_key, display_name, operation, unit, credit_cost_per_unit)
VALUES
  ('seedream-4', 'Seedream 4.0', 'image', 'image', 1),
  ('seedream-3', 'Seedream 3.0', 'image', 'image', 1),
  ('seedance-1-pro', 'Seedance 1.0 Pro', 'video', 'second', 1),
  ('seedance-1-lite', 'Seedance 1.0 Lite', 'video', 'second', 1),
  ('veo-3-fast', 'Google Veo 3 Fast', 'video', 'second', 1),
  ('veo-3-quality', 'Google Veo 3 Quality', 'video', 'second', 1)
ON CONFLICT DO NOTHING;

-- Video Variant Pricing
CREATE TABLE IF NOT EXISTS public.video_variant_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  resolution TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps INTEGER NOT NULL,
  video_tokens NUMERIC(12,4) NOT NULL,
  unit_price_usd NUMERIC(12,8) NOT NULL,
  api_cost_usd NUMERIC(12,4) NOT NULL,
  cost_in_credits NUMERIC(12,2) NOT NULL,
  cooly_credit_charge NUMERIC(12,2) NOT NULL,
  final_price_credits INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS ux_video_variant_pricing_key ON video_variant_pricing (model_key, resolution, aspect_ratio, duration_seconds) WHERE is_active = TRUE');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_variant_pricing_lookup ON video_variant_pricing (model_key, resolution, aspect_ratio, duration_seconds, is_active)');

-- Image Variant Pricing
CREATE TABLE IF NOT EXISTS public.image_variant_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  api_cost_usd NUMERIC(12,4) NOT NULL,
  cooly_credit_charge NUMERIC(12,2) NOT NULL,
  final_price_credits INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT safe_create_index('CREATE UNIQUE INDEX IF NOT EXISTS ux_image_variant_pricing_model ON image_variant_pricing (model_key) WHERE is_active = TRUE');

-- Image Generation Pricing
CREATE TABLE IF NOT EXISTS public.image_generation_pricing (
  model_key TEXT PRIMARY KEY,
  per_image_usd NUMERIC(10,6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO image_generation_pricing (model_key, per_image_usd, is_active)
VALUES
  ('seedream-4', 0.03, TRUE),
  ('seedream-3', 0.03, TRUE)
ON CONFLICT (model_key) DO UPDATE SET
  per_image_usd = EXCLUDED.per_image_usd,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Video Token Pricing
CREATE TABLE IF NOT EXISTS public.video_token_pricing (
  model_key TEXT PRIMARY KEY,
  token_usd_per_k NUMERIC(10,6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO video_token_pricing (model_key, token_usd_per_k, is_active)
VALUES
  ('seedance-1-0-pro', 0.0025, TRUE),
  ('seedance-1-0-lite', 0.0018, TRUE)
ON CONFLICT (model_key) DO UPDATE SET
  token_usd_per_k = EXCLUDED.token_usd_per_k,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- ============================================================
-- SECTION 30: VIEWS
-- ============================================================

-- Session costs view
CREATE OR REPLACE VIEW v_session_costs AS
SELECT
  s.id::text AS session_id,
  s.user_id,
  COALESCE(s.completed_at, s.created_at) AS ts,
  'image' AS product,
  COALESCE(NULLIF(s.model, ''), 'seedream') AS model_key,
  s.session_usd::numeric AS session_usd
FROM generation_sessions s
WHERE s.session_usd IS NOT NULL
UNION ALL
SELECT
  v.id::text,
  v.user_id,
  COALESCE(v.completed_at, v.created_at) AS ts,
  'video' AS product,
  COALESCE(NULLIF(v.model, ''), 'seedance') AS model_key,
  v.session_usd::numeric
FROM video_generation_sessions v
WHERE v.session_usd IS NOT NULL;

-- Sora session costs view
CREATE OR REPLACE VIEW v_sora_session_costs AS
SELECT
  s.id::text AS session_id,
  s.user_id,
  COALESCE(s.completed_at, s.created_at) AS ts,
  'video' AS product,
  COALESCE(NULLIF(s.model, ''), 'sora-2') AS model_key,
  s.session_usd::numeric AS session_usd
FROM sora_video_sessions s
WHERE s.status = 'completed';

-- Credit drift view
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

-- Lots drift view
CREATE OR REPLACE VIEW lots_drift AS
SELECT u.id AS user_id, u.email, u.credits AS user_credits,
       ect.current_balance AS lots_balance, ect.last_updated_at
FROM users u
JOIN email_credit_tracking ect ON ect.email = u.email
WHERE u.credits IS DISTINCT FROM ect.current_balance;

-- ============================================================
-- SECTION 31: TRIGGER FUNCTIONS
-- ============================================================

-- Credit ledger guard function
CREATE OR REPLACE FUNCTION app_enforce_credit_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
CREATE TRIGGER trg_users_credits_ledger AFTER UPDATE OF credits ON users FOR EACH ROW EXECUTE FUNCTION app_enforce_credit_ledger();

-- Session finalize notification function
CREATE OR REPLACE FUNCTION notify_session_finalize()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  payload json;
BEGIN
  IF NEW.reservation_id IS NOT NULL AND NEW.status IN ('completed','failed') THEN
    payload := json_build_object(
      'table', TG_TABLE_NAME,
      'session_id', NEW.id,
      'reservation_id', NEW.reservation_id,
      'status', NEW.status
    );
    PERFORM pg_notify('session_finalize', payload::text);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_finalize_image ON generation_sessions;
CREATE TRIGGER trg_notify_finalize_image AFTER UPDATE OF status ON generation_sessions FOR EACH ROW EXECUTE FUNCTION notify_session_finalize();

DROP TRIGGER IF EXISTS trg_notify_finalize_video ON video_generation_sessions;
CREATE TRIGGER trg_notify_finalize_video AFTER UPDATE OF status ON video_generation_sessions FOR EACH ROW EXECUTE FUNCTION notify_session_finalize();

-- ============================================================
-- SECTION 32: PERFORMANCE INDEXES (A2.3)
-- ============================================================

-- User session history indexes
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_gen_sessions_user_created ON generation_sessions(user_id, created_at DESC) WHERE status = ''completed''');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_video_gen_sessions_user_created ON video_generation_sessions(user_id, created_at DESC) WHERE status = ''completed''');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_sora_sessions_user_created ON sora_video_sessions(user_id, created_at DESC) WHERE status = ''completed''');
SELECT safe_create_index('CREATE INDEX IF NOT EXISTS idx_veo31_sessions_user_created ON veo31_video_sessions(user_id, created_at DESC) WHERE status = ''completed''');

-- ============================================================
-- CLEANUP
-- ============================================================

DROP FUNCTION IF EXISTS safe_create_index(text);

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT 'Migration complete' as status, count(*) as tables_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

SELECT table_name, count(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
