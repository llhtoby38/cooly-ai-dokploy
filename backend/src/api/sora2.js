const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const auth = require('../middleware/auth');
const db = require('../db');
const { reserveCredits, captureReservation, releaseReservation, getCredits } = require('../utils/credits');
const { uploadSoraVideo, streamUrlToB2 } = require('../utils/storage');

const router = express.Router();
const { getReqLogger } = require('../utils/logger');

const { shouldMock } = require('../utils/featureFlags');
let MOCK_MODE = false;

// Global timeout for provider jobs
const SORA_TIMEOUT_MS = Number(process.env.SORA_TIMEOUT_MS || 300000); // 5 minutes default

// Provider selection
function resolveProvider() {
  const p = String(process.env.SORA_PROVIDER || 'openai').toLowerCase();
  if (p === 'fal') return 'fal';
  if (p === 'wavespeed') return 'wavespeed';
  return 'openai';
}

function resolveProviderModel(provider, uiModel) {
  const isPro = String(uiModel || '').toLowerCase().includes('pro');
  if (provider === 'fal') {
    const base = process.env.FAL_SORA_MODEL || 'fal-ai/sora-2/text-to-video';
    const pro = process.env.FAL_SORA_MODEL_PRO || 'fal-ai/sora-2/text-to-video/pro';
    return isPro ? pro : base;
  }
  // Wavespeed uses endpoint paths instead of model ids; return ui model for reference
  if (provider === 'wavespeed') {
    return isPro ? 'sora-2-pro' : 'sora-2';
  }
  const openaiBase = process.env.OPENAI_SORA_MODEL || 'sora-2';
  const openaiPro = process.env.OPENAI_SORA_MODEL_PRO || 'sora-2-pro';
  return isPro ? openaiPro : openaiBase;
}

// Sora API config (OpenAI-style proxy)
const SORA_API_KEY = process.env.OPENAI_API_KEY;
const SORA_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

function computeSizeString(aspectRatio, resolution) {
  const ar = String(aspectRatio || '').trim();
  const res = String(resolution || '').toLowerCase();
  const isPortrait = ar === '9:16' || ar === '3:4' || ar === '2:3';
  // Default to 720p landscape if unknown
  if (res.includes('1080')) {
    return isPortrait ? '1080x1920' : '1920x1080';
  }
  // fallback 720p
  return isPortrait ? '720x1280' : '1280x720';
}

function computeWavespeedSize(aspectRatio, resolution) {
  // Wavespeed expects width*height format
  const size = computeSizeString(aspectRatio, resolution); // e.g., 1280x720
  return size.replace('x', '*');
}

async function soraCreate(prompt, providerModel, aspectRatio, resolution, duration /*, imageUrl, startFrameUrl, endFrameUrl */) {
  if (!SORA_API_KEY) throw new Error('SORA not configured');
  const url = `${SORA_API_BASE}/videos`;
  const size = computeSizeString(aspectRatio, resolution);
  const seconds = Math.max(1, Number(duration) || 5);
  const form = new FormData();
  form.append('prompt', String(prompt || ''));
  form.append('model', String(providerModel || 'sora-2'));
  form.append('size', size);
  form.append('seconds', String(seconds));
  const resp = await axios.post(url, form, {
    headers: {
      'Authorization': `Bearer ${SORA_API_KEY}`,
      ...form.getHeaders()
    },
    maxBodyLength: Infinity
  });
  const data = resp.data || {};
  if (!data.id) throw new Error('Sora: missing id in create response');
  return { id: data.id, status: data.status || 'queued', raw: data };
}

async function soraGetTask(videoId) {
  if (!SORA_API_KEY) throw new Error('SORA not configured');
  const url = `${SORA_API_BASE}/videos/${encodeURIComponent(videoId)}`;
  const resp = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${SORA_API_KEY}` }
  });
  const raw = resp.data || {};
  const s = String(raw.status || raw.state || '').toLowerCase();
  const provider_status = s === 'in_progress' ? 'in_progress' : (s || 'queued');
  if (s === 'completed') {
    return { status: 'completed', provider_status, raw };
  }
  if (s === 'failed') {
    return { status: 'failed', provider_status, error: raw.error || raw.message || 'Generation failed', raw };
  }
  return { status: 'processing', provider_status, raw };
}

async function waitForTask(videoId) {
  const start = Date.now();
  while (true) {
    const st = await soraGetTask(videoId);
    const s = String(st.status || st.state || '').toLowerCase();
    if (['completed'].includes(s)) return st;
    if (['failed'].includes(s)) throw new Error(st.error || 'Sora task failed');
    if (Date.now() - start > SORA_TIMEOUT_MS) throw new Error('Sora task timeout');
    await new Promise(r => setTimeout(r, 10000));
  }
}

// Start Sora video generation
router.post('/generate', auth, async (req, res) => {
  try {
    const { prompt, model = 'sora-2', aspectRatio = '16:9', resolution = '1080p', duration = null, imageUrl = null, startFrameUrl = null, endFrameUrl = null, clientKey = undefined } = req.body || {};
    const provider = resolveProvider();
    const providerModel = resolveProviderModel(provider, model);
    const uiIsPro = String(model || '').toLowerCase().includes('pro');
    // What to store in DB for model column
    let dbModel = providerModel;
    if (provider === 'wavespeed') {
      dbModel = uiIsPro ? 'wavespeed sora-2-pro' : 'wavespeed sora-2';
    }
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });

    // Pricing placeholder: reuse Seedance credit as a default fallback
    // Compute credits: look up price_per_second by model+resolution; multiply by duration
    let COST = Number(process.env.SORA_CREDITS_DEFAULT || 5);
    let perSecondUsd = null;
    let sessionUsd = null;
    try {
      const { getSoraPricePerSecond } = require('../utils/videoPricing');
      const row = await getSoraPricePerSecond(model, resolution);
      const pps = row ? Number(row.price_per_second) : null;
      const cps = row ? Number(row.credits_per_second) : null;
      const secs = Math.max(1, Number(duration) || 5);
      if (cps != null) COST = Math.ceil(cps * secs);
      if (pps != null) { perSecondUsd = pps; sessionUsd = Number((pps * secs).toFixed(4)); }
    } catch (_) {}
    const ttl = Number(process.env.RESERVATION_TTL_SECONDS || 600);
    const reservation = await reserveCredits(req.user.userId, COST, { description: 'Sora 2 (reservation)', ttlSeconds: ttl });
    if (!reservation.success) return res.status(402).json({ error: reservation.error || 'Credit check failed' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      let r;
      try {
        const ins = await client.query(
          'INSERT INTO sora_video_sessions (user_id, prompt, provider, model, aspect_ratio, status, provider_status, resolution, video_duration, credit_cost, per_second_usd, session_usd, reservation_id, client_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id',
          [req.user.userId, prompt, provider, dbModel, aspectRatio, 'processing', 'queued', resolution, duration, COST, perSecondUsd, sessionUsd, reservation.reservationId, clientKey || null]
        );
        r = ins.rows;
      } catch (e) {
        // Fallback for older schema without provider column
        const ins2 = await client.query(
          'INSERT INTO sora_video_sessions (user_id, prompt, model, aspect_ratio, status, provider_status, resolution, video_duration, credit_cost, per_second_usd, session_usd, reservation_id, client_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
          [req.user.userId, prompt, dbModel, aspectRatio, 'processing', 'queued', resolution, duration, COST, perSecondUsd, sessionUsd, reservation.reservationId, clientKey || null]
        );
        r = ins2.rows;
      }
      const sessionId = r[0].id;
      if (!clientKey) { try { await client.query('UPDATE sora_video_sessions SET client_key = COALESCE(client_key, id::text) WHERE id = $1', [sessionId]); } catch(_) {} }

      try { MOCK_MODE = await shouldMock('sora2'); } catch { MOCK_MODE = false; }
      if (MOCK_MODE) {
        await client.query('COMMIT');
        const bal = await getCredits(req.user.userId);
        res.json({ success: true, sessionId, message: 'Sora 2 (mock) started', prompt, credits_left: bal?.credits, status: 'processing' });
        // background finalize
        (async () => {
          try {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            try { getReqLogger(null, 'sora2').info({ event: 'mock.finalize.start', sessionId, reservationId: reservation?.reservationId || null }); } catch {}
            
            // Use env vars for mock delay, matching Seedance behavior
            const minMs = Number(process.env.SORA_MOCK_MIN_MS || 12000);
            const maxMs = Number(process.env.SORA_MOCK_MAX_MS || 22000);
            const totalMs = minMs + Math.floor(Math.random() * Math.max(0, (maxMs - minMs) + 1));
            await sleep(totalMs);
            
            // Use direct URL without downloading/uploading (matches Seedance mock behavior)
            const mockUrl = `https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4`;
            const filename = `sora_${sessionId}_${Date.now()}.mp4`;
            const b2Url = mockUrl;
            const storage = 'mock';
            try { getReqLogger(null, 'sora2').info({ event: 'mock.url', sessionId, mockUrl }); } catch {}
            try {
              await db.query(
                `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
                 VALUES ($1,$2,$3,$4,$5)`,
                [sessionId, mockUrl, filename, b2Url, storage]
              );
              try { getReqLogger(null, 'sora2').debug({ event: 'mock.insert.video', sessionId, storage, b2Url }); } catch {}
            } catch (e) {
              console.error('[sora2][mock] INSERT sora_videos failed', { sessionId, error: e?.message || String(e) });
              throw e;
            }
            try {
              await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', sessionId]);
              try { getReqLogger(null, 'sora2').info({ event: 'mock.session.completed', sessionId }); } catch {}
            } catch (e) {
              console.error('[sora2][mock] UPDATE session failed', { sessionId, error: e?.message || String(e) });
              throw e;
            }
            try { await captureReservation(reservation.reservationId, { description: 'Sora 2' }); } catch (_) {}
          } catch (e) {
            console.error('[sora2][mock] finalize error', { sessionId, error: e?.message || String(e) });
            await db.query('UPDATE sora_video_sessions SET status=$1 WHERE id=$2', ['failed', sessionId]).catch((err)=>console.warn('[sora2][mock] mark failed error', err?.message || err));
          }
        })();
        return;
      }

      if (provider === 'openai') {
        const createStart = Date.now();
        const created = await soraCreate(prompt, providerModel, aspectRatio, resolution, duration, imageUrl, startFrameUrl, endFrameUrl);
        const createMs = Date.now() - createStart;
        const videoId = created.id;
        try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId, taskId: videoId, provider: 'openai', model: providerModel, endpoint: 'videos', raw: created?.raw || created, timing: { apiMs: createMs } }); } catch(_) {}
        await client.query('UPDATE sora_video_sessions SET task_id = $1, provider_status = $2 WHERE id = $3', [videoId, created.status || 'queued', sessionId]);
        if (!clientKey) { try { await client.query('UPDATE sora_video_sessions SET client_key = COALESCE(client_key, $1) WHERE id = $2', [videoId, sessionId]); } catch(_) {} }
        await client.query('COMMIT');

        ;(async () => {
          const bgStartMs = Date.now();
          let apiMs = createMs, transferMs = 0, dbMs = 0;
          try {
            const pollStart = Date.now();
            const result = await waitForTask(videoId);
            apiMs += (Date.now() - pollStart);
            try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId, taskId: videoId, provider: 'openai', model: providerModel, endpoint: 'videos/status', raw: result?.raw || result, timing: { apiMs: Date.now() - pollStart } }); } catch(_) {}
            try {
              await db.query('UPDATE sora_video_sessions SET provider_status = $1 WHERE id = $2', [result?.provider_status || 'in_progress', sessionId]);
            } catch (_) {}
            // When completed, download content stream
            const contentUrl = `${SORA_API_BASE}/videos/${encodeURIComponent(videoId)}/content`;
            const filename = `sora_${sessionId}_${Date.now()}.mp4`;
            const transferStart = Date.now();
            const streamed = await streamUrlToB2({ url: contentUrl, filename, contentType: 'video/mp4', tool: 'sora-2', timeoutMs: 600000, headers: { 'Authorization': `Bearer ${SORA_API_KEY}` } });
            transferMs = Date.now() - transferStart;
            const b2 = streamed.url;
            const dbStart = Date.now();
            await db.query(
              `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
               VALUES ($1,$2,$3,$4,$5)`,
              [sessionId, contentUrl, filename, b2, 'b2']
            );
            const totalMs = Date.now() - bgStartMs;
            const timingBreakdown = {
              totalMs,
              providerApiMs: apiMs,
              videoTransferMs: transferMs,
              dbOpsMs: 0,
              overheadMs: Math.max(0, totalMs - apiMs - transferMs)
            };
            await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW(), timing_breakdown=$3 WHERE id=$4', ['completed', 'completed', JSON.stringify(timingBreakdown), sessionId]);
            dbMs = Date.now() - dbStart;
            try { await captureReservation(reservation.reservationId, { description: 'Sora 2' }); } catch (_) {}
          } catch (e) {
            await db.query('UPDATE sora_video_sessions SET status=$1 WHERE id=$2', ['failed', sessionId]).catch(()=>{});
          }
        })();

        const bal = await getCredits(req.user.userId);
        return res.json({ success: true, sessionId, taskId: videoId, clientKey: clientKey || videoId || null, provider_status: created.status || 'queued', message: 'Sora 2 generation started', prompt, credits_left: bal?.credits });
      }

      // Wavespeed provider path
      if (provider === 'wavespeed') {
        const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
        if (!WAVESPEED_API_KEY) throw new Error('WAVESPEED_API_KEY is required when SORA_PROVIDER=wavespeed');

        const isPro = String(providerModel || '').toLowerCase().includes('pro');
        const wavespeedEndpoint = isPro
          ? 'https://api.wavespeed.ai/api/v3/openai/sora-2/text-to-video-pro'
          : 'https://api.wavespeed.ai/api/v3/openai/sora-2/text-to-video';
        const size = computeWavespeedSize(aspectRatio, resolution); // width*height
        const secs = [4,8,12].includes(Number(duration)) ? Number(duration) : 8;

        const createResp = await axios.post(wavespeedEndpoint, {
          prompt,
          size,
          duration: secs
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`
          },
          timeout: 60000
        });
        const createData = createResp?.data || {};
        const requestId = createData?.data?.id || createData?.data?.request_id || createData?.id;
        const resultGetUrl = createData?.data?.urls?.get || null;
        if (!requestId) throw new Error('Wavespeed: missing request id');
        await client.query('UPDATE sora_video_sessions SET task_id = $1, provider_status = $2 WHERE id = $3', [requestId, 'queued', sessionId]);
        if (!clientKey) { try { await client.query('UPDATE sora_video_sessions SET client_key = COALESCE(client_key, $1) WHERE id = $2', [requestId, sessionId]); } catch(_) {} }
        await client.query('COMMIT');

        ;(async () => {
          try {
            const fallbackUrl = `https://api.wavespeed.ai/api/v3/predictions/${encodeURIComponent(requestId)}/result`;
            const resultUrl = resultGetUrl || fallbackUrl;
            const mapWs = (s) => {
              const v = String(s || '').toLowerCase();
              if (v === 'created') return 'queued';
              if (v === 'processing' || v === 'in_progress') return 'in_progress';
              if (v === 'completed' || v === 'done' || v === 'success') return 'completed';
              if (v === 'failed' || v === 'error') return 'failed';
              return 'queued';
            };
            let last = 'queued';
            const startTs = Date.now();
            while (true) {
              const stResp = await axios.get(resultUrl, {
                headers: { 'Authorization': `Bearer ${WAVESPEED_API_KEY}` },
                timeout: 60000
              });
              const st = stResp?.data || {};
              const status = mapWs(st?.data?.status || st?.status || st?.data?.state);
              if (status !== last) {
                last = status;
                try { await db.query('UPDATE sora_video_sessions SET provider_status = $1 WHERE id = $2', [status, sessionId]); } catch (_) {}
              }
              // Some responses may not set status but include outputs; treat as completed
              const outputs = st?.data?.outputs || [];
              if (status === 'completed' || (Array.isArray(outputs) && outputs.length > 0)) {
                const url = Array.isArray(outputs) ? outputs[0] : null;
                if (!url) throw new Error('Wavespeed: no output url');
                const filename = `sora_${sessionId}_${Date.now()}.mp4`;
                const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'sora-2', timeoutMs: 600000 });
                const b2 = streamed.url;
                await db.query(
                  `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
                   VALUES ($1,$2,$3,$4,$5)`,
                  [sessionId, url, filename, b2, 'b2']
                );
                await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', sessionId]);
                try { await captureReservation(reservation.reservationId, { description: 'Sora 2' }); } catch (_) {}
                break;
              }
              if (status === 'failed') throw new Error('Wavespeed job failed');
              if (Date.now() - startTs > SORA_TIMEOUT_MS) throw new Error('timeout');
              await new Promise(r => setTimeout(r, 5000));
            }
          } catch (e) {
            try {
              await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2 WHERE id=$3', ['failed', 'failed', sessionId]);
            } catch(_) {}
          }
        })();

        const bal = await getCredits(req.user.userId);
        return res.json({ success: true, sessionId, taskId: requestId, clientKey: clientKey || requestId || null, provider_status: 'queued', message: 'Sora 2 generation started', prompt, credits_left: bal?.credits });
      }

      // FAL provider path
      const falKey = process.env.FAL_KEY;
      if (!falKey) throw new Error('FAL_KEY is required when SORA_PROVIDER=fal');
      // FAL: base supports 720p; Pro supports 720p and 1080p
      const isFalPro = String(providerModel || '').endsWith('/pro');
      const falResolution = (isFalPro && String(resolution || '').toLowerCase().includes('1080')) ? '1080p' : '720p';
      const falAspect = (String(aspectRatio).toLowerCase().includes('9:16')) ? '9:16' : '16:9';
      const falSeconds = [4,8,12].includes(Number(duration)) ? Number(duration) : 8;

      let fal;
      try {
        fal = require('@fal-ai/client').fal;
      } catch (e) {
        throw new Error('Please install @fal-ai/client: npm i @fal-ai/client');
      }
      try {
        require('@fal-ai/client').fal.config({ credentials: falKey });
      } catch (_) {}

      const submit = await require('@fal-ai/client').fal.queue.submit(providerModel, {
        input: {
          prompt,
          resolution: falResolution,
          aspect_ratio: falAspect,
          duration: falSeconds
        }
      });
      const requestId = submit?.request_id || submit?.requestId;
      await client.query('UPDATE sora_video_sessions SET task_id = $1, provider_status = $2 WHERE id = $3', [requestId, 'queued', sessionId]);
      if (!clientKey) { try { await client.query('UPDATE sora_video_sessions SET client_key = COALESCE(client_key, $1) WHERE id = $2', [requestId, sessionId]); } catch(_) {} }
      await client.query('COMMIT');

      ;(async () => {
        try {
          const mapFal = (s) => {
            const v = String(s || '').toUpperCase();
            if (v === 'IN_PROGRESS') return 'in_progress';
            if (v === 'DONE' || v === 'COMPLETED') return 'completed';
            if (v === 'ERROR' || v === 'FAILED') return 'failed';
            return 'queued';
          };
          let lastStatus = 'queued';
          const startTs = Date.now();
          while (true) {
            const st = await require('@fal-ai/client').fal.queue.status(providerModel, { requestId, logs: true });
            const norm = mapFal(st?.status);
            if (norm !== lastStatus) {
              lastStatus = norm;
              try { await db.query('UPDATE sora_video_sessions SET provider_status = $1 WHERE id = $2', [norm, sessionId]); } catch (_) {}
            }
            if (norm === 'completed') break;
            if (norm === 'failed') throw new Error('FAL job failed');
            if (Date.now() - startTs > SORA_TIMEOUT_MS) throw new Error('timeout');
            await new Promise(r => setTimeout(r, 5000));
          }
          const result = await require('@fal-ai/client').fal.queue.result(providerModel, { requestId });
          const url = result?.data?.video?.url;
          if (!url) throw new Error('FAL: no video url in result');
          const filename = `sora_${sessionId}_${Date.now()}.mp4`;
          const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'sora-2', timeoutMs: 600000 });
          const b2 = streamed.url;
          await db.query(
            `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
             VALUES ($1,$2,$3,$4,$5)`,
            [sessionId, url, filename, b2, 'b2']
          );
          await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', sessionId]);
          try { await captureReservation(reservation.reservationId, { description: 'Sora 2' }); } catch (_) {}
        } catch (e) {
          const isTimeout = /timeout/i.test(e?.message || '');
          await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2 WHERE id=$3', ['failed', isTimeout ? 'timeout' : 'failed', sessionId]).catch(()=>{});
        }
      })();

      {
        const bal = await getCredits(req.user.userId);
        return res.json({ success: true, sessionId, taskId: requestId, clientKey: clientKey || requestId || null, provider_status: 'queued', message: 'Sora 2 generation started', prompt, credits_left: bal?.credits });
      }
    } catch (e) {
      await client.query('ROLLBACK');
      try { await releaseReservation(reservation.reservationId); } catch(_) {}
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Sora 2 generate error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Video generation failed' : (error?.message || String(error)) });
  }
});

// History (Sora-only)
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await db.query(
      `SELECT 
        s.id AS session_id,
        s.prompt,
        s.model,
        s.aspect_ratio,
        s.status,
        s.provider_status,
        s.credit_cost,
        s.per_second_usd,
        s.session_usd,
        s.created_at,
        s.completed_at,
        s.task_id,
        s.resolution,
        s.video_duration,
        v.b2_url,
        v.original_url,
        v.b2_filename,
        v.file_size
      FROM sora_video_sessions s
      LEFT JOIN sora_videos v ON v.session_id = s.id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2 OFFSET $3`,
      [req.user.userId, limit, offset]
    );
    const { rows: countRows } = await db.query('SELECT COUNT(*) AS total FROM sora_video_sessions WHERE user_id = $1', [req.user.userId]);
    res.json({
      items: rows,
      pagination: {
        total: parseInt(countRows[0].total),
        limit,
        offset,
        hasMore: offset + limit < parseInt(countRows[0].total)
      }
    });
  } catch (e) {
    console.error('Sora 2 history error:', e);
    res.status(500).json({ error: 'Failed to fetch Sora history' });
  }
});

// Price endpoint: returns credits for given params
router.post('/price', async (req, res) => {
  try {
    const { model = 'sora-2', resolution = '720p', duration = 5 } = req.body || {};
    const secs = Math.max(1, Number(duration) || 5);
    const { getSoraPricePerSecond } = require('../utils/videoPricing');
    const row = await getSoraPricePerSecond(model, resolution);
    if (!row) return res.status(404).json({ error: 'No pricing found' });
    const credits = Math.ceil(Number(row.credits_per_second || 0) * secs);
    return res.json({ credits, exact: true, per_second_usd: Number(row.price_per_second || 0) });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to compute price' });
  }
});

// Manual recovery: poll a specific stuck session and finalize if completed
router.post('/recover', auth, async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    const { rows } = await db.query('SELECT id, task_id, model, provider_status, status FROM sora_video_sessions WHERE id = $1 AND user_id = $2', [session_id, req.user.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const s = rows[0];
    if (!s.task_id) return res.status(400).json({ error: 'No task_id to recover' });
    const provider = resolveProvider();

    if (provider === 'openai') {
      const st = await soraGetTask(s.task_id);
      if (st.status === 'completed') {
        const contentUrl = `${SORA_API_BASE}/videos/${encodeURIComponent(s.task_id)}/content`;
        const filename = `sora_${session_id}_${Date.now()}.mp4`;
        const streamed = await streamUrlToB2({ url: contentUrl, filename, contentType: 'video/mp4', tool: 'sora-2', timeoutMs: 600000, headers: { 'Authorization': `Bearer ${SORA_API_KEY}` } });
        const b2 = streamed.url;
        await db.query(
          `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [session_id, contentUrl, filename, b2, 'b2']
        );
        await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', session_id]);
        return res.json({ success: true, status: 'completed' });
      }
      await db.query('UPDATE sora_video_sessions SET provider_status = $1 WHERE id = $2', [st.provider_status || st.status, session_id]).catch(()=>{});
      return res.json({ success: true, status: st.status || 'processing' });
    }

    if (provider === 'fal') {
      const providerModel = resolveProviderModel('fal', s.model);
      let fal;
      try { fal = require('@fal-ai/client').fal; fal.config({ credentials: process.env.FAL_KEY }); } catch {}
      const mapFal = (v) => {
        const x = String(v || '').toUpperCase();
        if (x === 'IN_PROGRESS') return 'in_progress';
        if (x === 'DONE' || x === 'COMPLETED') return 'completed';
        if (x === 'ERROR' || x === 'FAILED') return 'failed';
        return 'queued';
      };
      const st = await fal.queue.status(providerModel, { requestId: s.task_id, logs: true });
      const norm = mapFal(st?.status);
      if (norm === 'completed') {
        const result = await fal.queue.result(providerModel, { requestId: s.task_id });
      const url = result?.data?.video?.url;
      if (!url) return res.json({ success: false, error: 'No video url yet' });
      const filename = `sora_${session_id}_${Date.now()}.mp4`;
      const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'sora-2', timeoutMs: 600000 });
      const b2 = streamed.url;
        await db.query(
          `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [session_id, url, filename, b2, 'b2']
        );
        await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', session_id]);
        return res.json({ success: true, status: 'completed' });
      }
      await db.query('UPDATE sora_video_sessions SET provider_status = $1 WHERE id = $2', [norm, session_id]).catch(()=>{});
      return res.json({ success: true, status: norm });
    }

    // Wavespeed
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    const resultUrl = `https://api.wavespeed.ai/api/v3/predictions/${encodeURIComponent(s.task_id)}/result`;
    const mapWs = (v) => {
      const x = String(v || '').toLowerCase();
      if (x === 'created') return 'queued';
      if (x === 'processing' || x === 'in_progress') return 'in_progress';
      if (x === 'completed' || x === 'done' || x === 'success') return 'completed';
      if (x === 'failed' || x === 'error') return 'failed';
      return 'queued';
    };
    const stResp = await axios.get(resultUrl, { headers: { 'Authorization': `Bearer ${WAVESPEED_API_KEY}` }, timeout: 60000 });
    const st = stResp?.data || {};
    const norm = mapWs(st?.data?.status || st?.status || st?.data?.state);
    if (norm === 'completed' || (Array.isArray(st?.data?.outputs) && st.data.outputs.length > 0)) {
      const url = Array.isArray(st?.data?.outputs) ? st.data.outputs[0] : null;
      if (!url) return res.json({ success: false, error: 'No video url yet' });
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 600000 });
      const filename = `sora_${session_id}_${Date.now()}.mp4`;
      const b2 = await uploadSoraVideo(resp.data, filename);
      await db.query(
        `INSERT INTO sora_videos (session_id, original_url, b2_filename, b2_url, storage_provider)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [session_id, url, filename, b2, 'b2']
      );
      await db.query('UPDATE sora_video_sessions SET status=$1, provider_status=$2, completed_at=NOW() WHERE id=$3', ['completed', 'completed', session_id]);
      return res.json({ success: true, status: 'completed' });
    }
    await db.query('UPDATE sora_video_sessions SET provider_status = $1 WHERE id = $2', [norm, session_id]).catch(()=>{});
    return res.json({ success: true, status: norm });
  } catch (e) {
    console.error('Sora 2 recover error:', e);
    return res.status(500).json({ error: e?.message || 'Recover failed' });
  }
});

module.exports = router;


