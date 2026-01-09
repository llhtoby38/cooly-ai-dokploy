const express = require('express');
const axios = require('axios');
const { randomUUID } = require('crypto');
const auth = require('../middleware/auth');
const db = require('../db');
const { reserveCredits, captureReservation, releaseReservation, getCredits } = require('../utils/credits');
const { uploadSeedream4Image, uploadSeedream4RefImage, streamUrlToB2 } = require('../utils/storage');
const { getBooleanSetting } = require('../utils/appSettings');
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }
const router = express.Router();
const { getReqLogger } = require('../utils/logger');

// Backend mock mode via feature flags or env
const { shouldMock, getSetting } = require('../utils/featureFlags');
let MOCK_MODE = false;

// Progress endpoint to allow frontend polling per session (moved under /progress/id/... to avoid clashing with /progress/stream)
router.get('/progress/id/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const entry = seedream4Progress.get(sessionId);
    if (!entry) return res.json({ progress: [] });
    if (entry.userId && entry.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json({ progress: entry.progress || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Consolidated SSE stream for progress updates per user (push model)
router.get('/progress/stream', auth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    sseAddStream(req.user.userId, res);
    const iv = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
    }, 25000);
    res.on('close', () => clearInterval(iv));
  } catch (_) {
    try { res.end(); } catch {}
  }
});

const SEEDREAM4_API_KEY = process.env.SEEDREAM4_API_KEY || process.env.BYTEPLUS_ARK_API_KEY;
const SEEDREAM4_API_BASE = process.env.SEEDREAM4_API_BASE || 'https://ark.ap-southeast.bytepluses.com';

// In-memory per-session progress tracker: Map<sessionId, { userId: string, progress: number[] }>
const seedream4Progress = new Map();
// SSE clients per user: Map<userId, Set<res>>
const seedream4StreamsByUser = new Map();

function sseAddStream(userId, res) {
  let set = seedream4StreamsByUser.get(userId);
  if (!set) { set = new Set(); seedream4StreamsByUser.set(userId, set); }
  set.add(res);
  res.on('close', () => {
    try { set.delete(res); } catch {}
    if (set.size === 0) seedream4StreamsByUser.delete(userId);
  });
}

function sseBroadcast(userId, event, payload) {
  const set = seedream4StreamsByUser.get(userId);
  if (!set || set.size === 0) return;
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const res of set) {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${data}\n\n`);
    } catch (_) {}
  }
}

(async function listenForWorkerNotifications() {
  let listenClient;
  let retryAttempts = 0;

  const scheduleRestart = () => {
    if (listenClient) {
      try { listenClient.release(); } catch {}
      listenClient = null;
    }
    // Exponential backoff: 1s, 2s, 4s... max 30s
    const delayMs = Math.min(1000 * Math.pow(2, retryAttempts), 30000);
    setTimeout(() => listenForWorkerNotifications(), delayMs).unref?.();
  };

  try {
    listenClient = await db.getClient();
    retryAttempts = 0; // Reset on success
    await listenClient.query('LISTEN session_completed');

    const handle = (msg) => {
      if (!msg || msg.channel !== 'session_completed') return;
      (async () => {
        try {
          const raw = msg.payload || '{}';
          const data = JSON.parse(raw);
          const sessionId = data?.session_id;
          const userId = data?.user_id;
          const incomingStatusRaw = String(data?.status || '').trim().toLowerCase();
          const incomingStatus = incomingStatusRaw || 'completed';

          if (!sessionId || !userId) {
            console.log('[seedream4] LISTEN session_completed missing sessionId/userId');
            return;
          }

          let sessionRow;
          try {
            const { rows } = await db.query(
              'SELECT status, error_details, client_key, model FROM generation_sessions WHERE id = $1 LIMIT 1',
              [sessionId]
            );
            if (!rows.length) {
              console.log('[seedream4] LISTEN session_completed session not found:', sessionId);
              return;
            }
            sessionRow = rows[0];
          } catch (err) {
            console.error('[seedream4] LISTEN session_completed lookup error:', err?.message || err);
            return;
          }

          const model = String(sessionRow?.model || '').toLowerCase();
          if (!model.includes('seedream-4') && !model.includes('seedream-3')) {
            return;
          }

          const rowStatus = String(sessionRow?.status || '').trim().toLowerCase();
          const effectiveStatus = rowStatus || incomingStatus;
          const clientKey = sessionRow?.client_key || null;

          if (effectiveStatus === 'failed') {
            const errorDetails = sessionRow?.error_details || null;
            try {
              sseBroadcast(userId, 'failed', { sessionId, clientKey, error_details: errorDetails });
              console.log('[seedream4] LISTEN session_completed broadcast failed', { sessionId, userId, clientKey, hasErrorDetails: !!errorDetails });
            } catch (err) {
              console.error('[seedream4] LISTEN session_completed failed broadcast error:', err?.message || err);
            }
            return;
          }

          if (effectiveStatus === 'completed' || effectiveStatus === 'succeeded') {
            try {
              sseBroadcast(userId, 'done', { sessionId, clientKey });
              console.log('[seedream4] LISTEN session_completed broadcast done', { sessionId, userId, clientKey });
            } catch (err) {
              console.error('[seedream4] LISTEN session_completed done broadcast error:', err?.message || err);
            }
          }
        } catch (err) {
          console.error('[seedream4] LISTEN session_completed handler error:', err?.message || err);
        }
      })().catch((err) => {
        console.error('[seedream4] LISTEN session_completed handler rejected:', err?.message || err);
      });
    };

    listenClient.on('notification', handle);
    listenClient.on('error', (err) => {
      console.error('[seedream4] LISTEN session_completed client error:', err?.message || err);
      retryAttempts++;
      scheduleRestart();
    });
    listenClient.on('end', () => {
      console.warn('[seedream4] LISTEN session_completed client ended; restarting');
      retryAttempts++;
      scheduleRestart();
    });
    console.log('[seedream4] LISTEN session_completed listener started');
  } catch (err) {
    console.warn('[seedream4] LISTEN session_completed setup failed:', err?.message || err);
    retryAttempts++;
    scheduleRestart();
  }
})();
// Track the most recently created processing session per user
const latestSessionByUser = new Map();

// Generate images and persist them for the authenticated user
const COST_PER_IMAGE = 1; // fallback if pricing lookup fails

async function computeImageCredits(model, outputs) {
  try {
    const m = String(model || '').toLowerCase();
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

// Lightweight dimension detection for PNG/JPEG buffers
function detectImageDimensions(buffer) {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    // PNG signature
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height, type: 'png' };
    }
    // JPEG signature
    if (buf.length > 10 && buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset < buf.length) {
        if (buf[offset] !== 0xFF) { offset++; continue; }
        let marker = buf[offset + 1];
        // Skip fill bytes 0xFF
        while (marker === 0xFF) { offset++; marker = buf[offset + 1]; }
        // Standalone markers without length (RST, SOI, EOI)
        if (marker === 0xD9 || marker === 0xDA) { break; }
        const length = buf.readUInt16BE(offset + 2);
        // SOF markers that contain dimensions
        const isSOF = (
          marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3 ||
          marker === 0xC5 || marker === 0xC6 || marker === 0xC7 ||
          marker === 0xC9 || marker === 0xCA || marker === 0xCB ||
          marker === 0xCD || marker === 0xCE || marker === 0xCF
        );
        if (isSOF && offset + 7 < buf.length) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height, type: 'jpeg' };
        }
        offset += 2 + length;
      }
    }
  } catch {}
  return { width: null, height: null, type: 'unknown' };
}

// Download image from BytePlus Seedream 4.0 and upload to B2 (streaming to minimize memory)
async function downloadAndUploadToB2(imageUrl, sessionId, model) {
  try {
    const rlog = getReqLogger(null, 'seedream4');
    try { rlog.info({ event: 'download.start', url: imageUrl, tool: 'byteplus-seedream-4' }); } catch {}

    const MAX_BYTES = Math.max(1, Number(process.env.MAX_IMAGE_DOWNLOAD_BYTES || 20 * 1024 * 1024)); // 20MB default

    // Request remote image as a stream
    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 30000
    });

    // Enforce a byte limit while streaming to avoid OOM
    const { Transform } = require('stream');
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > MAX_BYTES) {
          cb(new Error(`download exceeded limit ${MAX_BYTES} bytes`));
          return;
        }
        cb(null, chunk);
      }
    });

    const piped = response.data.pipe(limiter);

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const filename = `seedream4_${sessionId}_${timestamp}_${randomId}.png`;

    try { rlog.info({ event: 'upload.start', filename, tool: 'byteplus-seedream-4' }); } catch {}

    // Body can be a stream; we intentionally skip full buffering
    const permanentUrl = await uploadSeedream4Image(piped, filename);

    return {
      original_url: imageUrl,
      b2_url: permanentUrl,
      b2_filename: filename,
      file_size: received || null,
      b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4',
      generation_tool: 'byteplus-seedream-4',
      width: null,
      height: null
    };
  } catch (error) {
    try { getReqLogger(null, 'seedream4').error({ event: 'upload.error', msg: error?.message || String(error) }); } catch {}
    throw new Error(`Seedream 4.0 image processing failed: ${error.message}`);
  }
}

router.post('/generate', auth, async (req, res) => {
  const requestStartMs = Date.now();
  const breakdown = { providerMs: [], uploadMs: [], insertSessionMs: 0, insertImagesMs: 0 };
  const {
    prompt,
    model = process.env.SEEDREAM4_MODEL_ID || "seedream-4-0-250828",
    response_format = "url",
    size = "1024x1024",
    guidance_scale = 3,
    negative_prompt = undefined,
    ref_image_url = undefined,
    ref_image_urls = undefined, // New: array of multiple reference images
    seed = undefined,
    watermark = false,
    outputs = 1, // number of images requested from the client
    aspect_ratio = null, // aspect ratio selected by the user
    aspect_ratio_mode = null,
    clientKey = undefined // client-side unique identifier for session matching
  } = req.body;

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Golden path: outbox + worker only when forced
  const forceOutboxOnly = String(process.env.FORCE_OUTBOX_ONLY || '').toLowerCase() === 'true';
  // Enqueue-first path: pre-reserve credits in API, then write to outbox with reservation_id
  if (forceOutboxOnly || String(process.env.ENABLE_ENQUEUE_FIRST || '').toLowerCase() === 'true') {
    const key = clientKey && String(clientKey).trim().length > 0 ? String(clientKey) : randomUUID();
    let mockFlag = false;
    try { mockFlag = await shouldMock('seedream4', req); } catch (_) {}

    if (String(process.env.ENABLE_OUTBOX || '').toLowerCase() === 'true') {
      try {
        // Idempotency: reuse existing outbox row for same clientKey if present
        try {
          const { rows: existing } = await db.query(
            `SELECT id, reservation_id FROM outbox 
             WHERE event_type = 'gen.seedream4' AND payload->>'clientKey' = $1 
             ORDER BY created_at DESC LIMIT 1`, [key]
          );
          if (existing.length) {
            return res.status(202).json({ accepted: true, clientKey: key, reservationId: existing[0].reservation_id || null, status: 'queued' });
          }
        } catch (_) {}

        // Compute estimated cost
        const requestedCount = Math.max(1, Number(outputs) || 1);
        const estimatedCost = await computeImageCredits(model, requestedCount);

        // Enqueue via centralized helper
        const { enqueueGeneration } = require('../services/enqueue');
        try {
          const result = await enqueueGeneration({
            jobType: 'gen.seedream4',
            userId: req.user.userId,
            clientKey: key,
            params: { prompt, model, outputs, size, guidance_scale, negative_prompt, ref_image_url, ref_image_urls, seed, watermark, aspect_ratio, aspect_ratio_mode },
            cost: estimatedCost,
            model,
            mockFlag,
            preInsertSession: true
          });
          if (!result.accepted) {
            return res.status(402).json({ error: result.error || 'Insufficient credits' });
          }
          try { getReqLogger(req, 'seedream4').info({ event: 'outbox.write', outboxId: result.outboxId || null, reservationId: result.reservationId, clientKey: key }); } catch {}
          return res.status(202).json({ accepted: true, clientKey: key, reservationId: result.reservationId, sessionId: result.sessionId, status: 'queued' });
        } catch (e) {
          try { getReqLogger(req, 'seedream4').error({ event: 'outbox.write.failed', msg: e?.message || String(e) }); } catch {}
          return res.status(503).json({ error: 'queue temporarily unavailable, please retry' });
        }
      } catch (e) {
        try { getReqLogger(req, 'seedream4').error({ event: 'outbox.write.failed', msg: e?.message || String(e) }); } catch {}
        return res.status(503).json({ error: 'queue temporarily unavailable, please retry' });
      }
    }
    // No direct queue fallback in golden path
    if (forceOutboxOnly) return res.status(503).json({ error: 'queue temporarily unavailable, please retry' });
  }

  const requested = Number(outputs) || 1;
  const cost = await computeImageCredits(model, requested);
  try { getReqLogger(req, 'seedream4').info({ event: 'start', requested, cost, model }); } catch {}

  // Reserve credits first
  const ttl = Number(process.env.RESERVATION_TTL_SECONDS || 600);
  const reserve = await reserveCredits(
    req.user.userId,
    cost,
    { description: 'Seedream 4.0 (reservation)', ttlSeconds: ttl }
  );
  if (!reserve.success) {
    return res.status(402).json({ error: reserve.error || 'Credit check failed' });
  }

  // Initialize progress tracking for this session (0%) - will be updated with actual session ID
  const tempSessionId = randomUUID();
  seedream4Progress.set(tempSessionId, { userId: req.user.userId, progress: Array(requested).fill(0) });

  let actualSessionId; // Declare outside try block for scope access
  const client = await db.getClient();
  
  // Create session row IMMEDIATELY (before any processing) so it's visible right away
    const tInsertSession0 = Date.now();
    // Build canonical input_settings snapshot for exact reuse later
    const arMode = (() => {
      const m = typeof aspect_ratio_mode === 'string' ? aspect_ratio_mode.trim() : '';
      if (m === 'match_input' || m === 'fixed' || m === 'none') return m;
      return aspect_ratio ? 'fixed' : ((ref_image_urls && ref_image_urls.length) || ref_image_url ? 'match_input' : 'none');
    })();

    // Handle aspect ratio for "Match First Image" mode
    let derivedAspectRatio = aspect_ratio;
    if (arMode === 'match_input') {
      // For "Match First Image" mode, detect the actual aspect ratio from the reference image
      const firstRefUrl = ref_image_urls?.[0] || ref_image_url;
      if (firstRefUrl) {
        try {
          const dims = await detectImageDimensions(firstRefUrl);
          if (dims && dims.width && dims.height) {
            // Calculate aspect ratio from dimensions
            const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
            const g = gcd(dims.width, dims.height);
            const w = Math.round(dims.width / g);
            const h = Math.round(dims.height / g);
            derivedAspectRatio = `${w}:${h}`;
            try { getReqLogger(req, 'seedream4').debug({ event: 'aspect.detected', aspect: derivedAspectRatio, width: dims.width, height: dims.height }); } catch {}
          } else {
            derivedAspectRatio = '16:9'; // Default fallback
            try { getReqLogger(req, 'seedream4').debug({ event: 'aspect.fallback', aspect: '16:9' }); } catch {}
          }
        } catch (e) {
        try { getReqLogger(req, 'seedream4').debug({ event: 'aspect.error', msg: e.message }); } catch {}
        derivedAspectRatio = '16:9';
        }
      } else {
        derivedAspectRatio = '16:9'; // Default fallback
    }
  }

  // Determine final size based on aspect ratio
  let finalSize = size;
  if (derivedAspectRatio && derivedAspectRatio !== '1:1') {
    const [w, h] = derivedAspectRatio.split(':').map(Number);
    const ratio = w / h;
    if (size === '1K') {
      if (ratio > 1.5) finalSize = '1024x768'; // 4:3 landscape
      else if (ratio < 0.7) finalSize = '768x1024'; // 3:4 portrait
      else finalSize = '1024x1024'; // square-ish
    } else if (size === '2K') {
      if (ratio > 1.5) finalSize = '2048x1536'; // 4:3 landscape
      else if (ratio < 0.7) finalSize = '1536x2048'; // 3:4 portrait
      else finalSize = '2048x2048'; // square-ish
    }
  }

  // Build input_settings snapshot
  const inputSettings = {
    prompt,
    model,
    outputs,
    aspect_ratio: derivedAspectRatio,
    aspect_ratio_mode: arMode,
    size,
    final_size: finalSize,
    guidance_scale,
    negative_prompt,
    seed,
    watermark,
    ref_image_url: ref_image_url || null,
    ref_image_urls: Array.isArray(ref_image_urls) ? ref_image_urls.slice(0, 10) : (ref_image_url ? [ref_image_url] : []),
  };
  try { getReqLogger(req, 'seedream4').debug({ event: 'input.settings', inputSettings }); } catch {}
  
  // Insert session with explicit created_at and reservation_id
  const { rows: sessionRows } = await client.query(
    'INSERT INTO generation_sessions (user_id, prompt, outputs, aspect_ratio, model, status, resolution, guidance_scale, credit_cost, reservation_id, ref_image_url, ref_image_urls, input_settings, client_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()) RETURNING id',
    [
      req.user.userId,
      prompt,
      outputs,
      derivedAspectRatio,
      model,
      'processing',
      finalSize, // Use finalSize instead of size for resolution
      guidance_scale,
      cost,
      reserve.reservationId,
      (Array.isArray(ref_image_urls) && ref_image_urls.length > 0) ? ref_image_urls[0] : (ref_image_url || null),
      (Array.isArray(ref_image_urls) && ref_image_urls.length > 0) ? JSON.stringify(ref_image_urls.slice(0, 10)) : null,
      JSON.stringify(inputSettings),
      clientKey || null
    ]
  );
  actualSessionId = sessionRows[0].id;
  const insertSessionElapsed = Date.now() - tInsertSession0;
  breakdown.insertSessionMs = insertSessionElapsed;
  try { getReqLogger(req, 'seedream4').info({ event: 'insertSession', elapsedMs: insertSessionElapsed, sessionId: actualSessionId }); } catch {}
  latestSessionByUser.set(req.user.userId, actualSessionId);
  
  // Notify session_created (SSE) - IMMEDIATELY so frontend can show processing card
  try {
    const payload = JSON.stringify({
      user_id: req.user.userId,
      reservation_id: reserve.reservationId,
      session_id: actualSessionId,
      event_ts: Date.now()
    }).replace(/'/g, "''");
    await client.query(`NOTIFY session_created, '${payload}'`);
  } catch (e) { try { getReqLogger(req, 'seedream4').warn({ event: 'notify.session_created.failed', msg: e?.message || String(e) }); } catch {} }
  
  // Update progress tracking with actual session ID
  const tempProgress = seedream4Progress.get(tempSessionId);
  if (tempProgress) {
    seedream4Progress.set(actualSessionId, tempProgress);
    seedream4Progress.delete(tempSessionId);
  }

  // Resolve mock mode
  try { MOCK_MODE = await shouldMock('seedream4'); } catch { MOCK_MODE = false; }
  // Short-circuit with mock generation if MOCK_MODE is enabled
  if (MOCK_MODE) {
    try {
      await client.query('BEGIN');

      // Commit creation so session is visible, return immediately as processing
      await client.query('COMMIT');

      const bal = await getCredits(req.user.userId);
      res.json({ success: true, sessionId: actualSessionId, clientKey: clientKey, creditsUsed: cost, creditsLeft: bal?.credits, status: 'processing' });

      // Background staged completion with progress
      const minMs = Number(process.env.SEEDREAM4_MOCK_MIN_MS || 9000);
      const maxMs = Number(process.env.SEEDREAM4_MOCK_MAX_MS || 16000);
      const jitter = Math.max(0, (maxMs - minMs));
      const totalMs = minMs + Math.floor(Math.random() * (jitter + 1));
      const stages = [10, 25, 60, 85, 100];
      const stageTimes = stages.map((_, i) => Math.round(totalMs * (i + 1) / stages.length));

      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const start = Date.now();
        const mockBreakdown = { insertSessionMs: 0, providerMsTotal: 0, providerMsMax: 0, uploadMsTotal: 0, uploadMsMax: 0, insertImagesMs: 0 };
        // Progress ticks
        for (let i = 0; i < stages.length; i++) {
          const target = stageTimes[i] - (Date.now() - start);
          if (target > 0) await sleep(target);
          try {
            const entry = seedream4Progress.get(actualSessionId);
            if (entry) {
              for (let k = 0; k < entry.progress.length; k++) entry.progress[k] = Math.max(entry.progress[k], stages[i]);
            }
          } catch {}

          // Mid-stage: attach images
          if (stages[i] === 60) {
            const tInsertImgs0 = Date.now();
            try {
              const urls = Array.from({ length: requested }).map((_, idx) => `https://picsum.photos/1024/1024?random=${Date.now()}-${idx}`);
              const uploadMock = await getBooleanSetting('upload_mock_outputs_to_b2', false);
              if (uploadMock) {
                // Stream mock images to B2 for parity
                const MAX_BYTES = Math.max(1, Number(process.env.MAX_IMAGE_DOWNLOAD_BYTES || 20 * 1024 * 1024));
                const results = await Promise.all(urls.map(async (_url, idx) => {
                  const fname = `seedream4_mock_${actualSessionId}_${Date.now()}_${idx}.png`;
                  try {
                    const streamed = await streamUrlToB2({ url: _url, filename: fname, contentType: 'image/png', tool: 'byteplus-seedream-4', timeoutMs: 30000, maxBytes: MAX_BYTES });
                    return { original_url: _url, b2_url: streamed.url, b2_filename: fname, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', file_size: streamed.bytes || null, storage_provider: 'b2' };
                  } catch (_) {
                    // Fallback to mock URL if upload fails
                    return { original_url: _url, b2_url: _url, b2_filename: fname, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', file_size: null, storage_provider: 'mock' };
                  }
                }));
                await Promise.all(results.map((img, idx) => db.query(
                  `INSERT INTO images (
                    session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, width, height, client_key, created_at, completed_at
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,NOW(),NOW())`,
                  [actualSessionId, img.original_url, img.b2_filename, img.b2_url, img.b2_folder, img.file_size, img.storage_provider, 'byteplus-seedream-4', clientKey || null]
                )));
              } else {
                await Promise.all(urls.map((url, idx) => db.query(
                  `INSERT INTO images (
                    session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, width, height, client_key, created_at, completed_at
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,NOW(),NOW())`,
                  [
                    actualSessionId,
                    url,
                    `seedream4_mock_${actualSessionId}_${Date.now()}_${idx}.png`,
                    url,
                    process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4',
                    null,
                    'mock',
                    'byteplus-seedream-4',
                    clientKey || null
                  ]
                )));
              }
              mockBreakdown.insertImagesMs = Date.now() - tInsertImgs0;
              // Notify images attached
              try {
                const payload = JSON.stringify({ user_id: req.user.userId, reservation_id: reserve.reservationId, session_id: actualSessionId, event_ts: Date.now() }).replace(/'/g, "''");
                await db.query(`NOTIFY images_attached, '${payload}'`);
              } catch {}
            } catch (e) {
              console.error('[seedream4][mock] failed to attach images', e?.message || e);
            }
          }
        }

        // Finalize
        try {
          await db.query('UPDATE generation_sessions SET status=$1, completed_at=NOW(), duration_ms=$3 WHERE id=$2', ['completed', actualSessionId, Date.now() - requestStartMs]);
          const payload = JSON.stringify({ user_id: req.user.userId, reservation_id: reserve.reservationId, session_id: actualSessionId, event_ts: Date.now() }).replace(/'/g, "''");
          await db.query(`NOTIFY session_completed, '${payload}'`);
          const totalMs = Date.now() - requestStartMs;
          try { getReqLogger(req, 'seedream4').info({ event: 'total', totalMs, sessionId: actualSessionId, breakdown: mockBreakdown, mock: true }); } catch {}
        } catch (e) {
          console.error('[seedream4][mock] finalize failed', e?.message || e);
        } finally {
          try { seedream4Progress.delete(actualSessionId); } catch {}
          // Immediately capture reservation to reflect usage in credit history
          try { await captureReservation(reserve.reservationId, { description: 'Seedream 4.0' }); } catch (_) {}
        }
      })();

      return; // response already sent
    } catch (e) {
      await client.query('ROLLBACK');
      try { seedream4Progress.delete(actualSessionId); } catch {}
      return res.status(500).json({ error: 'Mock generation failed' });
    } finally {
      client.release();
    }
  }

  // Simple image dimension detection function
  const detectImageDimensions = async (imageUrl) => {
    try {
      const response = await fetch(imageUrl);
      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      // Simple PNG/JPEG dimension detection
      if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
        // PNG
        const width = (uint8Array[16] << 24) | (uint8Array[17] << 16) | (uint8Array[18] << 8) | uint8Array[19];
        const height = (uint8Array[20] << 24) | (uint8Array[21] << 16) | (uint8Array[22] << 8) | uint8Array[23];
        return { width, height };
      } else if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
        // JPEG - simplified detection (would need more complex parsing for full support)
        return { width: 1920, height: 1080 }; // Default fallback for JPEG
      }
    } catch (e) {
      try { getReqLogger(req, 'seedream4').debug({ event: 'aspect.error', msg: e.message }); } catch {}
    }
    return null;
  };

  try {
    await client.query('BEGIN');

    // Session already created outside transaction - no need to create again

    // Progress setter (session already initialized)
    const requestedCount = requested;
    const setProgress = (index, value) => {
      const entry = seedream4Progress.get(actualSessionId);
      if (!entry) return;
      const next = Array.isArray(entry.progress) ? entry.progress.slice() : [];
      next[index] = Math.max(0, Math.min(100, Math.round(value)));
      entry.progress = next;
      seedream4Progress.set(actualSessionId, entry);
      // Push progress to any active SSE clients for this user
      sseBroadcast(entry.userId, 'progress', { sessionId: actualSessionId, progress: next });
    };

    const fetchSingleImage = async (index) => {
      setProgress(index, 10);
      const tProvider0 = Date.now();
      // Always use ModelArk content array format for Seedream 4.0
      const promptText = String(prompt || '').trim();
      // Map UI size tokens (1K/2K/4K) to API expectation. If user passed exact WxH, forward as-is.
      const normalizedSize = (() => {
        const s = String(size || '').toLowerCase();
        if (s === '1k') return '1K';
        if (s === '2k') return '2K';
        if (s === '4k') return '4K';
        return size; // assume exact WxH or supported token
      })();

      // Decide whether to send an explicit WxH size when a reference image is used.
      // If frontend provided exact pixel size (e.g., "3136x1344"), include it to force aspect.
      // Otherwise, omit size and rely on aspect_ratio or provider inference.
      const isExplicitWxH = (val) => typeof val === 'string' && /^\d{2,5}x\d{2,5}$/i.test(val.trim());
      let finalSize = size;

      // If the user selected an aspect ratio (or provided via match first image), compute explicit WxH
      const deriveSizeFromAspect = () => {
        const token = String(normalizedSize || '').toUpperCase();
        const ar = String(aspect_ratio || '').trim();
        if (!ar) return null;
        const m = ar.match(/^(\d+)\s*[:/]\s*(\d+)$/);
        if (!m) return null;
        const aw = Math.max(1, parseInt(m[1], 10));
        const ah = Math.max(1, parseInt(m[2], 10));
        // Simplify ratio for preset matching
        const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
        const g = gcd(aw, ah);
        const sw = Math.round(aw / g);
        const sh = Math.round(ah / g);
        const key = `${sw}:${sh}`;
        const PRESETS = {
          '1:1':  { '1K': '1280x1280', '2K': '1920x1920', '4K': '3840x3840' },
          '16:9': { '1K': '1280x720',  '2K': '1920x1080', '4K': '3840x2160' },
          '9:16': { '1K': '720x1280',  '2K': '1080x1920', '4K': '2160x3840' },
          '2:3':  { '1K': '853x1280',  '2K': '1280x1920', '4K': '2560x3840' },
          '3:4':  { '1K': '960x1280',  '2K': '1440x1920', '4K': '2880x3840' },
          '1:2':  { '1K': '640x1280',  '2K': '960x1920',  '4K': '1920x3840' },
          '2:1':  { '1K': '1280x640',  '2K': '1920x960',  '4K': '3840x1920' },
          '4:5':  { '1K': '1024x1280', '2K': '1536x1920', '4K': '3072x3840' },
          '3:2':  { '1K': '1280x853',  '2K': '1920x1280', '4K': '3840x2560' },
          '4:3':  { '1K': '1280x960',  '2K': '1920x1440', '4K': '3840x2880' }
        };
        if (PRESETS[key] && PRESETS[key][token]) return PRESETS[key][token];
        // Fallback: long-edge method
        const baseEdge = token === '4K' ? 3840 : token === '2K' ? 1920 : 1280; // 1K default
        let w, h;
        if (aw >= ah) {
          w = baseEdge;
          h = Math.round(baseEdge * (ah / aw));
        } else {
          h = baseEdge;
          w = Math.round(baseEdge * (aw / ah));
        }
        return `${Math.max(1, w)}x${Math.max(1, h)}`;
      };
      // Only derive from aspect tokens if caller did NOT supply an explicit WxH.
      // If size is already an explicit WxH (e.g., Match First Image exact size), honor it.
      if (!isExplicitWxH(finalSize)) {
        const derived = deriveSizeFromAspect();
        if (derived) finalSize = derived;
      }
      
      // BytePlus requires minimum 921,600 pixels total. Scale up if needed.
      if (isExplicitWxH(finalSize)) {
        const [width, height] = finalSize.split('x').map(Number);
        const totalPixels = width * height;
        const minPixels = 921600; // BytePlus minimum requirement

        if (totalPixels < minPixels) {
          // Preserve exact aspect ratio with integer multiples and even rounding
          const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
          const g = gcd(Math.max(1, width), Math.max(1, height));
          const sw = Math.round(width / g);
          const sh = Math.round(height / g);
          // Find the minimal integer multiplier m such that (sw*m)*(sh*m) >= minPixels
          const areaUnit = sw * sh;
          let m = Math.ceil(Math.sqrt(minPixels / areaUnit));
          // Ensure even dimensions if provider prefers even sizes
          const isEven = (n) => (n % 2) === 0;
          while (!isEven(sw * m) || !isEven(sh * m)) {
            m += 1;
          }
          const newWidth = sw * m;
          const newHeight = sh * m;
          finalSize = `${newWidth}x${newHeight}`;
          console.log(`[seedream4][sizeScale] Original: ${width}x${height} (${totalPixels}px) -> Scaled: ${finalSize} (${newWidth * newHeight}px) using m=${m} for ${sw}:${sh}`);
        }
      }
      
      // Calculate derived sizes for all resolution tokens to save for reuse
      const derivedSizes = (() => {
        const aspect = derivedAspectRatio || aspect_ratio;
        if (!aspect || typeof aspect !== 'string') return {};
        
        // Parse aspect ratio
        const m = aspect.match(/^(\d+)\s*[:/]\s*(\d+)$/);
        if (!m) return {};
        
        let aw = Math.max(1, parseInt(m[1], 10));
        let ah = Math.max(1, parseInt(m[2], 10));
        
        // Simplify ratio
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const g = gcd(aw, ah);
        const sw = Math.round(aw / g);
        const sh = Math.round(ah / g);
        const key = `${sw}:${sh}`;
        
        // Use the same preset values as frontend
        const PRESETS = {
          '1:1': { '1K': '1280×1280', '2K': '1920×1920', '4K': '3840×3840' },
          '16:9': { '1K': '1280×720', '2K': '1920×1080', '4K': '3840×2160' },
          '9:16': { '1K': '720×1280', '2K': '1080×1920', '4K': '2160×3840' },
          '21:9': { '1K': '—', '2K': '1920×823', '4K': '3840×1646' },
          '2:3': { '1K': '853×1280', '2K': '1280×1920', '4K': '2560×3840' },
          '3:4': { '1K': '960×1280', '2K': '1440×1920', '4K': '2880×3840' },
          '1:2': { '1K': '—', '2K': '960×1920', '4K': '1920×3840' },
          '2:1': { '1K': '—', '2K': '1920×960', '4K': '3840×1920' },
          '4:5': { '1K': '1024×1280', '2K': '1536×1920', '4K': '3072×3840' },
          '3:2': { '1K': '1280×853', '2K': '1920×1280', '4K': '3840×2560' },
          '4:3': { '1K': '1280×960', '2K': '1920×1440', '4K': '3840×2880' }
        };
        
        if (PRESETS[key]) {
          // Convert × to x for consistency
          const result = {};
          Object.keys(PRESETS[key]).forEach(token => {
            result[token] = PRESETS[key][token].replace('×', 'x');
          });
          return result;
        }
        
        // For custom ratios, use the same calculation as frontend
        const calc = (token) => {
          const baseWidth = token === '4K' ? 3840 : token === '2K' ? 1920 : 1280;
          let w, h;
          if (sw >= sh) {
            w = baseWidth;
            h = Math.round(baseWidth * (sh / sw));
          } else {
            h = baseWidth;
            w = Math.round(baseWidth * (sw / sh));
          }
          return `${w}x${h}`;
        };
        
        return { '1K': calc('1K'), '2K': calc('2K'), '4K': calc('4K') };
      })();
      
      // Build canonical input_settings snapshot for exact reuse later (after finalSize is computed)
      try { getReqLogger(req, 'seedream4').debug({ event: 'sizes.derived', derivedSizes }); } catch {}
      const inputSettings = {
        prompt: prompt,
        model,
        outputs,
        aspect_ratio_mode: arMode,
        aspect_ratio_value: derivedAspectRatio || null,
        resolution_mode: (/^\d{2,5}x\d{2,5}$/i.test(String(size || '')) ? 'exact' : 'token'),
        resolution_value: size,
        computed_size: finalSize, // authoritative final size sent to provider (the actual WxH used)
        derived_sizes: derivedSizes, // calculated WxH for each resolution token (1K, 2K, 4K)
        guidance_scale,
        negative_prompt: negative_prompt || null,
        seed: typeof seed === 'number' ? seed : (seed ? Number(seed) : null),
        watermark: Boolean(watermark),
        ref_image_urls: Array.isArray(ref_image_urls) ? ref_image_urls.slice(0, 10) : (ref_image_url ? [ref_image_url] : []),
      };
      try { getReqLogger(req, 'seedream4').debug({ event: 'input.settings', inputSettings }); } catch {}
      
      // Session already created outside transaction - no duplicate creation needed
      
      // Determine which reference images to use (allow up to 10)
      let referenceImages = [];
      if (ref_image_urls && Array.isArray(ref_image_urls) && ref_image_urls.length > 0) {
        referenceImages = ref_image_urls.filter(url => url && typeof url === 'string').slice(0, 10);
        if (ref_image_urls.length > 10) {
          try { getReqLogger(req, 'seedream4').warn({ event: 'refs.truncated', count: ref_image_urls.length, kept: 10 }); } catch {}
        }
      } else if (ref_image_url && typeof ref_image_url === 'string') {
        referenceImages = [ref_image_url];
      }
      
      // Auto-convert non-JPEG references to JPEG to satisfy provider requirements
      if (referenceImages.length && sharp) {
        const converted = [];
        for (const url of referenceImages) {
          try {
            const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
            const input = Buffer.from(resp.data);
            const meta = await sharp(input).metadata();
            // Only convert if not already JPEG or PNG
            if (!meta || (meta.format !== 'jpeg' && meta.format !== 'png')) {
              const out = await sharp(input).jpeg({ quality: 90 }).toBuffer();
              converted.push(`data:image/jpeg;base64,${out.toString('base64')}`);
            } else {
              converted.push(url);
            }
          } catch (_) {
            converted.push(url);
          }
        }
        referenceImages = converted;
      }
      
      // Send explicit WxH whenever provided (even with reference images) so the
      // output preserves the first image's aspect ratio. We already scale up
      // to the provider's minimum pixel requirement above.
      const sendExplicitSize = isExplicitWxH(finalSize);

      const body = {
        model,
        prompt: promptText,
        ...(referenceImages.length > 0 ? { image: referenceImages } : {}),
        ...(negative_prompt ? { negative_prompt } : {}),
        response_format,
        // Previous behavior: only send explicit WxH if we have it; otherwise
        // omit size when refs exist (let provider infer), or send normalized
        // token when no refs.
        ...(sendExplicitSize ? { size: finalSize } : (!referenceImages.length ? { size: normalizedSize } : {})),
        stream: false,
        sequential_image_generation: 'disabled',
        watermark: Boolean(watermark),
        n: 1,
        // aspect_ratio is not supported by Seedream 4.0; do not send it
        ...(typeof seed === 'number' ? { seed } : (seed ? { seed: Number(seed) } : {}))
      };
      try { getReqLogger(req, 'seedream4').debug({ event: 'payload', hasImages: referenceImages.length > 0, imageCount: referenceImages.length, size: sendExplicitSize ? finalSize : (!referenceImages.length ? normalizedSize : '(omitted)') }); } catch {}
      const resp = await axios.post(
        `${SEEDREAM4_API_BASE}/api/v3/images/generations`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SEEDREAM4_API_KEY}`
          }
        }
      );
      const providerElapsed = Date.now() - tProvider0;
      breakdown.providerMs.push(providerElapsed);
      try { getReqLogger(req, 'seedream4').info({ event: 'provider.request', elapsedMs: providerElapsed, sessionId: actualSessionId }); } catch {}
      const dat = resp.data;
      try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId: actualSessionId, provider: 'byteplus', model, endpoint: 'images/generations', raw: dat }); } catch(_) {}
      let urlsInner = [];
      if (dat?.data) {
        urlsInner = dat.data.map(item => item.url).filter(Boolean);
      } else if (dat?.url) {
        urlsInner = [dat.url];
      }
      try { getReqLogger(req, 'seedream4').info({ event: 'provider.response', urls: urlsInner.length }); } catch {}
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
          const dlUpElapsed = Date.now() - tDlUp0;
          breakdown.uploadMs.push(dlUpElapsed);
          try { getReqLogger(req, 'seedream4').info({ event: 'download.upload', elapsedMs: dlUpElapsed, filename: result.b2_filename }); } catch {}
          setProgress(i, 85);
          storedImages.push(result);
        } catch (error) {
          console.error(`❌ Failed to process Seedream 4.0 image ${url}:`, error);
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
                width,
                height,
                client_key,
                created_at,
                completed_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
              [
                actualSessionId, 
                img.original_url, 
                img.b2_filename, 
                img.b2_url, 
                img.b2_folder, 
                img.file_size, 
                'b2',
                img.generation_tool,
                img.width || null,
                img.height || null,
                clientKey || null
              ]
            ).then(() => setProgress(idx, 100))
          )
        );
        const insertImagesElapsed = Date.now() - tImgInsert0;
        breakdown.insertImagesMs = insertImagesElapsed;
        try { getReqLogger(req, 'seedream4').info({ event: 'insert.images', elapsedMs: insertImagesElapsed, count: storedImages.length }); } catch {}
        // Persist USD costs and token usage if present
        try {
          if (lastUsage) {
            await client.query('UPDATE generation_sessions SET token_usage = $1, completion_tokens = $2, total_tokens = $3 WHERE id = $4', [JSON.stringify(lastUsage), Number(lastUsage.completion_tokens) || null, Number(lastUsage.total_tokens) || null, actualSessionId]);
          }
          const { getImagePerUsd } = require('../utils/videoPricing');
          const perImageUsd = await getImagePerUsd(model);
          const outputsNum = Math.max(1, Number(requested) || 1);
          const sessionUsd = perImageUsd * outputsNum;
          await client.query('UPDATE generation_sessions SET per_image_usd = $1, session_usd = $2 WHERE id = $3', [perImageUsd || null, sessionUsd || null, actualSessionId]);
        } catch (_) {}
        
        // Notify images_attached (SSE)
        try {
          const payload = JSON.stringify({
            user_id: req.user.userId,
            reservation_id: reserve.reservationId,
            session_id: actualSessionId,
            urls: storedImages.map(img => img.b2_url || img.original_url),
            event_ts: Date.now()
          }).replace(/'/g, "''");
          await client.query(`NOTIFY images_attached, '${payload}'`);
        } catch (e) { try { getReqLogger(req, 'seedream4').warn({ event: 'notify.images_attached.failed', msg: e?.message || String(e) }); } catch {} }
        
        // Mark session completed
        const tComplete0 = Date.now();
        // If we detected dimensions, persist resolution on the session for UI
        let detectedResolution = null;
        let detectedAspect = null;
        const firstWithDims = storedImages.find(s => s.width && s.height);
        if (firstWithDims) {
          const w = Number(firstWithDims.width);
          const h = Number(firstWithDims.height);
          detectedResolution = `${w}x${h}`;
          // Simplify aspect ratio via gcd
          const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
          const g = gcd(w, h);
          const sw = Math.max(1, Math.round(w / g));
          const sh = Math.max(1, Math.round(h / g));
          detectedAspect = `${sw}:${sh}`;
        }
        await client.query(
          'UPDATE generation_sessions SET status = $1, completed_at = NOW(), resolution = COALESCE($3, resolution), aspect_ratio = COALESCE($4, aspect_ratio) WHERE id = $2', 
          ['completed', actualSessionId, detectedResolution, detectedAspect]
        );
        
        // Notify session_completed (SSE)
        try {
          const payload = JSON.stringify({
            user_id: req.user.userId,
            reservation_id: reserve.reservationId,
            session_id: actualSessionId,
            event_ts: Date.now()
          }).replace(/'/g, "''");
          await client.query(`NOTIFY session_completed, '${payload}'`);
        } catch (e) { try { getReqLogger(req, 'seedream4').warn({ event: 'notify.session_completed.failed', msg: e?.message || String(e) }); } catch {} }
        // Also broadcast 'done' over SSE after DB is finalized
        try { sseBroadcast(req.user.userId, 'done', { sessionId: actualSessionId }); } catch (_) {}
        
        // Capture credits asynchronously to avoid delaying API response on DB locks
        try { captureReservation(reserve.reservationId, { description: 'Seedream 4.0' }).catch(()=>{}); } catch (_) {}
        const completeElapsed = Date.now() - tComplete0;
        try { getReqLogger(req, 'seedream4').info({ event: 'complete.session', elapsedMs: completeElapsed, storedCount: storedImages.length }); } catch {}

        // Clear in-memory progress for this session (avoid stale polling)
        try { seedream4Progress.delete(actualSessionId); } catch {}
      }
    } else {
      await client.query(
        'UPDATE generation_sessions SET status = $1 WHERE id = $2', 
        ['failed', actualSessionId]
      );
      // Release reservation on failure path with no URLs
      try { await releaseReservation(reserve.reservationId); } catch(_) {}

      // Clear in-memory progress for failed sessions as well
      try { seedream4Progress.delete(actualSessionId); } catch {}
      // Broadcast failed over SSE
      try { sseBroadcast(req.user.userId, 'failed', { sessionId: actualSessionId }); } catch (_) {}
    }

    await client.query('COMMIT');

    // Return results
    const tFetchImgs0 = Date.now();
    const { rows: imageRows } = await client.query(
      'SELECT * FROM images WHERE session_id = $1',
      [actualSessionId]
    );
    try { getReqLogger(req, 'seedream4').debug({ event: 'fetch.images', elapsedMs: Date.now() - tFetchImgs0 }); } catch {}

    // Compute total time and persist to DB
    const totalMs = Date.now() - requestStartMs;
    try {
      await db.query('UPDATE generation_sessions SET duration_ms = $1 WHERE id = $2', [totalMs, actualSessionId]);
    } catch (e) {
      console.error('[seedream4][durationPersistError]', e?.message || e);
    }

    const bal = await getCredits(req.user.userId);
    res.json({
      success: true,
      sessionId: actualSessionId,
      images: imageRows.map(img => ({
        id: img.id,
        url: img.b2_url || img.url, // Use B2 URL if available
        original_url: img.url,
        filename: img.b2_filename,
        file_size: img.file_size,
        generation_tool: img.generation_tool
      })),
      creditsUsed: cost,
      creditsLeft: bal?.credits
    });
    const providerMs = breakdown.providerMs;
    const uploadMs = breakdown.uploadMs;
    const summary = {
      insertSessionMs: breakdown.insertSessionMs,
      providerMsTotal: providerMs.reduce((a,b)=>a+b,0),
      providerMsMax: providerMs.length ? Math.max(...providerMs) : 0,
      uploadMsTotal: uploadMs.reduce((a,b)=>a+b,0),
      uploadMsMax: uploadMs.length ? Math.max(...uploadMs) : 0,
      insertImagesMs: breakdown.insertImagesMs
    };
    try { getReqLogger(req, 'seedream4').info({ event: 'total', totalMs, sessionId: actualSessionId, breakdown: summary }); } catch {}
  } catch (err) {
    await client.query('ROLLBACK');
    // Release reservation on error
    try { await releaseReservation(reserve.reservationId); } catch(_) {}
    const status = err?.response?.status || 500;
    const raw = err?.response?.data;
    const message = typeof raw === 'string' ? raw : (raw?.error || raw?.message || raw?.msg || raw || err.message);
    console.error('Seedream 4.0 image generation error:', message);
    res.status(status).json({ error: message });
  } finally {
    client.release();
    // Clean up latest session pointer when generation finishes (best-effort)
    try {
      const current = latestSessionByUser.get(req.user.userId);
      if (current) latestSessionByUser.delete(req.user.userId);
    } catch {}
  }
});

// Fetch Seedream 4.0 image history for the authenticated user
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default 10 items per page
    const offset = parseInt(req.query.offset) || 0; // Default start from beginning
    const modelLike = (req.query.model_like || '').trim();

    // Build session-only WHERE (limit sessions first). Also pre-filter to Seedream 4 sessions by
    // (a) model like 'seedream-4%' or (b) having at least one image with generation_tool = 'byteplus-seedream-4'.
    // Use EXISTS to avoid joining images in the CTE.
    const sessionWhereParts = [
      's.user_id = $1',
      "(LOWER(s.model) LIKE 'seedream-4%' OR EXISTS (SELECT 1 FROM images i2 WHERE i2.session_id = s.id AND i2.generation_tool = 'byteplus-seedream-4'))"
    ];
    const params = [req.user.userId];
    if (modelLike) {
      sessionWhereParts.push('LOWER(s.model) LIKE LOWER($2)');
      params.push(modelLike);
    }
    // Filter applied after join for image/tool state
    const joinFilter = "(i.generation_tool = 'byteplus-seedream-4' OR (i.generation_tool IS NULL AND s.status IN ('processing','pending','failed')))";
    params.push(limit);
    params.push(offset);
    const sessionWhereSql = sessionWhereParts.join(' AND ');

    // IMPORTANT: Apply LIMIT/OFFSET at the session level, then join images
    const sessionLevelSql = `
      WITH selected_sessions AS (
        SELECT s.*
        FROM generation_sessions s
        WHERE ${sessionWhereSql}
        ORDER BY s.created_at DESC
        LIMIT $${params.length-1} OFFSET $${params.length}
      )
      SELECT 
        s.id AS session_id,
        s.prompt,
        s.model,
        s.status,
        s.created_at,
        s.completed_at,
        s.outputs,
        s.aspect_ratio,
        s.resolution,
        s.guidance_scale,
        s.credit_cost,
        s.error_details,
        s.ref_image_url,
        s.ref_image_urls,
        s.input_settings,
        s.client_key,
        i.url,
        i.b2_url,
        i.client_key as image_client_key,
        i.created_at as image_created_at,
        i.completed_at as image_completed_at
      FROM selected_sessions s
      LEFT JOIN images i ON i.session_id = s.id
      WHERE ${joinFilter}
      ORDER BY s.created_at DESC
    `;

    const { rows } = await db.query(sessionLevelSql, params);

    // Also get total count for pagination info
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM generation_sessions s 
       WHERE s.user_id = $1 AND (LOWER(s.model) LIKE 'seedream-4%' OR EXISTS (SELECT 1 FROM images i2 WHERE i2.session_id = s.id AND i2.generation_tool = 'byteplus-seedream-4'))`,
      [req.user.userId]
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
    console.error('Seedream 4.0 history fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch Seedream 4.0 history' });
  }
});

// Estimate average generation duration (ms) based on past completed Seedream 4.0 sessions
router.get('/estimate', auth, async (req, res) => {
  try {
    // Average of the previous up to 32 completed Seedream 4.0 generations for the requested outputs
    const outputs = Number(req.query.outputs || 0) || null;
    try { getReqLogger(req, 'seedream4').debug({ event: 'estimate.request', outputs }); } catch {}
    const params = [];
    let sql = `
      WITH recent AS (
        SELECT s.duration_ms AS ms
        FROM generation_sessions s
        LEFT JOIN images i ON i.session_id = s.id
        WHERE s.status = 'completed'
          AND s.duration_ms IS NOT NULL
          AND s.duration_ms > 0
          AND i.generation_tool = 'byteplus-seedream-4'`;
    if (outputs) {
      params.push(outputs);
      sql += ` AND s.outputs = $${params.length}`;
    }
    sql += `
        ORDER BY s.completed_at DESC
        LIMIT 32
      )
      SELECT AVG(ms) AS avg_ms, COUNT(*) AS sample_size FROM recent
    `;
    try { getReqLogger(req, 'seedream4').debug({ event: 'estimate.query', sql, params }); } catch {}
    const { rows } = await db.query(sql, params);
    try { getReqLogger(req, 'seedream4').debug({ event: 'estimate.result', rows }); } catch {}
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
    try { getReqLogger(req, 'seedream4').debug({ event: 'estimate.done', outputs: outputs ?? 'any', sampleSize, averageMs: estimate, raw: avgMsRaw }); } catch {}
    return res.json({ averageMs: estimate, sampleSize, outputs: outputs ?? null });
  } catch (err) {
    console.error('Seedream 4.0 estimate computation error:', err);
    return res.status(500).json({ error: 'Failed to compute Seedream 4.0 estimate' });
  }
});

module.exports = router;

// Upload reference image (drag & drop)
// Public: allow uploads when logged out; always store to B2
router.post('/upload-ref', async (req, res) => {
  try {
    const MAX_BYTES = Number(process.env.MAX_REF_IMAGE_BYTES || 10 * 1024 * 1024); // 10 MB default
    const chunks = [];
    let total = 0;
    let aborted = false;

    const cl = Number(req.headers['content-length'] || 0);
    if (cl && cl > MAX_BYTES) {
      return res.status(413).json({ error: 'Reference image must be ≤ 10 MB' });
    }

    req.on('data', (c) => {
      if (aborted) return;
      total += c.length;
      if (total > MAX_BYTES) {
        aborted = true;
        try { req.pause(); } catch {}
        return res.status(413).json({ error: 'Reference image must be ≤ 10 MB' });
      }
      chunks.push(c);
    });

    req.on('end', async () => {
      if (aborted) return;
      const buf = Buffer.concat(chunks);
      if (!buf || buf.length === 0) return res.status(400).json({ error: 'Empty file' });
      let mime = 'image/png';
      if (buf[0] === 0xFF && buf[1] === 0xD8) mime = 'image/jpeg';
      if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
      if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
      const filename = `seedream4_ref_${Date.now()}_${Math.random().toString(36).slice(2)}.${mime.includes('jpeg') ? 'jpg' : mime.split('/')[1]}`;
      const url = await uploadSeedream4RefImage(buf, filename, mime);
      return res.json({ url });
    });
  } catch (e) {
    console.error('Seedream 4.0 ref upload error:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});
