-- Backfill credit_transactions from existing history tables

WITH all_tx AS (
  -- Images
  SELECT 
    s.user_id,
    (
      CASE 
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%seedream-4%' THEN 'Seedream 4.0 image generation'
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%seedream-3%' THEN 'Seedream 3.0 image generation'
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%sd%' THEN 'Stable Diffusion image generation'
        WHEN COALESCE(s.model, '') <> '' THEN s.model || ' image generation'
        ELSE 'Image generation'
      END
    ) AS description,
    -COALESCE(s.credit_cost, 0) AS amount,
    s.created_at
  FROM generation_sessions s
  WHERE COALESCE(s.credit_cost, 0) <> 0

  UNION ALL

  -- Videos
  SELECT 
    s.user_id,
    (
      CASE 
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%seedance%' AND LOWER(s.model) LIKE '%pro%' THEN 'Seedance 1.0 Pro video generation'
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%seedance%' AND LOWER(s.model) LIKE '%lite%' THEN 'Seedance 1.0 Lite video generation'
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%veo%' AND (LOWER(s.model) LIKE '%fast%' OR LOWER(s.model) LIKE '%turbo%' OR LOWER(s.model) LIKE '%lite%' OR LOWER(s.model) LIKE '%speed%') THEN 'Google Veo 3 Fast video generation'
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%veo%' AND (LOWER(s.model) LIKE '%quality%' OR LOWER(s.model) LIKE '%standard%' OR LOWER(s.model) LIKE '%std%' OR LOWER(s.model) LIKE '%default%') THEN 'Google Veo 3 Quality video generation'
        WHEN LOWER(COALESCE(s.model, '')) LIKE '%veo%' THEN 'Google Veo 3 video generation'
        WHEN COALESCE(s.model, '') <> '' THEN s.model || ' video generation'
        ELSE 'Video generation'
      END
    ) AS description,
    -COALESCE(s.credit_cost, 0) AS amount,
    s.created_at
  FROM video_generation_sessions s
  WHERE COALESCE(s.credit_cost, 0) <> 0

  UNION ALL

  -- Purchases
  SELECT 
    p.user_id,
    'Credits purchased' AS description,
    COALESCE(p.credits_added, 0) AS amount,
    p.created_at
  FROM credit_purchases p
  WHERE COALESCE(p.credits_added, 0) <> 0
),
ordered AS (
  SELECT 
    user_id,
    description,
    amount,
    created_at,
    SUM(amount) OVER (
      PARTITION BY user_id 
      ORDER BY created_at, description, amount
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS balance_after
  FROM all_tx
)
INSERT INTO credit_transactions (user_id, description, amount, balance_after, created_at)
SELECT user_id, description, amount, balance_after, created_at
FROM ordered
ORDER BY created_at;


