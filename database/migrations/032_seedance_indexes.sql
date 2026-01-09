-- Indexes to accelerate Seedance sweeper queries and lookups

-- For scanning processing sessions by age
CREATE INDEX IF NOT EXISTS idx_vgs_status_created_at
  ON video_generation_sessions(status, created_at);

-- For quick existence checks of videos by session
CREATE INDEX IF NOT EXISTS idx_videos_session_id
  ON videos(session_id);


