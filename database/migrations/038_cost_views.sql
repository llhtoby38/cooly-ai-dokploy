-- Unified view for session costs across images and videos
CREATE OR REPLACE VIEW v_session_costs AS
SELECT 
  s.id::text        AS session_id,
  s.user_id,
  COALESCE(s.completed_at, s.created_at) AS ts,
  'image'           AS product,
  COALESCE(NULLIF(s.model, ''), 'seedream') AS model_key,
  s.session_usd::numeric                  AS session_usd
FROM generation_sessions s
WHERE s.session_usd IS NOT NULL

UNION ALL

SELECT 
  v.id::text,
  v.user_id,
  COALESCE(v.completed_at, v.created_at)  AS ts,
  'video'         AS product,
  COALESCE(NULLIF(v.model, ''), 'seedance') AS model_key,
  v.session_usd::numeric
FROM video_generation_sessions v
WHERE v.session_usd IS NOT NULL;


