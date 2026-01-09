const db = require('../db');

function normalizeModelKey(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('pro')) return 'seedance-1-0-pro';
  if (m.includes('lite')) return 'seedance-1-0-lite';
  // Veo 3.1 first (to avoid matching generic 'veo-3')
  if ((m.includes('veo-3.1') || m.includes('veo3.1') || m.includes('veo31') || m.includes('veo-3-1')) && m.includes('quality')) return 'veo-3-1-quality';
  if ((m.includes('veo-3.1') || m.includes('veo3.1') || m.includes('veo31') || m.includes('veo-3-1')) && m.includes('fast')) return 'veo-3-1-fast';
  // Legacy Veo 3 mapping remains
  if (m.includes('veo') && m.includes('quality')) return 'veo-3-quality';
  if (m.includes('veo') && m.includes('fast')) return 'veo-3-fast';
  return m; // passthrough
}

async function getVariantPriceCredits(model, resolution, aspectRatio, durationSeconds) {
  const modelKey = normalizeModelKey(model);
  // 1) Veo 3.1 dedicated table takes precedence
  if (modelKey.startsWith('veo-3-1-')) {
    const { rows } = await db.query(
      `SELECT credits_per_second FROM veo31_video_pricing
       WHERE model_key = $1 AND LOWER(resolution) = LOWER($2) AND aspect_ratio = $3 AND is_active = TRUE
       LIMIT 1`,
      [modelKey, resolution, aspectRatio]
    );
    if (rows[0]?.credits_per_second != null) {
      const cps = Number(rows[0].credits_per_second || 0);
      const secs = Math.max(0, Number(durationSeconds) || 0);
      return Math.ceil(cps * secs);
    }
  }
  const { rows } = await db.query(
    `SELECT final_price_credits FROM video_variant_pricing
     WHERE model_key = $1 AND resolution = $2 AND aspect_ratio = $3 AND duration_seconds = $4 AND is_active = TRUE
     LIMIT 1`,
    [modelKey, resolution, aspectRatio, Number(durationSeconds)]
  );
  return rows[0]?.final_price_credits || null;
}

async function getPerSecondFallbackCredits(model, durationSeconds) {
  // Use existing model_pricing per-second when variant row absent
  const modelKey = normalizeModelKey(model)
    .replace('seedance-1-0-pro', 'seedance-1-pro')
    .replace('seedance-1-0-lite', 'seedance-1-lite');
  const { rows } = await db.query(
    `SELECT credit_cost_per_unit FROM model_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
    [modelKey]
  );
  const perSec = Number(rows[0]?.credit_cost_per_unit || 0);
  const secs = Math.max(0, Number(durationSeconds) || 0);
  return Math.ceil(perSec * secs);
}

async function computeVideoCredits(model, resolution, aspectRatio, durationSeconds) {
  const variant = await getVariantPriceCredits(model, resolution, aspectRatio, durationSeconds);
  if (variant != null) return variant;
  return await getPerSecondFallbackCredits(model, durationSeconds);
}

module.exports = {
  computeVideoCredits,
};

// Helpers to fetch USD pricing from reference tables
async function getImagePerUsd(model) {
  const mk = normalizeModelKey(model).startsWith('seedream-4') ? 'seedream-4' : 'seedream-3';
  const { rows } = await db.query(
    `SELECT per_image_usd FROM image_generation_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
    [mk]
  );
  return Number(rows[0]?.per_image_usd || 0);
}

async function getVideoUsdPerK(model) {
  const mk = normalizeModelKey(model);
  const key = mk.includes('pro') ? 'seedance-1-0-pro' : 'seedance-1-0-lite';
  const { rows } = await db.query(
    `SELECT token_usd_per_k FROM video_token_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
    [key]
  );
  return Number(rows[0]?.token_usd_per_k || 0);
}

module.exports.getImagePerUsd = getImagePerUsd;
module.exports.getVideoUsdPerK = getVideoUsdPerK;

// Sora pricing helper (USD/credits per second table)
module.exports.getSoraPricePerSecond = async function getSoraPricePerSecond(model, resolution) {
  const modelKey = String(model || '').toLowerCase();
  const resKey = String(resolution || '').toLowerCase();
  const { rows } = await db.query(
    `SELECT price_per_second, credits_per_second FROM sora_video_pricing WHERE model_key = $1 AND LOWER(resolution) = $2 AND is_active = TRUE LIMIT 1`,
    [modelKey, resKey]
  );
  return rows[0] || null;
};


