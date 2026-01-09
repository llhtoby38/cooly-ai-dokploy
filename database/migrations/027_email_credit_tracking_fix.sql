-- Ensure email_credit_tracking.id has a default and is UUID

-- 1) Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) If id is not UUID or lacks default, convert to UUID with default
DO $$
DECLARE
  col_type text;
  has_default boolean;
BEGIN
  SELECT data_type, (column_default IS NOT NULL) INTO col_type, has_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='email_credit_tracking' AND column_name='id';

  IF col_type IS NULL THEN
    -- Column missing entirely; create it
    ALTER TABLE email_credit_tracking ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
  ELSIF col_type <> 'uuid' THEN
    -- Convert to UUID; backfill values with generated UUIDs
    ALTER TABLE email_credit_tracking ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE email_credit_tracking ALTER COLUMN id TYPE uuid USING gen_random_uuid();
    ALTER TABLE email_credit_tracking ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ELSE
    -- Column is uuid; ensure default exists
    IF NOT has_default THEN
      ALTER TABLE email_credit_tracking ALTER COLUMN id SET DEFAULT gen_random_uuid();
    END IF;
  END IF;
END$$;

-- 3) Ensure primary key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.email_credit_tracking'::regclass AND contype='p'
  ) THEN
    ALTER TABLE email_credit_tracking ADD CONSTRAINT email_credit_tracking_pkey PRIMARY KEY (id);
  END IF;
END$$;


