-- Ensure reservation linkage between credit_transactions and credit_reservations
-- Idempotent migration safe to run multiple times

BEGIN;

-- 1) Ensure credit_transactions.reservation_id exists (nullable UUID)
ALTER TABLE IF EXISTS credit_transactions
  ADD COLUMN IF NOT EXISTS reservation_id uuid;

-- 2) Ensure credit_reservations.id has a UNIQUE/PK constraint so it can be referenced
DO $$
DECLARE
  att_id  int;
  has_key boolean;
BEGIN
  SELECT attnum INTO att_id
  FROM pg_attribute
  WHERE attrelid = 'public.credit_reservations'::regclass
    AND attname  = 'id'
    AND attisdropped = false;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.credit_reservations'::regclass
      AND c.contype IN ('p','u')
      AND array_length(c.conkey,1) = 1
      AND c.conkey[1] = att_id
  ) INTO has_key;

  IF NOT has_key THEN
    -- Prefer UNIQUE to avoid conflicting with an existing PK on another column
    ALTER TABLE public.credit_reservations
      ADD CONSTRAINT ux_credit_reservations_id UNIQUE (id);
  END IF;
END $$;

-- 3) Helpful index on referencing column
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reservation_id
  ON public.credit_transactions (reservation_id);

-- 4) Add the foreign key (ON DELETE SET NULL), if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_credit_transactions_reservation'
      AND conrelid = 'public.credit_transactions'::regclass
  ) THEN
    ALTER TABLE public.credit_transactions
      ADD CONSTRAINT fk_credit_transactions_reservation
      FOREIGN KEY (reservation_id)
      REFERENCES public.credit_reservations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;


