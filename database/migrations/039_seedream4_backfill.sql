-- Backfill Seedream 4.0 sessions: finalize completed sessions, fail stale ones, and populate client_key where possible
-- This migration is idempotent and safe to re-run.

BEGIN;

-- 2A) Mark sessions as completed if they have images; set completed_at and duration_ms if missing
WITH done AS (
  SELECT
    s.id AS session_id,
    GREATEST(MAX(COALESCE(i.completed_at, i.created_at)), s.created_at) AS done_at
  FROM generation_sessions s
  JOIN images i ON i.session_id = s.id
  WHERE (LOWER(s.model) LIKE 'seedream-4%' OR EXISTS (
           SELECT 1 FROM images i2 WHERE i2.session_id = s.id AND i2.generation_tool = 'byteplus-seedream-4'
         ))
  GROUP BY s.id, s.created_at
)
UPDATE generation_sessions s
SET
  status = 'completed',
  completed_at = COALESCE(s.completed_at, d.done_at),
  duration_ms = COALESCE(
    s.duration_ms,
    ROUND(EXTRACT(EPOCH FROM (COALESCE(d.done_at, s.completed_at) - s.created_at)) * 1000)
  )::bigint
FROM done d
WHERE s.id = d.session_id
  AND s.status IS DISTINCT FROM 'completed';

-- 2B) Fail long-stuck sessions with no images (older than 2 hours)
WITH stale AS (
  SELECT s.id
  FROM generation_sessions s
  LEFT JOIN images i ON i.session_id = s.id
  WHERE (s.status IN ('processing','pending') OR s.status IS NULL)
    AND i.id IS NULL
    AND s.created_at < now() - interval '2 hours'
    AND (LOWER(s.model) LIKE 'seedream-4%' OR EXISTS (
          SELECT 1 FROM images i2 WHERE i2.session_id = s.id AND i2.generation_tool = 'byteplus-seedream-4'
        ))
)
UPDATE generation_sessions s
SET
  status = 'failed',
  completed_at = COALESCE(s.completed_at, now()),
  duration_ms = COALESCE(
    s.duration_ms,
    ROUND(EXTRACT(EPOCH FROM (COALESCE(s.completed_at, now()) - s.created_at)) * 1000)
  )::bigint
FROM stale t
WHERE s.id = t.id;

-- 2C) Populate missing client_key on sessions from any image.client_key
WITH picked AS (
  SELECT s.id,
         MAX(i.client_key) FILTER (WHERE i.client_key IS NOT NULL) AS new_key
  FROM generation_sessions s
  LEFT JOIN images i ON i.session_id = s.id
  WHERE s.client_key IS NULL
    AND (LOWER(s.model) LIKE 'seedream-4%' OR EXISTS (
          SELECT 1 FROM images i2 WHERE i2.session_id = s.id AND i2.generation_tool = 'byteplus-seedream-4'
        ))
  GROUP BY s.id
)
UPDATE generation_sessions s
SET client_key = p.new_key
FROM picked p
WHERE s.id = p.id
  AND p.new_key IS NOT NULL;

COMMIT;


