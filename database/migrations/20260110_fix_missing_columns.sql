-- 20260110_fix_missing_columns.sql
-- Fix missing columns in various tables that exist in production but were never properly migrated

-- Add guidance_scale to generation_sessions (used by Seedream 4.0)
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

-- Add negative_prompt to generation_sessions (used by Seedream 4.0)
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

-- Add seed to generation_sessions (used by Seedream 4.0)
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

-- Add billing_mode to subscriptions (used by billing.js)
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

-- Add resolution to video_generation_sessions (used by Seedance, Sora2, Veo)
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

-- Add video_duration to video_generation_sessions
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

-- Add provider_status to video_generation_sessions (used by Veo)
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

-- Add storage_status to video_generation_sessions
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
