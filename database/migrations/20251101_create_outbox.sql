-- Idempotent creation of an outbox table for reliable job dispatch
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'outbox'
  ) THEN
    CREATE TABLE outbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      reservation_id UUID NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dispatched_at TIMESTAMPTZ NULL,
      dispatch_attempts INT NOT NULL DEFAULT 0
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_outbox_dispatched_created
  ON outbox (dispatched_at, created_at);

COMMIT;


