const db = require('../../db');
const axios = require('axios');
const { child: makeLogger } = require('../../utils/logger');
const { shouldMock } = require('../../utils/featureFlags');
const { streamUrlToB2 } = require('../../utils/storage');
const { captureReservation, releaseReservation } = require('../../utils/credits');
const { getBooleanSetting } = require('../../utils/appSettings');
const { JobProcessingError } = require('../jobError');
const { logProviderUsage } = require('../../utils/providerUsage');

const log = makeLogger('genWorker');

function coercePositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  return fallback;
}

async function processSeedream4(job) {
  const jobStartMs = Date.now(); // Track job duration for estimate accuracy
  const jobData = job.data || {};
  const { userId, clientKey, params, mock: mockFromJob, outboxId, reservationId: reservationIdFromJob } = jobData;
  if (!userId) throw new Error('job.payload.userId_missing');
  if (!params || typeof params !== 'object') throw new Error('job.payload.params_missing');
  let { sessionId, reservationId } = jobData;
  const payloadVersion = coercePositiveInt(jobData.payloadVersion || 1);
  const requestedFromMeta = coercePositiveInt(jobData.meta?.requestedOutputs, 0);
  const requested = coercePositiveInt(params.outputs || requestedFromMeta || jobData.requestedOutputs || 1);
  const resolutionFromMeta = jobData.meta?.resolution;
  if (!params.size && resolutionFromMeta) params.size = resolutionFromMeta;
  const jobTypeFromPayload = jobData.jobType || job.name || 'unknown';
  const key = clientKey && String(clientKey).trim().length > 0 ? String(clientKey) : null;

  try {
    log.info({
      event: 'job.payload.summary',
      jobId: job.id,
      jobType: jobTypeFromPayload,
      payloadVersion,
      requested,
      resolution: params.size || params.resolution || null,
      mock: typeof mockFromJob === 'boolean' ? mockFromJob : null
    });
  } catch (_) {}

  try { log.info({ event: 'job.start', name: 'seedream4', jobId: job.id, outboxId, clientKey: key, attemptsMade: job.attemptsMade, reservationId: reservationIdFromJob || reservationId || null }); } catch (_) {}

  // Verify user exists; DLQ if missing
  try {
    const { rows: urows } = await db.query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (!urows || urows.length === 0) {
      try { log.warn({ event: 'user.missing', userId }); } catch (_) {}
      throw new JobProcessingError('DLQ:user_id_not_found', { permanent: true });
    }
  } catch (e) {
    if ((e.message || '').includes('DLQ:user_id_not_found')) throw e;
  }

  // If session/reservation were not created upstream, create them idempotently by client_key
  if (!sessionId || !reservationId) {
    try {
      const modelRaw = String(params?.model || '').toLowerCase();
      const priceKey = modelRaw.includes('seedream-3') ? 'seedream-3' : (modelRaw.includes('seedream-4') ? 'seedream-4' : (params?.model || ''));
      let perImage = 1;
      try {
        const ivp = await db.query(`SELECT final_price_credits FROM image_variant_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`, [priceKey]);
        if (ivp.rows?.length) perImage = Math.max(1, Number(ivp.rows[0].final_price_credits || 1));
        else {
          const mp = await db.query(`SELECT credit_cost_per_unit FROM model_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`, [priceKey]);
          if (mp.rows?.length) perImage = Math.max(1, Number(mp.rows[0].credit_cost_per_unit || 1));
        }
      } catch (_) {}
      const cost = perImage * requested;

      // Idempotent session get-or-create by user_id + client_key
      let existing = null;
      if (key) {
        try {
          const r = await db.query('SELECT id, reservation_id FROM generation_sessions WHERE user_id = $1 AND client_key = $2 LIMIT 1', [userId, key]);
          if (r.rows?.length) existing = r.rows[0];
        } catch (_) {}
      }

      if (existing && existing.id) {
        sessionId = existing.id;
        reservationId = existing.reservation_id || reservationId || null;
        try { log.info({ event: 'session.found', sessionId, reservationId }); } catch (_) {}
      }

      // Reserve if needed
      if (!reservationId) {
        const { reserveCredits } = require('../../utils/credits');
        const ttl = Number(process.env.RESERVATION_TTL_SECONDS || 600);
        const reserve = await reserveCredits(userId, cost, { description: 'Seedream 4.0 (reservation)', ttlSeconds: ttl });
        if (!reserve.success) {
          // If we already have a session, mark failed; else create a failed session to surface in UI
          if (!sessionId) {
            const ins = await db.query(
              `INSERT INTO generation_sessions (user_id, prompt, outputs, model, status, credit_cost, client_key)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [userId, params?.prompt || '', requested, params?.model || 'seedream-4-0-250828', 'failed', cost, key]
            );
            sessionId = ins.rows[0].id;
          } else {
            try { await db.query('UPDATE generation_sessions SET status=$1 WHERE id=$2', ['failed', sessionId]); } catch (_) {}
          }
          // Notify created+failed
          try { await db.query(`NOTIFY session_created, '${JSON.stringify({ user_id: userId, reservation_id: null, session_id: sessionId, event_ts: Date.now() }).replace(/'/g, "''")}'`); } catch (_) {}
          try { await db.query(`NOTIFY session_completed, '${JSON.stringify({ user_id: userId, reservation_id: null, session_id: sessionId, event_ts: Date.now(), status: 'failed' }).replace(/'/g, "''")}'`); } catch (_) {}
          throw new JobProcessingError('DLQ:insufficient_credits', { permanent: true });
        }
        reservationId = reserve.reservationId;
        try { log.info({ event: 'reservation.created', reservationId, cost }); } catch (_) {}
        // Best-effort: backfill reservation_id into outbox row for traceability
        if (outboxId) {
          try { await db.query('UPDATE outbox SET reservation_id = $1 WHERE id = $2 AND reservation_id IS NULL', [reservationId, outboxId]); } catch (_) {}
        }
      }

      // Create session if needed
      if (!sessionId) {
        const inputSettings = {
          prompt: params?.prompt,
          model: params?.model,
          outputs: requested,
          aspect_ratio: params?.aspect_ratio || null,
          aspect_ratio_mode: params?.aspect_ratio_mode || null,
          size: params?.size || '1024x1024',
          guidance_scale: params?.guidance_scale || 3,
          negative_prompt: params?.negative_prompt || null,
          seed: params?.seed ?? null,
          watermark: Boolean(params?.watermark),
          ref_image_url: params?.ref_image_url || null,
          ref_image_urls: Array.isArray(params?.ref_image_urls) ? params.ref_image_urls.slice(0, 10) : []
        };
        const ins = await db.query(
          `INSERT INTO generation_sessions (user_id, prompt, outputs, aspect_ratio, model, status, resolution, guidance_scale, credit_cost, reservation_id, ref_image_url, ref_image_urls, input_settings, client_key, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
           RETURNING id`,
          [
            userId,
            params?.prompt || '',
            requested,
            params?.aspect_ratio || null,
            params?.model || 'seedream-4-0-250828',
            'processing',
            params?.size || '1024x1024',
            params?.guidance_scale || 3,
            perImage * requested,
            reservationId,
            params?.ref_image_url || null,
            Array.isArray(params?.ref_image_urls) && params.ref_image_urls.length > 0 ? JSON.stringify(params.ref_image_urls.slice(0, 10)) : null,
            JSON.stringify(inputSettings),
            key
          ]
        );
        sessionId = ins.rows[0].id;
        try { log.info({ event: 'session.created', sessionId }); } catch (_) {}
      }

      // Notify session_created so UI can show a card
      try { await db.query(`NOTIFY session_created, '${JSON.stringify({ user_id: userId, reservation_id: reservationId, session_id: sessionId, event_ts: Date.now() }).replace(/'/g, "''")}'`); } catch (_) {}
    } catch (preErr) {
      log.error({ event: 'precreate.error', name: 'seedream4', msg: preErr?.message || String(preErr) });
      throw preErr;
    }
  }

  const mock = (typeof mockFromJob === 'boolean') ? mockFromJob : await shouldMock('seedream4');
  if (!mock) {
    try {
      const SEEDREAM4_API_KEY = process.env.SEEDREAM4_API_KEY || process.env.BYTEPLUS_ARK_API_KEY;
      const SEEDREAM4_API_BASE = process.env.SEEDREAM4_API_BASE || 'https://ark.ap-southeast.bytepluses.com';
      const promptText = String(params?.prompt || '').trim();
      const model = params?.model || 'seedream-4-0-250828';
      const negative_prompt = params?.negative_prompt || undefined;
      const size = params?.size || '1024x1024';
      const seed = params?.seed;
      const watermark = Boolean(params?.watermark);
      let referenceImages = [];
      if (Array.isArray(params?.ref_image_urls) && params.ref_image_urls.length > 0) referenceImages = params.ref_image_urls.slice(0, 10);
      else if (params?.ref_image_url) referenceImages = [params.ref_image_url];

      // Convert local MinIO URLs to base64 for ByteDance API (external API can't access localhost)
      const processedRefImages = [];
      for (const refUrl of referenceImages) {
        if (/^http:\/\/(localhost|127\.0\.0\.1|minio):9000\//i.test(refUrl)) {
          try {
            // Convert localhost to minio for Docker internal access
            const internalUrl = refUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1):9000\//i, 'http://minio:9000/');
            const response = await axios.get(internalUrl, { responseType: 'arraybuffer', timeout: 30000 });
            const base64 = Buffer.from(response.data).toString('base64');
            const contentType = response.headers['content-type'] || 'image/png';
            processedRefImages.push(`data:${contentType};base64,${base64}`);
            try { log.info({ event: 'ref_image.converted_to_base64', originalUrl: refUrl, bytes: response.data.length }); } catch (_) {}
          } catch (e) {
            try { log.error({ event: 'ref_image.conversion_failed', url: refUrl, error: e?.message }); } catch (_) {}
            // Skip this reference image if conversion fails
          }
        } else {
          // External URL - pass through directly
          processedRefImages.push(refUrl);
        }
      }

      const baseBody = {
        model,
        prompt: promptText,
        ...(processedRefImages.length ? { image: processedRefImages } : {}),
        ...(negative_prompt ? { negative_prompt } : {}),
        response_format: 'url',
        size,
        stream: false,
        sequential_image_generation: 'disabled',
        watermark,
        ...(typeof seed === 'number' ? { seed } : (seed ? { seed: Number(seed) } : {}))
      };

      const maxBatch = Math.max(1, Number(process.env.SEEDREAM4_PROVIDER_BATCH || 1));
      const batches = [];
      for (let done = 0; done < requested; done += maxBatch) {
        batches.push(Math.min(maxBatch, requested - done));
      }

      const urls = [];
      let totalApiMs = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const count = batches[batchIndex];
        const apiStartMs = Date.now();
        try { log.info({ event: 'provider.request.start', batch: batchIndex + 1, count, sessionId }); } catch (_) {}
        const resp = await axios.post(
          `${SEEDREAM4_API_BASE}/api/v3/images/generations`,
          { ...baseBody, n: count },
          { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SEEDREAM4_API_KEY}` }, timeout: 60000 }
        );
        const apiDurationMs = Date.now() - apiStartMs;
        totalApiMs += apiDurationMs;
        try { log.info({ event: 'provider.request.done', batch: batchIndex + 1, count, sessionId, apiDurationMs }); } catch (_) {}
        const dat = resp.data;
        // Log provider usage to database
        try {
          await logProviderUsage({
            userId,
            sessionId,
            provider: 'byteplus',
            model,
            endpoint: `${SEEDREAM4_API_BASE}/api/v3/images/generations`,
            raw: dat,
            timing: {
              apiDurationMs,
              batch: batchIndex + 1,
              imagesRequested: count,
              imagesGenerated: dat?.data?.length || 1
            }
          });
        } catch (_) {}
        let batchUrls = [];
        if (dat?.data) batchUrls = dat.data.map(i => i.url).filter(Boolean);
        else if (dat?.url) batchUrls = [dat.url];
        if (batchUrls.length !== count) {
          try { log.warn({ event: 'provider.batch.mismatch', expected: count, received: batchUrls.length, batch: batchIndex + 1 }); } catch (_) {}
        }
        urls.push(...batchUrls);
      }

      const storedImages = [];
      let totalTransferMs = 0;
      const transferStartMs = Date.now();
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const imgStartMs = Date.now();
        try {
          const fname = `seedream4_${sessionId}_${Date.now()}_${i}.png`;
          const streamed = await streamUrlToB2({ url, filename: fname, contentType: 'image/png', tool: 'byteplus-seedream-4', timeoutMs: 60000, maxBytes: Math.max(1, Number(process.env.MAX_IMAGE_DOWNLOAD_BYTES || 20 * 1024 * 1024)) });
          const imgDurationMs = Date.now() - imgStartMs;
          try { log.info({ event: 'image.transfer.done', sessionId, index: i, imgDurationMs, bytes: streamed.bytes }); } catch (_) {}
          storedImages.push({ original_url: url, b2_filename: fname, b2_url: streamed.url, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', file_size: streamed.bytes || null, generation_tool: 'byteplus-seedream-4' });
        } catch (e) {
          const imgDurationMs = Date.now() - imgStartMs;
          try { log.warn({ event: 'image.transfer.fallback', sessionId, index: i, imgDurationMs, error: e?.message }); } catch (_) {}
          storedImages.push({ original_url: url, b2_filename: `seedream4_${sessionId}_${Date.now()}_${i}.png`, b2_url: url, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', file_size: null, generation_tool: 'byteplus-seedream-4' });
        }
      }
      totalTransferMs = Date.now() - transferStartMs;

      if (storedImages.length) {
        await Promise.all(storedImages.map(img => db.query(
          `INSERT INTO images (session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, width, height, client_key, created_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,NOW(),NOW())`,
          [sessionId, img.original_url, img.b2_filename, img.b2_url, img.b2_folder, img.file_size, 'b2', img.generation_tool]
        )));
      }

      const durationMs = Date.now() - jobStartMs;
      const dbStartMs = Date.now();

      // Calculate timing breakdown for performance analysis
      const timingBreakdown = {
        totalMs: durationMs,
        providerApiMs: totalApiMs,
        imageTransferMs: totalTransferMs,
        dbOpsMs: 0,  // Will be updated after DB call
        overheadMs: durationMs - totalApiMs - totalTransferMs
      };

      await db.query(
        'UPDATE generation_sessions SET status=$1, completed_at=NOW(), duration_ms=$2, timing_breakdown=$3 WHERE id=$4',
        ['completed', durationMs, JSON.stringify(timingBreakdown), sessionId]
      );

      try { await captureReservation(reservationId, { description: 'Seedream 4.0' }); } catch (_) {}
      try { await db.query(`NOTIFY session_completed, '${JSON.stringify({ user_id: userId, reservation_id: reservationId, session_id: sessionId, event_ts: Date.now() }).replace(/'/g, "''")}'`); } catch (_) {}

      const dbDurationMs = Date.now() - dbStartMs;
      timingBreakdown.dbOpsMs = dbDurationMs;
      timingBreakdown.overheadMs = durationMs - totalApiMs - totalTransferMs - dbDurationMs;

      log.info({
        event: 'completed.real',
        sessionId,
        count: storedImages.length,
        durationMs,
        timing: timingBreakdown
      });
    } catch (e) {
      const providerMsg = e.response?.data?.error?.message || e.response?.data?.message;
      try {
        await db.query(
          'UPDATE generation_sessions SET status=$1, error_details=$2 WHERE id=$3',
          ['failed', providerMsg ? JSON.stringify({ message: providerMsg }) : null, sessionId]
        );
      } catch (_) {}
      try { await releaseReservation(reservationId); } catch (_) {}
      try { await db.query(`NOTIFY session_completed, '${JSON.stringify({ user_id: userId, reservation_id: reservationId, session_id: sessionId, event_ts: Date.now(), status: 'failed' }).replace(/'/g, "''")}'`); } catch (_) {}
      log.error({ event: 'job.error', name: 'seedream4', msg: e?.message || String(e), response: e?.response?.data });

      // If 400 Bad Request (e.g. safety violation), fail permanently to avoid infinite retries
      if (e.response && e.response.status === 400) {
        const finalMsg = providerMsg || 'Provider rejected request (400)';
        throw new JobProcessingError(finalMsg, { permanent: true });
      }
      throw e;
    }
    return;
  }

  // Mock path
  const urls = Array.from({ length: requested }).map((_, idx) => `https://picsum.photos/1024/1024?random=${Date.now()}-${idx}`);
  const uploadMock = await getBooleanSetting('upload_mock_outputs_to_b2', false);
  if (uploadMock) {
    const MAX_BYTES = Math.max(1, Number(process.env.MAX_IMAGE_DOWNLOAD_BYTES || 20 * 1024 * 1024));
    const results = await Promise.all(urls.map(async (_url, idx) => {
      const fname = `seedream4_mock_${sessionId}_${Date.now()}_${idx}.png`;
      try {
        const streamed = await streamUrlToB2({ url: _url, filename: fname, contentType: 'image/png', tool: 'byteplus-seedream-4', timeoutMs: 30000, maxBytes: MAX_BYTES });
        return { original_url: _url, b2_url: streamed.url, b2_filename: fname, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', file_size: streamed.bytes || null, storage_provider: 'b2' };
      } catch (_) {
        return { original_url: _url, b2_url: _url, b2_filename: fname, b2_folder: process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', file_size: null, storage_provider: 'mock' };
      }
    }));
    await Promise.all(results.map((img, idx) => db.query(
      `INSERT INTO images (
        session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, width, height, client_key, created_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,NOW(),NOW())`,
      [sessionId, img.original_url, img.b2_filename, img.b2_url, img.b2_folder, img.file_size, img.storage_provider, 'byteplus-seedream-4']
    )));
  } else {
    await Promise.all(urls.map((url) => db.query(
      `INSERT INTO images (
        session_id, url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool, width, height, client_key, created_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,NOW(),NOW())`,
      [sessionId, url, `seedream4_mock_${sessionId}_${Date.now()}.png`, url, process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4', null, 'mock', 'byteplus-seedream-4']
    )));
  }
  const durationMsMock = Date.now() - jobStartMs;

  // Mock timing breakdown (no real API calls)
  const mockTimingBreakdown = {
    totalMs: durationMsMock,
    providerApiMs: 0,  // Mock mode skips real API
    imageTransferMs: durationMsMock - 50,  // Most time is mock image download
    dbOpsMs: 50,
    overheadMs: 0
  };

  await db.query(
    'UPDATE generation_sessions SET status=$1, completed_at=NOW(), duration_ms=$2, timing_breakdown=$3 WHERE id=$4',
    ['completed', durationMsMock, JSON.stringify(mockTimingBreakdown), sessionId]
  );

  try { await captureReservation(reservationId, { description: 'Seedream 4.0' }); } catch (_) {}
  try { await db.query(`NOTIFY session_completed, '${JSON.stringify({ user_id: userId, reservation_id: reservationId, session_id: sessionId, event_ts: Date.now() }).replace(/'/g, "''")}'`); } catch (_) {}
  log.info({ event: 'completed.mock', sessionId, count: requested, durationMs: durationMsMock, timing: mockTimingBreakdown });
}

module.exports = {
  handler: processSeedream4,
  processSeedream4,
  jobNames: ['gen.seedream4', 'seedream4'],
};


