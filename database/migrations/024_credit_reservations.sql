-- 024_credit_reservations.sql
-- Adds credit_reservations table and reservation_id to video_generation_sessions

-- Create table for credit reservations
CREATE TABLE IF NOT EXISTS credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'reserved', -- reserved | captured | released | expired
  session_id UUID NULL, -- optional linkage to a session
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  captured_at TIMESTAMPTZ NULL,
  released_at TIMESTAMPTZ NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_status
  ON credit_reservations(user_id, status);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_created
  ON credit_reservations(created_at DESC);

-- Add reservation_id to video_generation_sessions (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'video_generation_sessions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='video_generation_sessions' AND column_name='reservation_id'
  ) THEN
    ALTER TABLE video_generation_sessions ADD COLUMN reservation_id UUID NULL;
  END IF;
END $$;


