-- 025_generation_sessions_reservation.sql
-- Adds reservation_id to generation_sessions for image flows

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='generation_sessions' AND column_name='reservation_id'
  ) THEN
    ALTER TABLE generation_sessions ADD COLUMN reservation_id UUID NULL;
  END IF;
END $$;

-- Helpful index for lookups
CREATE INDEX IF NOT EXISTS idx_generation_sessions_reservation_id
  ON generation_sessions(reservation_id);

