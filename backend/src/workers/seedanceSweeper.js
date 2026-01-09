const db = require('../db');
const axios = require('axios');
const { uploadSeedanceVideo, streamUrlToB2 } = require('../utils/storage');
const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('seedanceSweeper');
const { releaseReservation, captureReservation } = require('../utils/credits');
const { getSeedanceTask } = require('../api/seedance');

function ms(n) { return Math.max(0, Number(n) || 0); }

async function processBatch({ noTaskTtlMs, withTaskMaxMs, batchSize }) {
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, task_id, created_at, status, reservation_id 
       FROM video_generation_sessions 
       WHERE status = 'processing' 
       ORDER BY created_at ASC 
       FOR UPDATE SKIP LOCKED 
       LIMIT ${Math.max(1, Number(batchSize) || 25)}`
    );
    await client.query('COMMIT');

    // Contract Item A2.4: Parallel status checking instead of sequential
    // Poll all provider statuses in parallel first
    const statusPromises = rows.map(row => {
      if (!row.task_id) return Promise.resolve({ row, provider: null });
      return getSeedanceTask(row.task_id)
        .then(provider => ({ row, provider }))
        .catch(() => ({ row, provider: null }));
    });

    const statusResults = await Promise.all(statusPromises);

    // Process results sequentially to avoid DB race conditions
    for (const { row, provider } of statusResults) {
      try {
        const ageMs = Date.now() - new Date(row.created_at).getTime();

        if (!row.task_id) {
          if (ageMs > noTaskTtlMs) {
            await db.query('UPDATE video_generation_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
            if (row.reservation_id) {
              try { await releaseReservation(row.reservation_id); } catch(_) {}
            }
          }
          continue;
        }

        if (ageMs > withTaskMaxMs) {
          await db.query('UPDATE video_generation_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
          if (row.reservation_id) {
            try { await releaseReservation(row.reservation_id); } catch(_) {}
          }
          continue;
        }

        const pStatus = String(provider?.provider_status || provider?.status || '').toLowerCase();

        if (['succeeded','success','completed','done'].includes(pStatus)) {
          // Insert video if missing, then mark completed
          const existing = await db.query('SELECT 1 FROM videos WHERE session_id = $1 LIMIT 1', [row.id]);
          if (existing.rowCount === 0) {
            const urls = provider?.video_urls || provider?.urls || [];
            const url = Array.isArray(urls) ? urls[0] : urls;
            if (typeof url === 'string' && url.startsWith('http')) {
              const filename = `seed_${row.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
              const streamed = await streamUrlToB2({ url, filename, contentType: 'video/mp4', tool: 'seedance-1-0', timeoutMs: 60000 });
              const b2 = streamed.url;
              await db.query(
                `INSERT INTO videos (session_id, original_url, b2_filename, b2_url, b2_folder, file_size, storage_provider, generation_tool)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [row.id, url, filename, b2, process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0', streamed.size || 0, 'b2', 'seedance-1-0']
              );
            }
          }
          await db.query('UPDATE video_generation_sessions SET status=$1, storage_status=$2, completed_at=NOW() WHERE id=$3', ['completed','completed',row.id]);
          if (row.reservation_id) {
            try { await captureReservation(row.reservation_id, { description: 'Seedance' }); } catch(_) {}
          }
          continue;
        }

        if (['failed','error'].includes(pStatus)) {
          await db.query('UPDATE video_generation_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
          if (row.reservation_id) {
            try { await releaseReservation(row.reservation_id); } catch(_) {}
          }
        }
      } catch (e) {
        // Do not throw; continue other rows
        log.warn({ event: 'seedance.sweep.row_error', session_id: row.id, msg: e.message });
      }
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch(_) {}
  } finally {
    try { client && client.release(); } catch(_) {}
  }
}

function startSeedanceSweeper(options = {}) {
  const intervalMs = ms(options.intervalMs) || 120000; // 2 min
  const noTaskTtlMs = ms(process.env.SEEDANCE_NOTASK_TTL_MS) || 30 * 60 * 1000; // 30m
  const withTaskMaxMs = ms(process.env.SEEDANCE_TASK_MAX_MS) || 2 * 60 * 60 * 1000; // 2h
  const batchSize = Number(process.env.SEEDANCE_SWEEP_BATCH || 25);

  const tick = async () => {
    const t0 = Date.now();
    await processBatch({ noTaskTtlMs, withTaskMaxMs, batchSize });
    try { log.info({ event: 'tick.done', elapsedMs: Date.now() - t0, batchSize }); } catch {}
  };
  const id = setInterval(tick, intervalMs);
  // Run once shortly after start
  setTimeout(tick, Math.min(5000, intervalMs));
  return () => clearInterval(id);
}

module.exports = { startSeedanceSweeper };


