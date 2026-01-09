-- Optional cost view for Sora sessions
CREATE OR REPLACE VIEW v_sora_session_costs AS
SELECT
  s.id::text AS session_id,
  s.user_id,
  COALESCE(s.completed_at, s.created_at) AS ts,
  'video' AS product,
  COALESCE(NULLIF(s.model, ''), 'sora-2') AS model_key,
  NULL::numeric AS session_usd
FROM sora_video_sessions s
WHERE s.status = 'completed';


