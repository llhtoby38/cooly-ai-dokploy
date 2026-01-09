const express = require('express');
const axios = require('axios');
const db = require('../db');
const auth = require('../middleware/auth');
const { reserveCredits, captureReservation, releaseReservation, getCredits } = require('../utils/credits');
const { uploadToB2, streamUrlToB2 } = require('../utils/storage');
const VeoGoogleProvider = require('../providers/veoGoogle');
const { getReqLogger } = require('../utils/logger');

const router = express.Router();

const { shouldMock } = require('../utils/featureFlags');
let MOCK_MODE = false;

async function computeCredits(model, resolution, aspectRatio, duration) {
  try {
    const { computeVideoCredits } = require('../utils/videoPricing');
    return await computeVideoCredits(model, resolution, aspectRatio, duration);
  } catch {
    return null;
  }
}

// Price endpoint
router.post('/price', async (req, res) => {
  try {
    const { model = 'veo-3-1-quality', resolution = '1080p', aspectRatio = '16:9', duration = 10 } = req.body || {};
    const credits = await computeCredits(model, resolution, aspectRatio, Number(duration));
    return res.json({ success: true, credits, exact: credits != null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to compute price' });
  }
});

// Helper: upload using tool-specific folder name
async function uploadVeo31Video(buffer, filename) {
  return uploadToB2(buffer, filename, 'video/mp4', 'google-veo31');
}

// Generate endpoint (mock-supported)
router.post('/generate', auth, async (req, res) => {
  const { prompt, model = 'veo-3-1-quality', aspectRatio = '16:9', resolution = '1080p', duration = 8, imageUrl = null, startFrameUrl = null, endFrameUrl = null, clientKey = null } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });

  // Enforce whitelists
  const allowedDurations = new Set([4,6,8]);
  const allowedResolutions = new Set(['720p','1080p']);
  const allowedAspectRatios = new Set(['16:9','9:16']);
  const dur = Number(duration);
  if (!allowedDurations.has(dur)) return res.status(400).json({ error: 'Unsupported duration. Allowed: 4, 6, 8' });
  if (!allowedResolutions.has(String(resolution))) return res.status(400).json({ error: 'Unsupported resolution. Allowed: 720p, 1080p' });
  if (!allowedAspectRatios.has(String(aspectRatio))) return res.status(400).json({ error: 'Unsupported aspect ratio. Allowed: 16:9, 9:16' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const cost = await computeCredits(model, resolution, aspectRatio, Number(duration));

    // Always reserve credits up-front (align with Seedance), even in mock mode
    const reservation = await reserveCredits(
      req.user.userId,
      Number(cost) || 0,
      { description: `${model} (reservation)`, ttlSeconds: Number(process.env.RESERVATION_TTL_SECONDS || 600) }
    );
    if (!reservation.success) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: reservation.error || 'Credit reservation failed', creditsLeft: reservation.creditsLeft });
    }

    const { rows: sRows } = await client.query(
      'INSERT INTO veo31_video_sessions (user_id, prompt, model, aspect_ratio, resolution, video_duration, status, credit_cost, reservation_id, client_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [req.user.userId, prompt, model, aspectRatio, resolution, Number(duration), 'processing', Number(cost) || null, reservation.reservationId, clientKey || null]
    );
    const sessionId = sRows[0].id;

    try { MOCK_MODE = await shouldMock('veo31'); } catch { MOCK_MODE = false; }
    if (MOCK_MODE) {
      await client.query('COMMIT');
      const bal = await getCredits(req.user.userId);
      res.json({ success: true, sessionId, status: 'processing', message: 'Veo 3.1 (mock) started', credits_left: bal?.credits });

      // Background simulate completion
      (async () => {
        try {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const minMs = Number(process.env.VEO31_MOCK_MIN_MS || 3000);
          const maxMs = Number(process.env.VEO31_MOCK_MAX_MS || 7000);
          const totalMs = minMs + Math.floor(Math.random() * Math.max(0, (maxMs - minMs) + 1));
          await sleep(totalMs);

          // Use a shorter CORS-friendly sample video
          const mockUrl = `https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4`;
          const ts = Date.now();
          const rand = Math.random().toString(36).slice(2);
          const filename = `veo31_${sessionId}_${ts}_${rand}.mp4`;
          const rlog = getReqLogger(null, 'veo31');
          try { rlog.info({ event: 'mock.video.stream.start', url: mockUrl, filename }); } catch {}
          const streamed = await streamUrlToB2({ url: mockUrl, filename, contentType: 'video/mp4', tool: 'google-veo31', timeoutMs: 60000 });
          try { rlog.info({ event: 'mock.video.stream.done', filename, b2Url: streamed.url }); } catch {}
          const permanentUrl = streamed.url;

          await db.query(
            'INSERT INTO veo31_videos (session_id, original_url, b2_filename, b2_url, storage_provider, file_size) VALUES ($1,$2,$3,$4,$5,$6)',
            [sessionId, mockUrl, filename, permanentUrl, 'b2', streamed.bytes || null]
          );
          await db.query('UPDATE veo31_video_sessions SET status = $1, provider_status = $2, completed_at = NOW() WHERE id = $3', ['completed', 'succeeded', sessionId]);
          if (reservation.reservationId) { try { await captureReservation(reservation.reservationId, { sessionId }); } catch {} }
        } catch (e) {
          const rlog = getReqLogger(null, 'veo31');
          try { rlog.error({ event: 'mock.video.error', sessionId, error: e.message, stack: e.stack }); } catch {}
          try {
            await db.query('UPDATE veo31_video_sessions SET status = $1, provider_status = $2 WHERE id = $3', ['failed', 'failed', sessionId]);
            if (reservation.reservationId) { try { await releaseReservation(reservation.reservationId); } catch {} }
          } catch {}
        }
      })();
      return;
    }

    // Real provider submission
    const provider = new VeoGoogleProvider();
    try { getReqLogger(req, 'veo31').info({ event: 'provider.submit', model, aspectRatio, resolution, duration }); } catch {}
    const createStart = Date.now();
    const submission = await provider.createVideo({
      prompt,
      model,
      aspectRatio,
      resolution,
      duration,
      imageUrl,
      startFrameUrl,
      endFrameUrl,
      resizeMode: 'pad',
      sampleCount: 1,
      generateAudio: true
    });
    const createMs = Date.now() - createStart;

    const opName = submission.operation_name || submission.task_id;
    try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId, taskId: opName, provider: 'google', model, endpoint: 'veo31/create', raw: submission, timing: { apiMs: createMs } }); } catch(_) {}
    await client.query('UPDATE veo31_video_sessions SET task_id = $1 WHERE id = $2', [opName, sessionId]);
    await client.query('COMMIT');
    const bal2 = await getCredits(req.user.userId);
    res.json({ success: true, sessionId, status: 'processing', taskId: opName, credits_left: bal2?.credits });

    // Background poll until completion, then finalize
    ;(async () => {
      const bgStartMs = Date.now();
      let apiMs = createMs, transferMs = 0, dbMs = 0;
      try {
        const pollIntervalMs = Number(process.env.VEO31_POLL_MS || 5000);
        const maxWaitMs = Number(process.env.VEO31_MAX_WAIT_MS || 15 * 60 * 1000);
        const startTs = Date.now();
        while (Date.now() - startTs < maxWaitMs) {
          const pollStart = Date.now();
          const st = await provider.getTask(opName);
          apiMs += (Date.now() - pollStart);
          try { getReqLogger(null, 'veo31').debug({ event: 'provider.status', task: opName, status: st?.status || st?.provider_status || null }); } catch {}
          if (st.status === 'completed') {
            try { const { logProviderUsage } = require('../utils/providerUsage'); await logProviderUsage({ userId: req.user.userId, sessionId, taskId: opName, provider: 'google', model, endpoint: 'veo31/status', raw: st, timing: { apiMs: Date.now() - pollStart } }); } catch(_) {}
            let savedOne = false;
            if (Array.isArray(st.results)) {
              for (const r of st.results) {
                try {
                  let b2Url = null; let filename = `veo31_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
                  const uploadStart = Date.now();
                  if (r.type === 'buffer' && r.buffer) {
                    b2Url = await uploadToB2(r.buffer, filename, r.mime || 'video/mp4', 'google-veo31');
                    transferMs += (Date.now() - uploadStart);
                  } else if (r.type === 'gcs' && r.gcsUri) {
                    // Try to fetch bytes from GCS and upload to B2 so the UI can play it
                    try {
                      const provider2 = new VeoGoogleProvider();
                      const { buffer, mime } = await provider2.fetchGcsBytes(r.gcsUri);
                      b2Url = await uploadToB2(buffer, filename, mime || 'video/mp4', 'google-veo31');
                      transferMs += (Date.now() - uploadStart);
                    } catch {}
                  }
                  const dbStart = Date.now();
                  await db.query(
                    'INSERT INTO veo31_videos (session_id, original_url, b2_filename, b2_url, storage_provider, file_size) VALUES ($1,$2,$3,$4,$5,$6)',
                    [sessionId, r.gcsUri || null, filename, b2Url, b2Url ? 'b2' : 'gcs', null]
                  );
                  dbMs += (Date.now() - dbStart);
                  savedOne = true;
                } catch {}
              }
            }
            const totalMs = Date.now() - bgStartMs;
            const timingBreakdown = {
              totalMs,
              providerApiMs: apiMs,
              videoTransferMs: transferMs,
              dbOpsMs: dbMs,
              overheadMs: Math.max(0, totalMs - apiMs - transferMs - dbMs)
            };
            await db.query('UPDATE veo31_video_sessions SET status = $1, provider_status = $2, completed_at = NOW(), timing_breakdown = $3 WHERE id = $4', ['completed', 'succeeded', JSON.stringify(timingBreakdown), sessionId]);
            if (reservation.reservationId) { try { await captureReservation(reservation.reservationId, { sessionId }); } catch {} }
            return;
          }
          await new Promise(r => setTimeout(r, pollIntervalMs));
        }
        // timeout
        await db.query('UPDATE veo31_video_sessions SET status = $1, provider_status = $2 WHERE id = $3', ['failed', 'timeout', sessionId]);
        if (reservation.reservationId) { try { await releaseReservation(reservation.reservationId); } catch {} }
      } catch (e) {
        try {
          await db.query('UPDATE veo31_video_sessions SET status = $1, provider_status = $2 WHERE id = $3', ['failed', 'failed', sessionId]);
          if (reservation.reservationId) { try { await releaseReservation(reservation.reservationId); } catch {} }
        } catch {}
      }
    })();
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    return res.status(500).json({ error: 'Generation failed to start' });
  }
});

// Status endpoint (lightweight)
router.get('/status/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, status, provider_status FROM veo31_video_sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ status: rows[0].status, provider_status: rows[0].provider_status || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Recover endpoint (attempt to finalize stuck session)
router.post('/recover', auth, async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const { rows } = await db.query('SELECT id, status FROM veo31_video_sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const s = rows[0];
    if (s.status === 'completed') return res.json({ success: true, status: 'completed' });
    // For now, no-op; in real impl, poll provider and finalize
    return res.json({ success: true, status: s.status });
  } catch (e) {
    res.status(500).json({ error: 'Failed to recover session' });
  }
});

// History endpoint (veo31 only)
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await db.query(
      `SELECT s.id AS session_id, s.prompt, s.model, s.aspect_ratio, s.resolution, s.status, s.provider_status, s.credit_cost, s.created_at, s.completed_at, s.video_duration,
              v.original_url, v.b2_url, v.b2_filename, v.file_size
       FROM veo31_video_sessions s
       LEFT JOIN veo31_videos v ON v.session_id = s.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.userId, limit, offset]
    );
    const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS total FROM veo31_video_sessions WHERE user_id = $1', [req.user.userId]);
    res.json({ items: rows, pagination: { total: countRows[0].total, limit, offset, hasMore: offset + limit < countRows[0].total } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;


