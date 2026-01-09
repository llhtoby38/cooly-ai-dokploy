const db = require('../db');
const { child: makeLogger } = require('../utils/logger');
const log = childLogger('sessionSweeper');

function childLogger(name) {
  try {
    const { child } = require('../utils/logger');
    return child(name);
  } catch (_) {
    return { info(){}, warn(){}, error(){} };
  }
}

function toMs(val, def) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function detectImageTool(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('seedream-4') || m.includes('seedream4')) return 'seedream4';
  if (m.includes('seedream-3') || m.includes('seedream3')) return 'seedream3';
  return null;
}

async function loadOverrides() {
  try {
    const { rows } = await db.query(
      `SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`,
      [[
        'enable_session_sweeper',
        'session_sweep_interval_ms',
        'img_max_ms',
        'video_max_ms',
        'video_notask_ttl_ms',
        'session_sweep_task_tools',
        // Per-tool image overrides
        'sweeper_img_max_ms_seedream3',
        'sweeper_img_max_ms_seedream4',
        // Per-tool video overrides
        'sweeper_video_notask_ttl_ms_seedance',
        'sweeper_video_max_ms_seedance',
        'sweeper_video_notask_ttl_ms_sora',
        'sweeper_video_max_ms_sora',
        'sweeper_video_notask_ttl_ms_veo31',
        'sweeper_video_max_ms_veo31'
      ]]
    );
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  } catch (e) {
    try { log.warn({ event: 'overrides.load.error', msg: e?.message || String(e) }); } catch {}
    return {};
  }
}

async function sweepImages({ imgMaxMs, imgMaxByTool }) {
  const maxAgeDefault = toMs(imgMaxMs, 30 * 60 * 1000); // default 30m
  if (maxAgeDefault <= 0 && !imgMaxByTool) return;
  // Find stuck image sessions
  const { rows } = await db.query(
    `SELECT id, created_at, reservation_id, model
     FROM generation_sessions
     WHERE status = 'processing'
     ORDER BY created_at ASC
     FOR UPDATE SKIP LOCKED`);

  const now = Date.now();
  for (const row of rows) {
    const tool = detectImageTool(row.model);
    const toolMax = tool ? toMs(imgMaxByTool?.[tool], undefined) : undefined;
    const maxAge = toolMax != null ? toolMax : maxAgeDefault;
    if (maxAge <= 0) continue;
    const age = now - new Date(row.created_at).getTime();
    if (age > maxAge) {
      try {
        await db.query('UPDATE generation_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
        const resId = row.reservation_id;
        if (resId) {
          // Notify captureWorker to release quickly
          try {
            const payload = JSON.stringify({ reservation_id: resId, status: 'failed', event_ts: Date.now() }).replace(/'/g, "''");
            await db.query(`NOTIFY session_finalize, '${payload}'`);
          } catch (_) {}
        }
        try { log.info({ event: 'sweep.image.failed', sessionId: row.id, ageMs: age, tool, maxAge }); } catch {}
      } catch (e) {
        try { log.warn({ event: 'sweep.image.error', sessionId: row.id, msg: e?.message || String(e) }); } catch {}
      }
    }
  }
}

async function sweepVideos({ noTaskTtlMs, videoMaxMs, taskToolsCsv, perTool }) {
  const maxAgeDefault = toMs(videoMaxMs, 2 * 60 * 60 * 1000); // default 2h
  const noTaskDefault = toMs(noTaskTtlMs, 30 * 60 * 1000); // default 30m
  const taskTools = String(taskToolsCsv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const { rows } = await db.query(
    `SELECT id, created_at, reservation_id, task_id, model
     FROM video_generation_sessions
     WHERE status = 'processing'
     ORDER BY created_at ASC
     FOR UPDATE SKIP LOCKED`
  );

  const now = Date.now();
  for (const row of rows) {
    const age = now - new Date(row.created_at).getTime();
    const model = String(row.model || '').toLowerCase();
    const requiresTask = taskTools.some(key => model.includes(key));
    const tool = 'seedance';
    const toolMax = toMs(perTool?.videoMax?.[tool], undefined);
    const toolNoTask = toMs(perTool?.noTaskTtl?.[tool], undefined);

    const effMax = toolMax != null ? toolMax : maxAgeDefault;
    const effNoTask = toolNoTask != null ? toolNoTask : noTaskDefault;

    let shouldFail = false;
    let reason = '';

    if (requiresTask && !row.task_id && effNoTask > 0 && age > effNoTask) {
      shouldFail = true; reason = 'no_task_ttl_exceeded';
    } else if (effMax > 0 && age > effMax) {
      shouldFail = true; reason = 'max_age_exceeded';
    }

    if (shouldFail) {
      try {
        await db.query('UPDATE video_generation_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
        const resId = row.reservation_id;
        if (resId) {
          try {
            const payload = JSON.stringify({ reservation_id: resId, status: 'failed', event_ts: Date.now() }).replace(/'/g, "''");
            await db.query(`NOTIFY session_finalize, '${payload}'`);
          } catch (_) {}
        }
        try { log.info({ event: 'sweep.video.failed', tool, sessionId: row.id, ageMs: age, reason, requiresTask, hasTask: !!row.task_id, effMax, effNoTask }); } catch {}
      } catch (e) {
        try { log.warn({ event: 'sweep.video.error', sessionId: row.id, msg: e?.message || String(e) }); } catch {}
      }
    }
  }
}

async function sweepSora({ noTaskTtlMs, videoMaxMs, taskToolsCsv, perTool }) {
  const maxAgeDefault = toMs(videoMaxMs, 2 * 60 * 60 * 1000);
  const noTaskDefault = toMs(noTaskTtlMs, 30 * 60 * 1000);
  const taskTools = String(taskToolsCsv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const { rows } = await db.query(
    `SELECT id, created_at, reservation_id, task_id, model
     FROM sora_video_sessions
     WHERE status = 'processing'
     ORDER BY created_at ASC
     FOR UPDATE SKIP LOCKED`
  );

  const now = Date.now();
  for (const row of rows) {
    const age = now - new Date(row.created_at).getTime();
    const model = String(row.model || '').toLowerCase();
    const requiresTask = taskTools.some(key => model.includes(key));
    const tool = 'sora';
    const toolMax = toMs(perTool?.videoMax?.[tool], undefined);
    const toolNoTask = toMs(perTool?.noTaskTtl?.[tool], undefined);
    const effMax = toolMax != null ? toolMax : maxAgeDefault;
    const effNoTask = toolNoTask != null ? toolNoTask : noTaskDefault;

    let shouldFail = false;
    let reason = '';
    if (requiresTask && !row.task_id && effNoTask > 0 && age > effNoTask) {
      shouldFail = true; reason = 'no_task_ttl_exceeded';
    } else if (effMax > 0 && age > effMax) {
      shouldFail = true; reason = 'max_age_exceeded';
    }

    if (shouldFail) {
      try {
        await db.query('UPDATE sora_video_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
        const resId = row.reservation_id;
        if (resId) {
          try {
            const payload = JSON.stringify({ reservation_id: resId, status: 'failed', event_ts: Date.now() }).replace(/'/g, "''");
            await db.query(`NOTIFY session_finalize, '${payload}'`);
          } catch (_) {}
        }
        try { log.info({ event: 'sweep.sora.failed', tool, sessionId: row.id, ageMs: age, reason, requiresTask, hasTask: !!row.task_id, effMax, effNoTask }); } catch {}
      } catch (e) {
        try { log.warn({ event: 'sweep.sora.error', sessionId: row.id, msg: e?.message || String(e) }); } catch {}
      }
    }
  }
}

async function sweepVeo31({ noTaskTtlMs, videoMaxMs, taskToolsCsv, perTool }) {
  const maxAgeDefault = toMs(videoMaxMs, 2 * 60 * 60 * 1000);
  const noTaskDefault = toMs(noTaskTtlMs, 30 * 60 * 1000);
  const taskTools = String(taskToolsCsv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const { rows } = await db.query(
    `SELECT id, created_at, reservation_id, task_id, model
     FROM veo31_video_sessions
     WHERE status = 'processing'
     ORDER BY created_at ASC
     FOR UPDATE SKIP LOCKED`
  );

  const now = Date.now();
  for (const row of rows) {
    const age = now - new Date(row.created_at).getTime();
    const model = String(row.model || '').toLowerCase();
    const requiresTask = taskTools.some(key => model.includes(key));
    const tool = 'veo31';
    const toolMax = toMs(perTool?.videoMax?.[tool], undefined);
    const toolNoTask = toMs(perTool?.noTaskTtl?.[tool], undefined);
    const effMax = toolMax != null ? toolMax : maxAgeDefault;
    const effNoTask = toolNoTask != null ? toolNoTask : noTaskDefault;

    let shouldFail = false;
    let reason = '';
    if (requiresTask && !row.task_id && effNoTask > 0 && age > effNoTask) {
      shouldFail = true; reason = 'no_task_ttl_exceeded';
    } else if (effMax > 0 && age > effMax) {
      shouldFail = true; reason = 'max_age_exceeded';
    }

    if (shouldFail) {
      try {
        await db.query('UPDATE veo31_video_sessions SET status=$1 WHERE id=$2', ['failed', row.id]);
        const resId = row.reservation_id;
        if (resId) {
          try {
            const payload = JSON.stringify({ reservation_id: resId, status: 'failed', event_ts: Date.now() }).replace(/'/g, "''");
            await db.query(`NOTIFY session_finalize, '${payload}'`);
          } catch (_) {}
        }
        try { log.info({ event: 'sweep.veo31.failed', tool, sessionId: row.id, ageMs: age, reason, requiresTask, hasTask: !!row.task_id, effMax, effNoTask }); } catch {}
      } catch (e) {
        try { log.warn({ event: 'sweep.veo31.error', sessionId: row.id, msg: e?.message || String(e) }); } catch {}
      }
    }
  }
}

function startSessionSweeper(options = {}) {
  const intervalMs = toMs(options.intervalMs ?? process.env.SESSION_SWEEP_INTERVAL_MS, 120000); // 2m
  const defaultImgMaxMs = toMs(options.imgMaxMs ?? process.env.IMG_MAX_MS, 30 * 60 * 1000);
  const defaultVideoMaxMs = toMs(options.videoMaxMs ?? process.env.VIDEO_MAX_MS, 2 * 60 * 60 * 1000);
  const defaultNoTaskTtlMs = toMs(options.videoNoTaskTtlMs ?? process.env.VIDEO_NOTASK_TTL_MS, 30 * 60 * 1000);
  const defaultTaskToolsCsv = (options.taskToolsCsv ?? process.env.SESSION_SWEEP_TASK_TOOLS) || 'seedance';

  const tick = async () => {
    const t0 = Date.now();
    try {
      const overrides = await loadOverrides();
      const enabled = overrides.enable_session_sweeper;
      if (enabled === false) {
        try { log.info({ event: 'tick.skip.disabled' }); } catch {}
        return;
      }

      const imgMaxMs = toMs(overrides.img_max_ms, defaultImgMaxMs);
      const videoMaxMs = toMs(overrides.video_max_ms, defaultVideoMaxMs);
      const noTaskTtlMs = toMs(overrides.video_notask_ttl_ms, defaultNoTaskTtlMs);
      const taskToolsCsv = (overrides.session_sweep_task_tools ?? defaultTaskToolsCsv);

      const imgMaxByTool = {
        seedream3: overrides.sweeper_img_max_ms_seedream3,
        seedream4: overrides.sweeper_img_max_ms_seedream4
      };
      const perTool = {
        videoMax: {
          seedance: overrides.sweeper_video_max_ms_seedance,
          sora: overrides.sweeper_video_max_ms_sora,
          veo31: overrides.sweeper_video_max_ms_veo31
        },
        noTaskTtl: {
          seedance: overrides.sweeper_video_notask_ttl_ms_seedance,
          sora: overrides.sweeper_video_notask_ttl_ms_sora,
          veo31: overrides.sweeper_video_notask_ttl_ms_veo31
        }
      };

      await sweepImages({ imgMaxMs, imgMaxByTool });
      await sweepVideos({ noTaskTtlMs, videoMaxMs, taskToolsCsv, perTool });
      await sweepSora({ noTaskTtlMs, videoMaxMs, taskToolsCsv, perTool });
      await sweepVeo31({ noTaskTtlMs, videoMaxMs, taskToolsCsv, perTool });
      try { log.info({ event: 'tick.done', elapsedMs: Date.now() - t0, imgMaxMs, videoMaxMs, noTaskTtlMs, taskToolsCsv }); } catch {}
    } catch (e) {
      try { log.warn({ event: 'tick.error', msg: e?.message || String(e) }); } catch {}
    }
  };

  const id = setInterval(tick, intervalMs);
  id.unref?.();
  setTimeout(tick, Math.min(5000, intervalMs)).unref?.();
  try { log.info({ event: 'start', intervalMs, imgMaxMs: defaultImgMaxMs, videoMaxMs: defaultVideoMaxMs, noTaskTtlMs: defaultNoTaskTtlMs, taskToolsCsv: defaultTaskToolsCsv }); } catch {}
  return () => clearInterval(id);
}

module.exports = { startSessionSweeper };


