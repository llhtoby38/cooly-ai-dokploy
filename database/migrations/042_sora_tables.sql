-- Sora 2 dedicated tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sora_video_sessions') THEN
    CREATE TABLE sora_video_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      model TEXT NULL,
      aspect_ratio TEXT NULL,
      resolution TEXT NULL,
      video_duration INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      -- optional pricing fields can be added later; omit credit_cost for now
      reservation_id UUID NULL,
      client_key TEXT NULL,
      task_id TEXT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sora_sessions_user_created ON sora_video_sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sora_sessions_client_key ON sora_video_sessions(client_key);
    CREATE INDEX IF NOT EXISTS idx_sora_sessions_task_id ON sora_video_sessions(task_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sora_videos') THEN
    CREATE TABLE sora_videos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES sora_video_sessions(id) ON DELETE CASCADE,
      original_url TEXT NULL,
      b2_filename TEXT NULL,
      b2_url TEXT NULL,
      storage_provider TEXT NULL,
      file_size INTEGER NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sora_videos_session ON sora_videos(session_id);
  END IF;
END $$;


