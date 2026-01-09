-- Veo 3.1 dedicated tables
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'veo31_video_sessions') THEN
    CREATE TABLE veo31_video_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      model TEXT NULL,
      aspect_ratio TEXT NULL,
      resolution TEXT NULL,
      video_duration INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      provider_status TEXT NULL,
      reservation_id UUID NULL,
      client_key TEXT NULL,
      task_id TEXT NULL,
      credit_cost INTEGER NULL,
      token_usage JSONB NULL,
      completion_tokens INTEGER NULL,
      total_tokens INTEGER NULL,
      token_usd_per_k NUMERIC NULL,
      session_usd NUMERIC NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE NULL
    );
    CREATE INDEX IF NOT EXISTS idx_veo31_sessions_user_created ON veo31_video_sessions(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_veo31_sessions_client_key ON veo31_video_sessions(client_key) WHERE client_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_veo31_sessions_task_id ON veo31_video_sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_veo31_sessions_model ON veo31_video_sessions(model);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'veo31_videos') THEN
    CREATE TABLE veo31_videos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES veo31_video_sessions(id) ON DELETE CASCADE,
      original_url TEXT NULL,
      b2_filename TEXT NULL,
      b2_url TEXT NULL,
      storage_provider TEXT NULL,
      file_size INTEGER NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_veo31_videos_session ON veo31_videos(session_id);
  END IF;
END $$;



