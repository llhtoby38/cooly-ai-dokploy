const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const db = require('../db');
const { reserveCredits, captureReservation, releaseReservation, getCredits } = require('../utils/credits');
const { uploadSeedanceVideo, uploadSeedanceRefImage, streamUrlToB2 } = require('../utils/storage');
const { getReqLogger, child: makeLogger } = require('../utils/logger');
const bgLog = makeLogger('seedance');
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }
const { computeVideoCredits } = require('../utils/videoPricing');

const router = express.Router();

// Backend mock mode via feature flags or env
const { shouldMock } = require('../utils/featureFlags');
let MOCK_MODE = false;

// Configuration via env with sensible fallbacks to existing BytePlus settings
// Key order of precedence: SEEDANCE_API_KEY > BYTEPLUS_ARK_API_KEY > RENDER_ARK_API_KEY
const SEEDANCE_API_KEY = process.env.SEEDANCE_API_KEY || process.env.BYTEPLUS_ARK_API_KEY || process.env.RENDER_ARK_API_KEY;
// Base order of precedence: SEEDANCE_API_BASE > BytePlus Ark default
const SEEDANCE_API_BASE = (process.env.SEEDANCE_API_BASE || 'https://ark.ap-southeast.bytepluses.com');
// Optional: explicit endpoint routing
const SEEDANCE_ENDPOINT_ID = process.env.SEEDANCE_ENDPOINT_ID || process.env.BYTEPLUS_ENDPOINT_ID || '';
// If paths are not provided, try pragmatic defaults (can be overridden by env)
// Try multiple likely paths by default; env can override with a comma-separated list
// Merge env-provided paths with sensible defaults to avoid misconfig
// Prefer the ModelArk contents tasks path first (works for Seedance Lite T2V)
const DEFAULT_CREATE = [
  '/api/v3/contents/generations/tasks',
  '/api/v3/contents/generations',
  '/api/v3/videos/generations',
  '/api/v3/videos/generate',
  '/api/v3/video/generations',
  '/api/v3/videos/tasks',
  '/api/v3/video/tasks'
];
const DEFAULT_TASK = [
  '/api/v3/contents/generations/tasks/{taskId}',
  '/api/v3/videos/tasks/{taskId}',
  '/api/v3/videos/tasks?taskId={taskId}'
];
const ENV_CREATE = (process.env.SEEDANCE_CREATE_PATHS || '').split(',').map(p => p.trim()).filter(Boolean);
const ENV_TASK = (process.env.SEEDANCE_TASK_PATHS || '').split(',').map(p => p.trim()).filter(Boolean);
const SEEDANCE_CREATE_PATHS = Array.from(new Set([...ENV_CREATE, ...DEFAULT_CREATE]));
const SEEDANCE_TASK_PATHS = Array.from(new Set([...ENV_TASK, ...DEFAULT_TASK]));

const COST_PER_VIDEO = 5; // Fallback cost if pricing lookup fails

// Try immediate generation like images/generations (BytePlus Ark pattern)
async function seedanceGenerateImmediate(prompt, model, aspectRatio, imageUrl, startFrameUrl, endFrameUrl, resolution, duration) {
  if (!SEEDANCE_API_BASE || !SEEDANCE_API_KEY || SEEDANCE_CREATE_PATHS.length === 0) {
    throw new Error('Seedance not configured');
  }
  let lastError;
  for (const path of SEEDANCE_CREATE_PATHS) {
    const url = `${SEEDANCE_API_BASE}${path}`;
    const contentArray = [ { type: 'text', text: `${prompt}${resolution ? ` --rs ${resolution}` : ''}${Number(duration) ? ` --dur ${Number(duration)}` : ''}${aspectRatio ? ` --ratio ${aspectRatio}` : ''}` } ];

    // Helper: convert non-JPEG/PNG URLs to JPEG data URLs
    const convertIfNeeded = async (srcUrl) => {
      if (!srcUrl || !sharp) return srcUrl;
      try {
        const resp = await axios.get(srcUrl, { responseType: 'arraybuffer', timeout: 20000 });
        const buf = Buffer.from(resp.data);
        const meta = await sharp(buf).metadata();
        if (!meta || (meta.format !== 'jpeg' && meta.format !== 'png')) {
          const out = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
          return `data:image/jpeg;base64,${out.toString('base64')}`;
        }
        return srcUrl;
      } catch (_) {
        return srcUrl;
      }
    };
    
    // Add images to content array - only use explicitly provided images
    if (startFrameUrl && typeof startFrameUrl === 'string') {
      const conv = await convertIfNeeded(startFrameUrl);
      contentArray.push({ 
        type: 'image_url', 
        image_url: { url: conv },
        role: 'first_frame'
      });
    } else if (imageUrl && typeof imageUrl === 'string') {
      // Only use imageUrl if no startFrameUrl is provided (for backward compatibility)
      const conv = await convertIfNeeded(imageUrl);
      contentArray.push({ type: 'image_url', image_url: { url: conv } });
    }
    
    // Add end frame if provided (for I2V with dual frames)
    if (endFrameUrl && typeof endFrameUrl === 'string') {
      const conv = await convertIfNeeded(endFrameUrl);
      contentArray.push({ 
        type: 'image_url', 
        image_url: { url: conv },
        role: 'last_frame'
      });
    }
    const bodies = [
      // ModelArk contents/generations/tasks payload
      { model, content: contentArray, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
      // Alternate shapes as fallbacks
      { kind: 'video', input: { prompt }, model, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
      { prompt, model, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) }
    ];
    let lastInner;
    for (const body of bodies) {
      try {
        getReqLogger(null, 'seedance').info({ event: 'provider.create.attempt', url });
        const includeEndpoint = !!SEEDANCE_ENDPOINT_ID && !url.includes('/contents/generations');
        const resp = await axios.post(url, body, {
          headers: {
            'Authorization': `Bearer ${SEEDANCE_API_KEY}`,
            'Content-Type': 'application/json',
            ...(includeEndpoint ? { 'X-Endpoint-Id': SEEDANCE_ENDPOINT_ID } : {})
          }
        });
        const payload = resp.data;
        // First preference: immediate URLs (same style as image generations)
        let urls = [];
        if (payload?.data) {
          if (Array.isArray(payload.data)) urls = payload.data.map(it => it.url).filter(Boolean);
          else if (payload.data.url) urls = [payload.data.url];
          else if (Array.isArray(payload.data.urls)) urls = payload.data.urls.filter(Boolean);
        }
        if (payload?.url) urls = [payload.url];
        if (Array.isArray(payload?.urls)) urls = payload.urls.filter(Boolean);
        if (urls && urls.length > 0) return { urls, raw: payload };

        // Fallback: task id flow
        const taskId = payload?.task_id || payload?.id || payload?.data?.taskId || payload?.taskId;
        if (taskId) return { task_id: taskId, raw: payload };

        if (payload?.code && payload?.code !== 200) throw new Error(payload?.message || payload?.msg || 'Seedance error');
        lastInner = new Error('No URLs or task id in response');
      } catch (e) {
        const s = e?.response?.status;
        if (s === 404 || s === 405) {
          const reqId = e?.response?.headers?.['x-request-id'] || e?.response?.headers?.['x-requestid'];
          try { getReqLogger(null, 'seedance').warn({ event: 'provider.create.404', url, reqId: reqId || null }); } catch {}
          lastInner = e;
          continue;
        }
        throw e;
      }
    }
    lastError = lastInner; // try next path
  }
  throw lastError || new Error('Seedance create failed');
}

async function seedanceGetTask(taskId) {
  if (!SEEDANCE_API_BASE || !SEEDANCE_API_KEY || SEEDANCE_TASK_PATHS.length === 0) {
    throw new Error('Seedance not configured');
  }
  let lastError;
  for (const path of SEEDANCE_TASK_PATHS) {
    let built = path;
    if (built.includes('{taskId}')) built = built.replace('{taskId}', encodeURIComponent(taskId));
    else if (built.includes('?')) { const sep = built.includes('taskId=') ? '' : (built.endsWith('?') ? '' : '&'); built = `${built}${sep}${built.includes('taskId=') ? '' : 'taskId='}${encodeURIComponent(taskId)}`; }
    else if (!built.endsWith(`/${taskId}`)) built = `${built}/${taskId}`;

    const url = `${SEEDANCE_API_BASE}${built}`;
    try {
      const resp = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${SEEDANCE_API_KEY}`,
          ...(SEEDANCE_ENDPOINT_ID ? { 'X-Endpoint-Id': SEEDANCE_ENDPOINT_ID } : {})
        }
      });
      const raw = resp.data;
      // ModelArk often nests details under data
      const d = raw?.data || raw;
      const sRaw = (d?.status || d?.task_status || raw?.status || raw?.state || '').toString().toLowerCase();
      const status = (sRaw.includes('success') || sRaw.includes('succeed') || sRaw === 'completed' || sRaw === 'done') ? 'completed'
        : (sRaw.includes('fail') || sRaw === 'error') ? 'failed'
        : 'processing';

      // Extract possible URLs from common fields
      let urls = [];
      const addFromStr = (val) => { try { const arr = JSON.parse(val); if (Array.isArray(arr)) urls.push(...arr.filter(u => typeof u === 'string')); } catch {} };
      if (Array.isArray(d?.urls)) urls.push(...d.urls.filter(Boolean));
      if (typeof d?.url === 'string') urls.push(d.url);
      if (typeof d?.content?.video_url === 'string') urls.push(d.content.video_url);
      if (Array.isArray(d?.output)) urls.push(...d.output.map(o => o?.url).filter(Boolean));
      if (typeof d?.resultUrls === 'string') addFromStr(d.resultUrls);
      if (typeof d?.info?.resultUrls === 'string') addFromStr(d.info.resultUrls);

      if (status === 'completed') {
        return { status: 'completed', provider_status: sRaw || 'succeeded', video_urls: urls, raw };
      }
      if (status === 'failed') {
        const errMsg = d?.error || d?.message || d?.msg || raw?.error || 'Generation failed';
        return { status: 'failed', provider_status: sRaw || 'failed', error: errMsg, raw };
      }
      return { status: 'processing', provider_status: sRaw || 'running', raw };
    } catch (e) {
      const s = e?.response?.status; if (s === 404 || s === 405) { lastError = e; continue; }
      throw e;
    }
  }
  throw lastError || new Error('Seedance status fetch failed');
}

async function waitForCompletion(taskId) {
  while (true) {
    const st = await seedanceGetTask(taskId);
    const status = (st?.status || st?.state || '').toLowerCase();
    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      return st; // return full payload (may contain usage)
    }
    if (['failed', 'error'].includes(status)) throw new Error(st.error || 'Seedance task failed');
    await new Promise(r => setTimeout(r, 30000));
  }
}

// Start generation (immediate URL path first; fallback to polling if task returned)
router.post('/generate', auth, async (req, res) => {
  try {
    const { prompt, model = 'seedance-1-0-lite', aspectRatio = '16:9', imageUrl = null, startFrameUrl = null, endFrameUrl = null, resolution = '1080p', duration = null, clientKey = undefined } = req.body;
    if (process.env.NODE_ENV !== 'production') { try { getReqLogger(req, 'seedance').info({ event: 'clientKey.body', clientKey: clientKey || null }); } catch {} }
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    // Dynamic pricing: try variant table first, then per-second fallback
    const dynamicCost = await computeVideoCredits(model, resolution, aspectRatio, duration);
    const humanLabel = (() => {
      const m = String(model || '').toLowerCase();
      if (m.includes('seedance') && m.includes('pro')) return 'Seedance 1.0 Pro';
      if (m.includes('seedance') && m.includes('lite')) return 'Seedance 1.0 Lite';
      return 'Seedance';
    })();
    const cost = dynamicCost || COST_PER_VIDEO;
    const ttl = Number(process.env.RESERVATION_TTL_SECONDS || 600);
    const reservation = await reserveCredits(req.user.userId, cost, { description: `${humanLabel} (reservation)`, ttlSeconds: ttl });
    if (!reservation.success) return res.status(402).json({ error: reservation.error || 'Credit check failed' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // Map generic selection to provider-specific model id
      let providerModel = model;
      const m = String(model || '').toLowerCase();
      if (m === 'seedance-1-0-lite') {
        providerModel = (startFrameUrl && typeof startFrameUrl === 'string')
          ? 'seedance-1-0-lite-i2v-250428'
          : 'seedance-1-0-lite-t2v-250428';
      } else if (m === 'seedance-1-0-pro') {
        providerModel = 'seedance-1-0-pro-250528';
      }
      const { rows: sessionRows } = await client.query(
        'INSERT INTO video_generation_sessions (user_id, prompt, model, aspect_ratio, status, ref_image_url, start_frame_url, end_frame_url, resolution, video_duration, credit_cost, reservation_id, client_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id',
        [req.user.userId, prompt, providerModel, aspectRatio, 'processing', imageUrl || null, startFrameUrl || null, endFrameUrl || null, resolution, duration, cost, reservation.reservationId, clientKey || null]
      );
      const sessionId = sessionRows[0].id;
      // Early fallback: if no clientKey provided, set to sessionId (overridden by taskId later if available)
      if (!clientKey) {
        try { await client.query('UPDATE video_generation_sessions SET client_key = COALESCE(client_key, id::text) WHERE id = $1', [sessionId]); } catch(_) {}
      }

      // Resolve mock mode
      try { MOCK_MODE = await shouldMock('seedance'); } catch { MOCK_MODE = false; }
      // Mock short-circuit with staged completion
      if (MOCK_MODE) {
        // Ensure client_key fallback is set before commit
        try { await client.query('UPDATE video_generation_sessions SET client_key = COALESCE(client_key, id::text) WHERE id = $1', [sessionId]); } catch(_) {}
        await client.query('COMMIT');
        const bal = await getCredits(req.user.userId);
        res.json({ success: true, sessionId, message: 'Seedance (mock) started', prompt, credits_left: bal?.credits, status: 'processing' });

        const minMs = Number(process.env.SEEDANCE_MOCK_MIN_MS || 12000);
        const maxMs = Number(process.env.SEEDANCE_MOCK_MAX_MS || 22000);
        const totalMs = minMs + Math.floor(Math.random() * Math.max(0, (maxMs - minMs) + 1));
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        await sleep(totalMs);
        try {
          // Use a shorter CORS-friendly sample video
          const mockUrl = `https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4`;
          const filename = `seed_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
          await db.query(
            `INSERT INTO videos (session_id, original_url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [sessionId, mockUrl, filename, mockUrl, process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0', null, 'mock', 'seedance-1-0']
          );
          await db.query('UPDATE video_generation_sessions SET status=$1, storage_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', sessionId]);
          try { await captureReservation(reservation.reservationId, { description: humanLabel }); } catch (e) { try { getReqLogger(req, 'seedance').warn({ event: 'capture.failed', msg: e?.message || String(e) }); } catch {} }
        } catch (e) {
          try { getReqLogger(req, 'seedance').warn({ event: 'mock.finalize.error', msg: e?.message || String(e) }); } catch {}
        }
        return;
      }
      const createStart = Date.now();
      const create = await seedanceGenerateImmediate(prompt, providerModel, aspectRatio, imageUrl, startFrameUrl, endFrameUrl, resolution, duration);
      const createMs = Date.now() - createStart;
      try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId, taskId: create?.task_id || create?.id || create?.taskId || null, provider: 'byteplus', model: providerModel, endpoint: 'videos/generations', raw: create?.raw || create, timing: { apiMs: createMs } }); } catch(_) {}
      if (process.env.NODE_ENV !== 'production') { try { getReqLogger(req, 'seedance').debug({ event: 'usage.debug.create', usage: create?.usage || create?.raw?.usage || null }); } catch {} }
      try {
        const u = (create && typeof create === 'object' && (create.raw?.usage || create.usage)) ? (create.raw?.usage || create.usage) : null;
        if (u) {
          await db.query('UPDATE video_generation_sessions SET token_usage = $1, completion_tokens = $2, total_tokens = $3 WHERE id = $4', [JSON.stringify(u), Number(u.completion_tokens) || null, Number(u.total_tokens) || null, sessionId]);
        }
        // Token USD per K from reference table
        const { getVideoUsdPerK } = require('../utils/videoPricing');
        const tokenUsdPerK = await getVideoUsdPerK(providerModel);
        const totalTokens = u ? Number(u.total_tokens) || 0 : null;
        const sessionUsd = totalTokens != null ? (tokenUsdPerK * (totalTokens / 1000)) : null;
        await db.query('UPDATE video_generation_sessions SET token_usd_per_k = $1, session_usd = $2 WHERE id = $3', [tokenUsdPerK, sessionUsd, sessionId]);
      } catch (_) {}
      try {
        const usage = (create && typeof create === 'object' && (create.raw?.usage || create.usage)) ? (create.raw?.usage || create.usage) : null;
        if (usage) {
          await db.query('UPDATE video_generation_sessions SET token_usage = $1 WHERE id = $2', [JSON.stringify(usage), sessionId]);
        }
      } catch (_) {}
      if (create.urls && create.urls.length > 0) {
        // Immediate URL path: persist and complete synchronously
        const immStartMs = Date.now();
        let transferMs = 0;
        const url = create.urls[0];
        const filename = `seed_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
        const transferStart = Date.now();
        const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'seedance-1-0', timeoutMs: 60000 });
        transferMs = Date.now() - transferStart;
        const b2 = streamed.url;
        await db.query(
          `INSERT INTO videos (session_id, original_url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sessionId, url, filename, b2, process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0', streamed.bytes || null, 'b2', 'seedance-1-0']
        );
        // Ensure client_key fallback set even for immediate mode
        try { await db.query('UPDATE video_generation_sessions SET client_key = COALESCE(client_key, id::text) WHERE id = $1', [sessionId]); } catch(_) {}
        await db.query('UPDATE video_generation_sessions SET status=$1, storage_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', sessionId]);
        // Capture the reservation on success
        try { await captureReservation(reservation.reservationId, { description: humanLabel }); } catch (e) { try { getReqLogger(req, 'seedance').warn({ event: 'capture.failed', msg: e?.message || String(e) }); } catch {} }
        await client.query('COMMIT');
        const bal = await getCredits(req.user.userId);
        return res.json({ success: true, sessionId, message: 'Seedance video generated', prompt, credits_left: bal?.credits });
      }

      // Fallback: task flow with background polling
      const taskId = create.task_id || create.id || create.taskId;
      await client.query('UPDATE video_generation_sessions SET task_id = $1 WHERE id = $2', [taskId, sessionId]);
      // Fallback: use taskId as client_key if none provided
      try { await client.query('UPDATE video_generation_sessions SET client_key = COALESCE(client_key, $1) WHERE id = $2', [taskId, sessionId]); } catch(_) {}
      await client.query('COMMIT');

      ;(async () => {
        const bgStartMs = Date.now();
        let apiMs = 0, transferMs = 0, dbMs = 0;
        try {
      const pollStart = Date.now();
      const result = await waitForCompletion(taskId);
      apiMs += (Date.now() - pollStart);
      if (process.env.NODE_ENV !== 'production') { try { bgLog.debug({ event: 'usage.debug.status', usage: result?.usage || result?.raw?.usage || null, sessionId }); } catch {} }
      try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId, taskId, provider: 'byteplus', model: providerModel, endpoint: 'videos/tasks', raw: result?.raw || result, timing: { apiMs } }); } catch(_) {}
      try {
        const dbStart = Date.now();
        const u = (result && typeof result === 'object' && (result.raw?.usage || result.usage)) ? (result.raw?.usage || result.usage) : null;
        if (u) {
          await db.query('UPDATE video_generation_sessions SET token_usage = $1, completion_tokens = $2, total_tokens = $3 WHERE id = $4', [JSON.stringify(u), Number(u.completion_tokens) || null, Number(u.total_tokens) || null, sessionId]);
        }
        const { getVideoUsdPerK } = require('../utils/videoPricing');
        const tokenUsdPerK = await getVideoUsdPerK(providerModel);
        const totalTokens = u ? Number(u.total_tokens) || 0 : null;
        const sessionUsd = totalTokens != null ? (tokenUsdPerK * (totalTokens / 1000)) : null;
        await db.query('UPDATE video_generation_sessions SET token_usd_per_k = $1, session_usd = $2 WHERE id = $3', [tokenUsdPerK, sessionUsd, sessionId]);
        dbMs += (Date.now() - dbStart);
      } catch (_) {}
          const urls = result?.video_urls || result?.urls || (Array.isArray(result?.output) ? result.output.map(o => o.url).filter(Boolean) : []);
          const url = Array.isArray(urls) ? urls[0] : urls;
          if (!url) throw new Error('No video URL received');
          const filename = `seed_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
          const transferStart = Date.now();
          const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'seedance-1-0', timeoutMs: 60000 });
          transferMs += (Date.now() - transferStart);
          const b2 = streamed.url;
          const dbStart2 = Date.now();
          await db.query(
            `INSERT INTO videos (session_id, original_url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [sessionId, url, filename, b2, process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0', streamed.bytes || null, 'b2', 'seedance-1-0']
          );
          const totalMs = Date.now() - bgStartMs;
          const timingBreakdown = {
            totalMs,
            providerApiMs: apiMs,
            videoTransferMs: transferMs,
            dbOpsMs: dbMs,
            overheadMs: Math.max(0, totalMs - apiMs - transferMs - dbMs)
          };
          await db.query('UPDATE video_generation_sessions SET status=$1, storage_status=$2, completed_at=NOW(), timing_breakdown=$3 WHERE id=$4', ['completed', 'completed', JSON.stringify(timingBreakdown), sessionId]);
          dbMs += (Date.now() - dbStart2);
          // Immediately capture reservation to keep balances and history in sync (worker remains fallback)
          try { await captureReservation(reservation.reservationId, { description: humanLabel }); } catch (_) {}
        } catch (e) {
          try { bgLog.warn({ event: 'background.process.error', msg: e?.message || String(e), sessionId }); } catch {}
          await db.query('UPDATE video_generation_sessions SET status=$1 WHERE id=$2', ['failed', sessionId]).catch(()=>{});
          // Release on failure
          try { await releaseReservation(reservation.reservationId); } catch(_) {}
        }
      })();

      const bal = await getCredits(req.user.userId);
      return res.json({ success: true, sessionId, taskId, clientKey: clientKey || taskId || null, message: 'Seedance generation started', prompt, credits_left: bal?.credits });
    } catch (e) {
      await client.query('ROLLBACK');
      // Release reservation if DB/creation step fails
      try { await releaseReservation(reservation.reservationId); } catch(_) {}
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    try { getReqLogger(req, 'seedance').error({ event: 'generate.error', msg: error?.message || String(error) }); } catch {}
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Video generation failed' : (error?.message || String(error)) });
  }
});

// Return exact credits for the given parameters (uses variant table first)
// Public price endpoint so logged-out users can see costs
router.post('/price', async (req, res) => {
  try {
    const { model = 'seedance-1-0-lite', resolution = '1080p', aspectRatio = '16:9', duration = null } = req.body || {};
    const credits = await computeVideoCredits(model, resolution, aspectRatio, duration);
    if (credits == null) {
      return res.status(404).json({ error: 'No pricing found' });
    }
    // Determine if it was an exact variant row (not strictly required by client, but useful)
    // Recompute using variant path only
    const db = require('../db');
    const modelKey = String(model).toLowerCase().includes('pro') ? 'seedance-1-0-pro'
      : (String(model).toLowerCase().includes('lite') ? 'seedance-1-0-lite' : String(model));
    const { rows } = await db.query(
      `SELECT 1 FROM video_variant_pricing 
       WHERE model_key = $1 AND resolution = $2 AND aspect_ratio = $3 AND duration_seconds = $4 AND is_active = TRUE 
       LIMIT 1`,
      [modelKey, resolution, aspectRatio, Number(duration)]
    );
    const exact = rows.length > 0;
    return res.json({ credits, exact });
  } catch (e) {
    try { getReqLogger(req, 'seedance').error({ event: 'price.error', msg: e?.message || String(e) }); } catch {}
    return res.status(500).json({ error: 'Failed to compute price' });
  }
});

// Status endpoint reuses the shared session table
router.get('/status/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { rows } = await db.query('SELECT * FROM video_generation_sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    const session = rows[0];
    let provider = null;
    try {
      if (session.task_id && session.status === 'processing') {
        provider = await seedanceGetTask(session.task_id);
      }
    } catch (_) {}

    // If provider reports success but DB not yet completed, finalize eagerly
    try {
      // If already completed or a video record exists, skip re-uploading
      const existingVideo = await db.query('SELECT 1 FROM videos WHERE session_id = $1 LIMIT 1', [sessionId]);
      if (session.status === 'completed' || existingVideo.rowCount > 0) {
        return res.json({ ...session, provider_status: provider?.provider_status || provider?.status || null });
      }
      const pStatus = String(provider?.provider_status || provider?.status || '').toLowerCase();
      const isDone = ['succeeded', 'success', 'completed', 'done'].includes(pStatus);
      if (isDone && session.status !== 'completed') {
        // Update to uploading status when provider is done
        await db.query('UPDATE video_generation_sessions SET storage_status=$1 WHERE id=$2', ['uploading', sessionId]);
        
        const urls = provider?.video_urls || provider?.urls || [];
        const url = Array.isArray(urls) ? urls[0] : urls;
        if (typeof url === 'string' && url.startsWith('http')) {
          const filename = `seed_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
          const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'seedance-1-0', timeoutMs: 60000 });
          const b2 = streamed.url;
          await db.query(
            `INSERT INTO videos (session_id, original_url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
            [sessionId, url, filename, b2, process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0', streamed.bytes || null, 'b2', 'seedance-1-0']
          );
          await db.query('UPDATE video_generation_sessions SET status=$1, storage_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', sessionId]);
          // Refresh session object
          const r2 = await db.query('SELECT * FROM video_generation_sessions WHERE id = $1', [sessionId]);
          if (r2.rows?.[0]) Object.assign(session, r2.rows[0]);
        } else {
          // If no URL available, mark as upload failed
          await db.query('UPDATE video_generation_sessions SET storage_status=$1 WHERE id=$2', ['upload_failed', sessionId]);
        }
      }
    } catch (e) {
      try { getReqLogger(req, 'seedance').warn({ event: 'eager.finalize.failed', msg: e?.message || String(e), sessionId }); } catch {}
      // Mark as upload failed on error
      await db.query('UPDATE video_generation_sessions SET storage_status=$1 WHERE id=$2', ['upload_failed', sessionId]).catch(()=>{});
    }

    return res.json({ ...session, provider_status: provider?.provider_status || provider?.status || null });
  } catch (e) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

// Export helper for worker reuse (keep router as default export)
exports.getSeedanceTask = seedanceGetTask;
module.exports = router;

// Upload reference image (drag & drop)
router.post('/upload-ref', auth, async (req, res) => {
  try {
    const MAX_BYTES = Number(process.env.MAX_REF_IMAGE_BYTES || 10 * 1024 * 1024); // 10 MB default
    const chunks = [];
    let total = 0;
    let aborted = false;

    // If Content-Length header is provided and already exceeds the limit, fail fast
    const cl = Number(req.headers['content-length'] || 0);
    if (cl && cl > MAX_BYTES) {
      return res.status(413).json({ error: 'Reference image must be ≤ 10 MB' });
    }

    req.on('data', (c) => {
      if (aborted) return;
      total += c.length;
      if (total > MAX_BYTES) {
        aborted = true;
        // Stop reading further and respond with 413
        try { req.pause(); } catch {}
        return res.status(413).json({ error: 'Reference image must be ≤ 10 MB' });
      }
      chunks.push(c);
    });

    req.on('end', async () => {
      if (aborted) return; // response already sent
      const buf = Buffer.concat(chunks);
      if (!buf || buf.length === 0) return res.status(400).json({ error: 'Empty file' });
      // Detect mime by simple signature; default to png
      let mime = 'image/png';
      if (buf[0] === 0xFF && buf[1] === 0xD8) mime = 'image/jpeg';
      if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
      if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
      const filename = `seedance_ref_${Date.now()}_${Math.random().toString(36).slice(2)}.${mime.includes('jpeg') ? 'jpg' : mime.split('/')[1]}`;
      const url = await uploadSeedanceRefImage(buf, filename, mime);
      return res.json({ url });
    });
  } catch (e) {
    try { getReqLogger(req, 'seedance').error({ event: 'ref.upload.error', msg: e?.message || String(e) }); } catch {}
    res.status(500).json({ error: 'Upload failed' });
  }
});


