const express = require('express');
const axios = require('axios');
const { randomUUID } = require('crypto');
const auth = require('../middleware/auth');
const db = require('../db');
const { reserveCredits, captureReservation, releaseReservation } = require('../utils/credits');
const { uploadSeedreamImage, streamUrlToB2 } = require('../utils/storage');
const router = express.Router();
const { getReqLogger } = require('../utils/logger');
const { getBooleanSetting } = require('../utils/appSettings');

// Backend mock mode via feature flags or env
const { shouldMock, getSetting } = require('../utils/featureFlags');
let MOCK_MODE = false;
// Progress endpoint to allow frontend polling per session
router.get('/progress/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const entry = generationProgress.get(sessionId);
    if (!entry) return res.json({ progress: [] });
    if (entry.userId && entry.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json({ progress: entry.progress || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get progress' });
  }
});

const IMG_API_KEY = process.env.BYTEPLUS_ARK_API_KEY || process.env.RENDER_ARK_API_KEY;

// In-memory per-session progress tracker: Map<sessionId, { userId: string, progress: number[], createdAt: number }>
const generationProgress = new Map();
// Track the most recently created processing session per user so clients can poll before
// they know the sessionId (optimistic UI phase)
// Map<userId, { sessionId: string, createdAt: number }>
const latestSessionByUser = new Map();

// Cleanup old entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  const oneHourAgo = now - 3600000; // 1 hour
  
  // Clean up old progress entries
  for (const [sessionId, entry] of generationProgress.entries()) {
    if (entry.createdAt && entry.createdAt < oneHourAgo) {
      generationProgress.delete(sessionId);
    }
  }
  
  // Clean up old user session entries
  for (const [userId, entry] of latestSessionByUser.entries()) {
    if (entry.createdAt && entry.createdAt < oneHourAgo) {
      latestSessionByUser.delete(userId);
    }
  }
}, 300000); // 5 minutes

// Generate images and persist them for the authenticated user
const COST_PER_IMAGE = 1; // fallback if pricing lookup fails

async function computeImageCredits(model, outputs) {
  // Resolve mock mode lazily per-request (uses app_settings feature flags)
  try { MOCK_MODE = await shouldMock('seedream3'); } catch { MOCK_MODE = false; }
  // Input validation
  if (!model || typeof model !== 'string') {
    throw new Error('Invalid model parameter');
  }
  if (!Number.isInteger(outputs) || outputs < 1 || outputs > 10) {
    throw new Error('Invalid outputs parameter: must be integer between 1 and 10');
  }

  try {
    const m = String(model).toLowerCase();
    const key = m.includes('seedream-3') ? 'seedream-3' : (m.includes('seedream-4') ? 'seedream-4' : m);
    // 1) Try image_variant_pricing first (preferred exact table)
    const ivp = await db.query(
      `SELECT final_price_credits FROM image_variant_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
      [key]
    );
    if (ivp.rows.length > 0) {
      const perImage = Math.max(1, Number(ivp.rows[0].final_price_credits || 0));
      return perImage * Math.max(1, Number(outputs) || 1);
    }
    // 2) Fallback to model_pricing per-output
    const mp = await db.query(
      `SELECT credit_cost_per_unit FROM model_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
      [key]
    );
    const perImage = Number(mp.rows[0]?.credit_cost_per_unit || COST_PER_IMAGE);
    return Math.max(1, Math.ceil(perImage)) * Math.max(1, Number(outputs) || 1);
  } catch {
    return Math.max(1, Number(outputs) || 1) * COST_PER_IMAGE;
  }
}

// Download image from BytePlus and upload to B2 (streaming)
async function downloadAndUploadToB2(imageUrl, sessionId, model) {
  try {
    const rlog = getReqLogger(null, 'seedream3');
    try { rlog.info({ event: 'download.start', url: imageUrl, tool: 'byteplus-seedream' }); } catch {}

    const MAX_BYTES = Math.max(1, Number(process.env.MAX_IMAGE_DOWNLOAD_BYTES || 20 * 1024 * 1024)); // 20MB default

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const filename = `img_${sessionId}_${timestamp}_${randomId}.png`;
    
    try { rlog.info({ event: 'upload.start', filename, tool: 'byteplus-seedream' }); } catch {}
    const streamed = await streamUrlToB2({ url: imageUrl, filename, contentType: 'image/png', tool: 'byteplus-seedream', timeoutMs: 30000, maxBytes: MAX_BYTES });
    
    return {
      original_url: imageUrl,
      b2_url: streamed.url,
      b2_filename: filename,
      file_size: streamed.bytes || null,
      b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream'
    };
  } catch (error) {
    try { rlog.error({ event: 'upload.error', msg: error?.message || String(error) }); } catch {}
    throw new Error(`Image processing failed: ${error.message}`);
  }
}

router.post('/generate', auth, async (req, res) => {
  const requestStartMs = Date.now();
  const {
    prompt,
    model = "seedream-3-0-t2i-250415",
    response_format = "url",
    size = "1024x1024",
    guidance_scale = 3,
    outputs = 1, // number of images requested from the client
    aspect_ratio = null, // aspect ratio selected by the user
    clientKey = undefined // optional client-provided key for optimistic matching
  } = req.body;

  // Input validation
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt is required and must be a non-empty string' });
  }
  if (prompt.length > 5000) {
    return res.status(400).json({ error: 'Prompt too long (max 5000 characters)' });
  }
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'Model is required' });
  }
  const requested = Number(outputs) || 1;
  if (requested < 1 || requested > 10) {
    return res.status(400).json({ error: 'Outputs must be between 1 and 10' });
  }
  if (guidance_scale && (guidance_scale < 1 || guidance_scale > 20)) {
    return res.status(400).json({ error: 'Guidance scale must be between 1 and 20' });
  }

  const cost = await computeImageCredits(model, requested);

  try { getReqLogger(req, 'seedream3').info({ event: 'start', requested, cost, model }); } catch {}

  // Reserve credits first
  const label = model && String(model).toLowerCase().includes('seedream-3') ? 'Seedream 3.0' : (model || 'Image');
  const ttl = Number(process.env.RESERVATION_TTL_SECONDS || 600);
  const reserve = await reserveCredits(req.user.userId, cost, { description: `${label} (reservation)`, ttlSeconds: ttl });
  if (!reserve.success) {
    return res.status(402).json({ error: reserve.error || 'Credit check failed' });
  }

  // Initialize progress tracking for this session (0%) - will be updated with actual session ID
  const tempSessionId = randomUUID();
  generationProgress.set(tempSessionId, { userId: req.user.userId, progress: Array(requested).fill(0), createdAt: Date.now() });

  let actualSessionId; // Declare outside try block for scope access
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Create session row (uuid primary key generated by default)
    const tInsertSession0 = Date.now();
    const { rows: sessionRows } = await client.query(
      'INSERT INTO generation_sessions (user_id, prompt, outputs, aspect_ratio, model, status, resolution, guidance_scale, credit_cost, reservation_id, client_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING id',
      [req.user.userId, prompt, outputs, aspect_ratio, model, 'processing', size, guidance_scale, cost, reserve.reservationId, clientKey || null]
    );
    actualSessionId = sessionRows[0].id;
    try { getReqLogger(req, 'seedream3').info({ event: 'insertSession', elapsedMs: Date.now() - tInsertSession0, sessionId: actualSessionId }); } catch {}
    latestSessionByUser.set(req.user.userId, { sessionId: actualSessionId, createdAt: Date.now() });
    
    // Update progress tracking with actual session ID
    const tempProgress = generationProgress.get(tempSessionId);
    if (tempProgress) {
      generationProgress.set(actualSessionId, { ...tempProgress, createdAt: Date.now() });
      generationProgress.delete(tempSessionId);
    }

    // Progress setter (session already initialized)
    const requestedCount = requested;
    const setProgress = (index, value) => {
      const entry = generationProgress.get(actualSessionId);
      if (!entry) return;
      entry.progress[index] = Math.max(0, Math.min(100, Math.round(value)));
    };
    // No visual milestone here; next milestone is 10% when provider request is sent

    // Short-circuit with mock generation if MOCK_MODE is enabled
    if (MOCK_MODE) {
      // Create mock image URLs
      await client.query('COMMIT');
      const bal = null;
      res.json({ success: true, sessionId: actualSessionId, reservation_id: reserve.reservationId, status: 'processing', creditsUsed: cost, creditsLeft: bal?.credits });

      // Background staged completion
      const minMs = Number(process.env.SEEDREAM3_MOCK_MIN_MS || 8000);
      const maxMs = Number(process.env.SEEDREAM3_MOCK_MAX_MS || 14000);
      const jitter = Math.max(0, (maxMs - minMs));
      const totalMs = minMs + Math.floor(Math.random() * (jitter + 1));
      const stages = [10, 25, 60, 85, 100];
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const start = Date.now();
      for (let i = 0; i < stages.length; i++) {
        const target = Math.round(totalMs * (i + 1) / stages.length) - (Date.now() - start);
        if (target > 0) await sleep(target);
        try {
          const entry = generationProgress.get(actualSessionId);
          if (entry) {
            for (let k = 0; k < entry.progress.length; k++) entry.progress[k] = Math.max(entry.progress[k], stages[i]);
          }
        } catch {}
        if (stages[i] === 60) {
          try {
            const urls = Array.from({ length: requested }).map((_, idx) => `https://picsum.photos/1024/1024?random=${Date.now()}-${idx}`);
            const uploadMock = await getBooleanSetting('upload_mock_outputs_to_b2', false);
            if (uploadMock) {
              const { streamUrlToB2 } = require('../utils/storage');
              const MAX_BYTES = Math.max(1, Number(process.env.MAX_IMAGE_DOWNLOAD_BYTES || 20 * 1024 * 1024));
              const results = await Promise.all(urls.map(async (_url, idx) => {
                const fname = `seedream3_mock_${actualSessionId}_${Date.now()}_${idx}.png`;
                try {
                  const streamed = await streamUrlToB2({ url: _url, filename: fname, contentType: 'image/png', tool: 'byteplus-seedream', timeoutMs: 30000, maxBytes: MAX_BYTES });
                  return { original_url: _url, b2_url: streamed.url, b2_filename: fname, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream', file_size: streamed.bytes || null, storage_provider: 'b2' };
                } catch (_) {
                  return { original_url: _url, b2_url: _url, b2_filename: fname, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream', file_size: null, storage_provider: 'mock' };
                }
              }));
              await Promise.all(results.map((img, idx) => db.query(
                `INSERT INTO images (session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, client_key, created_at, completed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
                [actualSessionId, img.original_url, img.b2_filename, img.b2_url, img.b2_folder, img.file_size, img.storage_provider, 'byteplus-seedream', clientKey || null]
              )));
            } else {
              await Promise.all(urls.map((url, idx) => db.query(
                `INSERT INTO images (session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, client_key, created_at, completed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
                [actualSessionId, url, `seedream3_mock_${actualSessionId}_${Date.now()}_${idx}.png`, url, process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream', null, 'mock', 'byteplus-seedream', clientKey || null]
              )));
            }
          } catch (e) { console.error('[seedream3][mock] attach failed', e?.message || e); }
        }
      }
      try {
        await db.query('UPDATE generation_sessions SET status=$1, completed_at=NOW(), duration_ms=$3 WHERE id=$2', ['completed', actualSessionId, Date.now() - requestStartMs]);
        // Immediately capture reservation for mock flow as well
        try { await captureReservation(reserve.reservationId, { description: label }); } catch (_) {}
      } catch (e) { console.error('[seedream3][mock] finalize failed', e?.message || e); }
      return;
    }

    const fetchSingleImage = async (index) => {
      setProgress(index, 10);
      const tProvider0 = Date.now();
      const resp = await axios.post(
        'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations',
        {
          model,
          prompt,
          response_format,
          size,
          guidance_scale,
          watermark: false,
          n: 1
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${IMG_API_KEY}`
          }
        }
      );
      try { getReqLogger(req, 'seedream3').info({ event: 'provider.request', elapsedMs: Date.now() - tProvider0, sessionId: actualSessionId }); } catch {}
      const dat = resp.data;
      try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId: actualSessionId, provider: 'byteplus', model, endpoint: 'images/generations', raw: dat }); } catch(_) {}
      if (process.env.NODE_ENV !== 'production') { try { getReqLogger(req, 'seedream3').debug({ event: 'usage.debug', usage: dat?.usage || dat?.data?.usage || null }); } catch {} }
      let urlsInner = [];
      if (dat?.data) {
        urlsInner = dat.data.map(item => item.url).filter(Boolean);
      } else if (dat?.url) {
        urlsInner = [dat.url];
      }
      try { getReqLogger(req, 'seedream3').info({ event: 'provider.response', urls: urlsInner.length }); } catch {}
      setProgress(index, 40);
      const usage = (typeof dat === 'object' && (dat.usage || dat.data?.usage)) ? (dat.usage || dat.data?.usage) : null;
      return { urls: urlsInner, usage };
    };

    // Generate images in parallel as needed
    let allUrls = [];
    let lastUsage = null;
    if (requested === 1) {
      const one = await fetchSingleImage(0);
      allUrls = one?.urls || [];
      lastUsage = one?.usage || null;
    } else {
      const arrs = await Promise.all(
        Array.from({ length: requested }).map((_, idx) => fetchSingleImage(idx))
      );
      arrs.forEach(o => {
        if (o?.urls) allUrls.push(...o.urls);
        if (!lastUsage && o?.usage) lastUsage = o.usage;
      });
    }

    // Download and upload to B2
    if (allUrls.length) {
      const storedImages = [];
      
      for (let i = 0; i < allUrls.length; i++) {
        const url = allUrls[i];
        try {
          setProgress(i, 60);
          const tDlUp0 = Date.now();
          const result = await downloadAndUploadToB2(url, actualSessionId, model);
        try { getReqLogger(req, 'seedream3').info({ event: 'download.upload', elapsedMs: Date.now() - tDlUp0, filename: result.b2_filename }); } catch {}
          setProgress(i, 85);
          storedImages.push(result);
        } catch (error) {
          console.error(`❌ Failed to process image ${url}:`, error);
          // Continue with other images
        }
      }

      // Store permanent URLs in database
      if (storedImages.length > 0) {
        const tImgInsert0 = Date.now();
        await Promise.all(
          storedImages.map((img, idx) =>
            client.query(
              `INSERT INTO images (
                session_id, 
                url, 
                b2_filename, 
                b2_url, 
                b2_folder, 
                file_size, 
                storage_provider,
                generation_tool,
                client_key,
                created_at,
                completed_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
              [
                actualSessionId, 
                img.original_url, 
                img.b2_filename, 
                img.b2_url, 
                img.b2_folder, 
                img.file_size, 
                'b2',
                'byteplus-seedream',
                clientKey || null
              ]
            ).then(() => setProgress(idx, 100))
          )
        );
        try { getReqLogger(req, 'seedream3').info({ event: 'insert.images', elapsedMs: Date.now() - tImgInsert0, count: storedImages.length }); } catch {}
        // Persist USD costs and token usage if present
        try {
          const usage = (typeof dat === 'object' && (dat.usage || dat.data?.usage)) ? (dat.usage || dat.data?.usage) : null;
          if (usage) {
            await client.query('UPDATE generation_sessions SET token_usage = $1, completion_tokens = $2, total_tokens = $3 WHERE id = $4', [JSON.stringify(usage), Number(usage.completion_tokens) || null, Number(usage.total_tokens) || null, actualSessionId]);
          }
          // Per-image USD price (fixed 0.03) and session USD = per_image * outputs
          const { getImagePerUsd } = require('../utils/videoPricing');
          const perImageUsd = await getImagePerUsd(model);
          const outputsNum = Math.max(1, Number(requested) || 1);
          const sessionUsd = perImageUsd * outputsNum;
          await client.query('UPDATE generation_sessions SET per_image_usd = $1, session_usd = $2 WHERE id = $3', [perImageUsd || null, sessionUsd || null, actualSessionId]);
        } catch (_) {}
        
        // Mark session completed
        const tComplete0 = Date.now();
        await client.query(
          'UPDATE generation_sessions SET status = $1, completed_at = NOW() WHERE id = $2', 
          ['completed', actualSessionId]
        );
        // Immediately capture reservation to keep balances and history in sync (worker remains fallback)
        try { await captureReservation(reserve.reservationId, { description: label }); } catch (_) {}
        // Do not block on capture; worker will finalize via NOTIFY for other cases
        try { getReqLogger(req, 'seedream3').info({ event: 'complete.session', elapsedMs: Date.now() - tComplete0, storedCount: storedImages.length }); } catch {}
      }
    } else {
      await client.query(
        'UPDATE generation_sessions SET status = $1 WHERE id = $2', 
        ['failed', actualSessionId]
      );
      try { await releaseReservation(reserve.reservationId); } catch(_) {}
    }

    await client.query('COMMIT');

    // Return results
    const tFetchImgs0 = Date.now();
    const { rows: imageRows } = await client.query(
      'SELECT * FROM images WHERE session_id = $1',
      [actualSessionId]
    );
    try { getReqLogger(req, 'seedream3').debug({ event: 'fetch.images', elapsedMs: Date.now() - tFetchImgs0 }); } catch {}

    // Compute total time and persist to DB
    const totalMs = Date.now() - requestStartMs;
    try {
      await db.query('UPDATE generation_sessions SET duration_ms = $1 WHERE id = $2', [totalMs, actualSessionId]);
    } catch (e) {
      console.error('[gen][durationPersistError]', e?.message || e);
    }

    res.json({
      success: true,
      sessionId: actualSessionId,
      clientKey: clientKey || null,
      reservation_id: reserve.reservationId,
      images: imageRows.map(img => ({
        id: img.id,
        url: img.b2_url || img.url, // Use B2 URL if available
        original_url: img.url,
        filename: img.b2_filename,
        file_size: img.file_size,
        generation_tool: img.generation_tool
      })),
      creditsUsed: cost
    });
    try { getReqLogger(req, 'seedream3').info({ event: 'total', totalMs, sessionId: actualSessionId }); } catch {}
  } catch (err) {
    await client.query('ROLLBACK');
    try { 
      if (reserve?.reservationId) {
        await releaseReservation(reserve.reservationId, { 
          description: `Generation failed: ${err.message}` 
        });
      }
    } catch (releaseErr) {
      console.error('Failed to release reservation:', releaseErr);
    }
    
    console.error('Image generation error:', err);
    
    // Provide more specific error messages
    let errorMessage = 'Generation failed';
    if (err.response?.status === 400) {
      errorMessage = 'Invalid request parameters';
    } else if (err.response?.status === 401) {
      errorMessage = 'Authentication failed';
    } else if (err.response?.status === 429) {
      errorMessage = 'Rate limit exceeded, please try again later';
    } else if (err.response?.data) {
      errorMessage = err.response.data;
    } else if (err.message) {
      errorMessage = err.message;
    }
    
    res.status(err.response?.status || 500).json({ error: errorMessage });
  } finally {
    client.release();
    // Clean up latest session pointer when generation finishes (best-effort)
    try {
      const current = latestSessionByUser.get(req.user.userId);
      if (current && current.sessionId === sessionId) {
        latestSessionByUser.delete(req.user.userId);
      }
    } catch {}
  }
});

// Exact image price endpoint
// Public price endpoint so logged-out users can see costs
router.post('/price', async (req, res) => {
  try {
    const { model = 'seedream-3-0-t2i-250415', outputs = 1 } = req.body || {};
    const credits = await computeImageCredits(model, outputs);
    return res.json({ credits, exact: true }); // per-output fixed; treated as exact
  } catch (e) {
    return res.status(500).json({ error: 'Failed to compute price' });
  }
});

// Fetch image history for the authenticated user
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default 10 items per page
    const offset = parseInt(req.query.offset) || 0; // Default start from beginning
    const modelLike = (req.query.model_like || '').trim();

    // Build WHERE with optional model filter
    const whereParts = ['s.user_id = $1'];
    const params = [req.user.userId];
    if (modelLike) {
      whereParts.push('LOWER(s.model) LIKE LOWER($2)');
      params.push(modelLike);
    }
    params.push(limit);
    params.push(offset);
    const whereSql = whereParts.join(' AND ');

    const { rows } = await db.query(
      `SELECT s.id AS session_id, s.prompt, s.model, s.status, s.created_at, s.completed_at, s.outputs, s.aspect_ratio, s.resolution, s.guidance_scale, s.credit_cost, i.url, i.b2_url
       FROM generation_sessions s
       LEFT JOIN images i ON i.session_id = s.id
       WHERE ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    // Also get total count for pagination info
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM generation_sessions s WHERE ${whereSql}`,
      modelLike ? [req.user.userId, modelLike] : [req.user.userId]
    );

    res.json({
      items: rows,
      pagination: {
        total: parseInt(countRows[0].total),
        limit,
        offset,
        hasMore: offset + limit < parseInt(countRows[0].total)
      }
    });
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Estimate average generation duration (ms) based on past completed sessions
router.get('/estimate', auth, async (req, res) => {
  try {
    // Average of the previous up to 32 completed generations for the requested outputs
    const outputs = Number(req.query.outputs || 0) || null;
    const params = [];
    let sql = `
      WITH recent AS (
        SELECT duration_ms AS ms
        FROM generation_sessions
        WHERE status = 'completed'
          AND duration_ms IS NOT NULL
          AND duration_ms > 0`;
    if (outputs) {
      params.push(outputs);
      sql += ` AND outputs = $${params.length}`;
    }
    sql += `
        ORDER BY completed_at DESC
        LIMIT 32
      )
      SELECT AVG(ms) AS avg_ms, COUNT(*) AS sample_size FROM recent
    `;
    const { rows } = await db.query(sql, params);
    const avgMsRaw = Number(rows[0]?.avg_ms || 0);
    const avgMs = Math.max(0, Math.round(avgMsRaw));
    const sampleSize = Number(rows[0]?.sample_size || 0);

    // Fallbacks by outputs if we have no (valid) history
    const DEFAULTS = {
      1: 10000,
      2: 11000,
      3: 12000,
      4: 13000,
      5: 14000,
      6: 15000,
      7: 16000,
      8: 17000
    };
    const defaultMs = outputs && DEFAULTS[outputs] ? DEFAULTS[outputs] : 10000;
    // Add 2 seconds (2000ms) to the calculated average from database
    const adjustedAvgMs = sampleSize > 0 && avgMs > 0 ? avgMs + 2000 : 0;
    const estimate = sampleSize > 0 && avgMs > 0 ? adjustedAvgMs : defaultMs;
    try { getReqLogger(req, 'seedream3').debug({ event: 'estimate', outputs: outputs ?? 'any', sampleSize, averageMs: estimate, raw: avgMsRaw }); } catch {}
    return res.json({ averageMs: estimate, sampleSize, outputs: outputs ?? null });
  } catch (err) {
    console.error('Estimate computation error:', err);
    return res.status(500).json({ error: 'Failed to compute estimate' });
  }
});

module.exports = router;
 
// Simple proxy to serve remote images through our backend (helps with referrer/CORS/hotlink issues)
// Usage: GET /api/image/proxy?url=https%3A%2F%2F...
router.get('/proxy', async (req, res) => {
  try {
    let { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Basic safety: allow only http/https
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Invalid URL protocol' });
    }

    // Convert public MinIO URLs back to internal Docker URLs for local development
    // This handles cases where S3_PUBLIC_URL (localhost:9000) was used for browser-facing URLs
    // but the backend needs to use S3_ENDPOINT (minio:9000) for internal access
    const s3PublicUrl = process.env.S3_PUBLIC_URL;
    const s3Endpoint = process.env.S3_ENDPOINT;
    if (s3PublicUrl && s3Endpoint && url.startsWith(s3PublicUrl.replace(/\/$/, ''))) {
      url = url.replace(s3PublicUrl.replace(/\/$/, ''), s3Endpoint.replace(/\/$/, ''));
    }
    // Also handle common localhost:9000 -> minio:9000 conversion for Docker networking
    if (process.env.S3_ENDPOINT && /^http:\/\/(localhost|127\.0\.0\.1):9000\//i.test(url)) {
      url = url.replace(/^http:\/\/(localhost|127\.0\.0\.1):9000\//i, 'http://minio:9000/');
    }

    // Fetch with sensible defaults (buffer, not stream, to avoid HTTP/2 stream issues)
    // Decide headers dynamically based on target host
    const targetHost = (() => {
      try { return new URL(url).hostname || ''; } catch { return ''; }
    })();
    const needsAuth = /byteplus|ark-content|ark\.|bytepluses\.com/i.test(targetHost);
    const isPublicHost = /picsum\.photos|unsplash|placekitten|placehold|loremflickr/i.test(targetHost);

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        // Some public hosts block mismatched referers; prefer empty referer for known public CDNs
        'Referer': isPublicHost ? '' : (req.headers.referer || ''),
        ...(needsAuth && IMG_API_KEY ? { Authorization: `Bearer ${IMG_API_KEY}` } : {})
      },
      // Do not decompress to preserve streaming
      decompress: false
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (response.headers['cache-control']) {
      res.setHeader('Cache-Control', response.headers['cache-control']);
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Image proxy error:', err?.message || err);
    // Graceful fallback: redirect browser to the original URL for public hosts
    try {
      const { url } = req.query || {};
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        const host = (() => { try { return new URL(url).hostname || ''; } catch { return ''; } })();
        if (/picsum\.photos|unsplash|placekitten|placehold|loremflickr/i.test(host)) {
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          return res.redirect(302, url);
        }
      }
    } catch {}
    res.status(502).json({ error: 'Failed to fetch image' });
  }
});