-- Pending generations table to persist in-flight optimistic tasks
CREATE TABLE IF NOT EXISTS pending_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id UUID NULL,
  session_id UUID NULL REFERENCES generation_sessions(id) ON DELETE SET NULL, -- Link to actual session if created
  tool VARCHAR(50) NOT NULL, -- e.g., 'seedream3', 'seedream4', 'seedance'
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'resolved', 'failed'
  input_settings JSONB NOT NULL, -- Snapshot of user inputs (prompt, model, outputs, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '60 minutes' -- Auto-expire after 60 mins
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pending_generations_user_id ON pending_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_generations_reservation_id ON pending_generations(reservation_id);
CREATE INDEX IF NOT EXISTS idx_pending_generations_session_id ON pending_generations(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_generations_status_expires ON pending_generations(status, expires_at);

-- Function to update updated_at on changes
CREATE OR REPLACE FUNCTION set_pending_generations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS trg_pending_generations_updated_at ON pending_generations;
CREATE TRIGGER trg_pending_generations_updated_at BEFORE UPDATE ON pending_generations FOR EACH ROW EXECUTE FUNCTION set_pending_generations_updated_at();

-- Row Level Security (RLS) for user isolation
ALTER TABLE pending_generations ENABLE ROW LEVEL SECURITY;

-- Policy to ensure users can only access their own pending generations
CREATE POLICY pending_generations_user_isolation ON pending_generations
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- Add unique constraint on reservation_id to ensure ON CONFLICT works correctly
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_pending_generations_reservation_id'
  ) THEN
    ALTER TABLE pending_generations
    ADD CONSTRAINT uq_pending_generations_reservation_id UNIQUE (reservation_id);
  END IF;
END $$;
