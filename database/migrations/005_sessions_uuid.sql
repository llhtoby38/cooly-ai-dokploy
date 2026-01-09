-- 005_sessions_uuid.sql
-- Align generation_sessions.id and images.session_id to UUID to satisfy FK constraint with Supabase schema

-- Note: This migration DROPS existing images and generation_sessions tables.
-- Run only if you don't need to preserve dev data. For production, write a proper ALTER / data copy.

DROP TABLE IF EXISTS images CASCADE;
DROP TABLE IF EXISTS generation_sessions CASCADE;

-- Re-create generation_sessions with uuid PK
CREATE TABLE generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Re-create images table referencing generation_sessions(id)
CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES generation_sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL
);
