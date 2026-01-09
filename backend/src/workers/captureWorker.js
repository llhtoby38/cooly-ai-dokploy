const db = require('../db');
const { captureReservation, releaseReservation, debitCredits } = require('../utils/credits');
const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('captureWorker');

/**
 * Periodically finalizes credit reservations based on session terminal states.
 * - For completed sessions: capture
 * - For failed sessions: release
 *
 * Runs for both image and video session tables.
 */
function startCaptureWorker(options = {}) {
  const intervalMs = Number(options.intervalMs || process.env.CAPTURE_WORKER_INTERVAL_MS || 10000);
  const batchLimit = Number(options.batchLimit || process.env.CAPTURE_WORKER_BATCH_LIMIT || 25);

  let running = false;
  async function tick() {
    if (running) return; // avoid overlap
    running = true;
    try {
      // Proactively expire overdue reservations to keep table clean
      try {
        await db.query(
          `UPDATE credit_reservations
           SET status='expired', released_at=COALESCE(released_at, NOW())
           WHERE status='reserved' AND expires_at IS NOT NULL AND expires_at < NOW()`
        );
      } catch (_) {}

      // Find image sessions with reserved holds in terminal states
      const img = await db.query(
        `SELECT s.id, s.user_id, s.model, s.status, s.reservation_id,
                r.status AS res_status, r.amount AS res_amount, r.user_id AS res_user_id
         FROM generation_sessions s
         JOIN credit_reservations r ON r.id = s.reservation_id
         WHERE r.status IN ('reserved','expired') AND s.status IN ('completed', 'failed')
         ORDER BY s.created_at ASC
         LIMIT $1`,
        [batchLimit]
      );

      for (const row of img.rows) {
        const resId = row.reservation_id;
        try {
          if (row.status === 'completed') {
            const desc = (String(row.model || '').toLowerCase().includes('seedream-4') ? 'Seedream 4.0' : 'Seedream 3.0');
            if (String(row.res_status || '').toLowerCase() === 'expired') {
              // Fallback debit for expired holds
              if (row.res_user_id && row.res_amount) {
                await debitCredits(row.res_user_id, Number(row.res_amount), { description: desc, reservationId: resId });
                await db.query("UPDATE credit_reservations SET status='captured', captured_at=NOW() WHERE id=$1", [resId]);
              }
            } else {
              const r = await captureReservation(resId, { description: desc });
              if (!r?.success) {
                if ((r?.error || '').toLowerCase().includes('expired')) {
                  if (row.res_user_id && row.res_amount) {
                    await debitCredits(row.res_user_id, Number(row.res_amount), { description: desc, reservationId: resId });
                    await db.query("UPDATE credit_reservations SET status='captured', captured_at=NOW() WHERE id=$1", [resId]);
                  }
                } else {
                  console.warn('[captureWorker] capture (image) failed, will retry:', r?.error);
                }
              }
            }
          } else {
            await releaseReservation(resId).catch(()=>{});
          }
        } catch (e) {
          console.warn('[captureWorker] image finalize error:', e?.message || e);
        }
      }

      // Find video sessions with reserved holds in terminal states
      const vid = await db.query(
        `SELECT s.id, s.user_id, s.model, s.status, s.reservation_id,
                r.status AS res_status, r.amount AS res_amount, r.user_id AS res_user_id
         FROM video_generation_sessions s
         JOIN credit_reservations r ON r.id = s.reservation_id
         WHERE r.status IN ('reserved','expired') AND s.status IN ('completed', 'failed')
         ORDER BY s.created_at ASC
         LIMIT $1`,
        [batchLimit]
      );

      for (const row of vid.rows) {
        const resId = row.reservation_id;
        try {
          if (row.status === 'completed') {
            const lower = String(row.model || '').toLowerCase();
            const label = lower.includes('veo') ? 'Google Veo 3' : (lower.includes('seedance') ? 'Seedance' : 'Video');
            if (String(row.res_status || '').toLowerCase() === 'expired') {
              if (row.res_user_id && row.res_amount) {
                await debitCredits(row.res_user_id, Number(row.res_amount), { description: label, reservationId: resId });
                await db.query("UPDATE credit_reservations SET status='captured', captured_at=NOW() WHERE id=$1", [resId]);
              }
            } else {
              const r = await captureReservation(resId, { description: label });
              if (!r?.success) {
                if ((r?.error || '').toLowerCase().includes('expired')) {
                  if (row.res_user_id && row.res_amount) {
                    await debitCredits(row.res_user_id, Number(row.res_amount), { description: label, reservationId: resId });
                    await db.query("UPDATE credit_reservations SET status='captured', captured_at=NOW() WHERE id=$1", [resId]);
                  }
                } else {
                  console.warn('[captureWorker] capture (video) failed, will retry:', r?.error);
                }
              }
            }
          } else {
            await releaseReservation(resId).catch(()=>{});
          }
        } catch (e) {
          console.warn('[captureWorker] video finalize error:', e?.message || e);
        }
      }
    } catch (e) {
      console.warn('[captureWorker] tick error:', e?.message || e);
    } finally {
      running = false;
    }
  }

  // Start interval (safety watchdog)
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  // Kick off immediately
  tick().catch(()=>{});

  try { log.info({ event: 'start', intervalMs, batchLimit }); } catch {}

  // LISTEN/NOTIFY with auto-reconnect for immediate finalization
  (async function listenLoop() {
    let listenClient;
    let retryAttempts = 0;
    const doLoop = async () => {
      try {
        listenClient = await db.getClient();
        retryAttempts = 0; // Reset
        await listenClient.query('LISTEN session_finalize');
        const handle = async (msg) => {
          if (msg?.channel !== 'session_finalize') return;
          try {
            const data = JSON.parse(msg.payload || '{}');
            const resId = data.reservation_id;
            const status = String(data.status || '').toLowerCase();
            if (!resId || !status) return;
            if (status === 'completed') {
              // Derive a friendly description from the associated session model
              let desc = null;
              try {
                const img = await db.query('SELECT model FROM generation_sessions WHERE reservation_id = $1 LIMIT 1', [resId]);
                if (img.rows?.length) {
                  const m = String(img.rows[0].model || '').toLowerCase();
                  desc = m.includes('seedream-4') ? 'Seedream 4.0' : (m.includes('seedream-3') ? 'Seedream 3.0' : 'Image');
                } else {
                  const vid = await db.query('SELECT model FROM video_generation_sessions WHERE reservation_id = $1 LIMIT 1', [resId]);
                  if (vid.rows?.length) {
                    const m = String(vid.rows[0].model || '').toLowerCase();
                    desc = m.includes('veo') ? 'Google Veo 3' : (m.includes('seedance') ? 'Seedance' : 'Video');
                  }
                }
              } catch (_) {}
              await captureReservation(resId, desc ? { description: desc } : undefined).catch(() => {});
            } else if (status === 'failed') {
              await releaseReservation(resId).catch(() => {});
            }
          } catch (_) {}
        };
        listenClient.on('notification', handle);
        listenClient.on('error', () => { 
          try { listenClient.release(); } catch {} 
          retryAttempts++;
          setTimeout(doLoop, Math.min(1000 * Math.pow(2, retryAttempts), 30000)); 
        });
        listenClient.on('end', () => { 
          try { listenClient.release(); } catch {} 
          retryAttempts++;
          setTimeout(doLoop, Math.min(1000 * Math.pow(2, retryAttempts), 30000)); 
        });
        try { log.info({ event: 'listen.started', channel: 'session_finalize' }); } catch {}
        // keep open until error/end
      } catch (e) {
        console.warn('[captureWorker] LISTEN setup failed:', e?.message || e);
        retryAttempts++;
        setTimeout(doLoop, Math.min(1000 * Math.pow(2, retryAttempts), 30000));
      }
    };
    doLoop();
  })();

  return () => {
    clearInterval(timer);
    try { log.info({ event: 'stop' }); } catch {}
  };
}

module.exports = { startCaptureWorker };


