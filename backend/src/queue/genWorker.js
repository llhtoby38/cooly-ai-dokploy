const path = require('path');

// Load repo root .env so standalone worker picks up shared configuration
try {
  const repoEnv = path.resolve(__dirname, '../../../.env');
  require('dotenv').config({ path: repoEnv });
  // Also try .env.local for Docker development
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  if (!process.env.DATABASE_URL && !process.env.PREVIEW_DATABASE_URL) {
    require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
  }
} catch {}

const { child: makeLogger } = require('../utils/logger');
const { getAppSetting } = require('../utils/appSettings');
const { getHandler } = (() => { try { return require('./handlers'); } catch { return { getHandler: () => null }; } })();
const { JobProcessingError } = require('./jobError');

// Queue adapter for environment-based queue selection (BullMQ vs SQS)
const queueAdapter = require('./queueAdapter');

const {
  receiveMessages,
  deleteMessage,
  changeMessageVisibility,
  sendMessage,
  MAIN_QUEUE_URL,
  DLQ_QUEUE_URL,
  REGION,
} = require('./sqsClient');

const log = makeLogger('genWorker');

function clampConcurrency(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.floor(n)));
}

const SETTINGS_REFRESH_MS = Math.max(5000, Number(process.env.GEN_WORKER_SETTINGS_REFRESH_MS || 30000));
const envConcurrency = clampConcurrency(Number(process.env.GEN_WORKER_CONCURRENCY || 5)) ?? 5;
let concurrency = envConcurrency;
let concurrencySource = 'env';
let lastSettingsFetch = 0;
let lastInvalidConcurrencyRaw;

async function refreshConcurrency({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastSettingsFetch < SETTINGS_REFRESH_MS) {
    return concurrency;
  }

  lastSettingsFetch = now;

  try {
    const raw = await getAppSetting('gen_worker_concurrency', { ttlMs: SETTINGS_REFRESH_MS, force: true });
    const hasOverride = raw !== null && typeof raw !== 'undefined' && String(raw).trim() !== '';

    if (hasOverride) {
      const candidate = typeof raw === 'number' ? raw : Number(raw);
      const normalized = clampConcurrency(candidate);
      if (normalized != null) {
        lastInvalidConcurrencyRaw = undefined;
        if (normalized !== concurrency || concurrencySource !== 'settings') {
          try { log.info({ event: 'worker.concurrency.update', source: 'settings', concurrency: normalized }); } catch (_) {}
        }
        concurrency = normalized;
        concurrencySource = 'settings';
        return concurrency;
      }

      const rawKey = JSON.stringify(raw);
      if (rawKey !== lastInvalidConcurrencyRaw) {
        lastInvalidConcurrencyRaw = rawKey;
        try { log.warn({ event: 'worker.concurrency.invalid_override', raw }); } catch (_) {}
      }
    } else {
      lastInvalidConcurrencyRaw = undefined;
    }
  } catch (err) {
    try { log.warn({ event: 'worker.concurrency.load_failed', msg: err?.message || err }); } catch (_) {}
  }

  if (concurrency !== envConcurrency || concurrencySource !== 'env') {
    try { log.info({ event: 'worker.concurrency.update', source: 'env', concurrency: envConcurrency }); } catch (_) {}
    concurrency = envConcurrency;
    concurrencySource = 'env';
  }

  lastInvalidConcurrencyRaw = undefined;

  return concurrency;
}

function getConcurrency() {
  return concurrency;
}

const waitTimeSeconds = Math.min(20, Math.max(1, Number(process.env.SQS_WAIT_TIME_SECONDS || 10)));
const visibilityTimeout = Math.max(30, Number(process.env.SQS_VISIBILITY_TIMEOUT || 120));
const idleDelayMs = Math.max(0, Number(process.env.SQS_IDLE_DELAY_MS ?? 0));
const retryVisibilityExtensionSeconds = Math.max(0, Number(process.env.SQS_RETRY_VISIBILITY_EXTENSION || 0));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildJobFromMessage(message, payload, jobType) {
  const receiveCount = Math.max(0, Number(message.Attributes?.ApproximateReceiveCount || '1') - 1);
  const jobId = payload?.sessionId || payload?.reservationId || payload?.jobId || message.MessageId;
  return {
    id: jobId,
    name: jobType,
    data: payload,
    attemptsMade: receiveCount,
  };
}

async function forwardToDlq(payload, meta = {}) {
  if (!DLQ_QUEUE_URL) return;
  try {
    const enriched = {
      ...payload,
      failureCode: meta.code || null,
      failureMessage: meta.message || null,
      receivedAt: new Date().toISOString(),
      attempts: meta.attempts || 0,
      sourceQueue: MAIN_QUEUE_URL,
    };
    await sendMessage({
      queueUrl: DLQ_QUEUE_URL,
      body: enriched,
      messageAttributes: {
        failureCode: meta.code || 'unknown',
        attempts: String(meta.attempts || 0),
      },
    });
    log.warn({ event: 'dlq.forwarded', code: meta.code, attempts: meta.attempts });
  } catch (err) {
    log.error({ event: 'dlq.forward_failed', msg: err?.message || err });
  }
}

async function handleMessage(message) {
  let payload;
  try {
    payload = message?.Body ? JSON.parse(message.Body) : {};
  } catch (err) {
    log.error({ event: 'job.payload.parse_failed', msg: err?.message || err });
    await forwardToDlq({}, { code: 'payload_parse_failed', message: err?.message, attempts: 1 });
    await deleteMessage(MAIN_QUEUE_URL, message.ReceiptHandle);
    return;
  }

  const jobTypeRaw = payload?.jobType || payload?.event_type || payload?.name || message.MessageAttributes?.jobType?.StringValue || 'unknown';
  const jobType = String(jobTypeRaw).toLowerCase();
  const handler = getHandler(jobType);

  if (!handler) {
    log.warn({ event: 'job.handler_missing', jobType });
    await deleteMessage(MAIN_QUEUE_URL, message.ReceiptHandle);
    return;
  }

  const job = buildJobFromMessage(message, payload, jobType);
  try {
    log.info({ event: 'job.start', jobType, jobId: job.id, attemptsMade: job.attemptsMade });
    await handler(job);
    await deleteMessage(MAIN_QUEUE_URL, message.ReceiptHandle);
    log.info({ event: 'job.completed', jobType, jobId: job.id });
  } catch (err) {
    const errMsg = err?.message || String(err);
    const attempts = job.attemptsMade + 1;
    const codeFromMessage = typeof errMsg === 'string' && errMsg.startsWith('DLQ:') ? errMsg : null;
    const permanent = err instanceof JobProcessingError || Boolean(codeFromMessage);
    const failureCode = err instanceof JobProcessingError ? err.code : codeFromMessage;

    if (permanent) {
      await forwardToDlq(payload, { code: failureCode, message: errMsg, attempts });
      await deleteMessage(MAIN_QUEUE_URL, message.ReceiptHandle);
      log.warn({ event: 'job.permanent_failure', jobType, jobId: job.id, code: failureCode, attempts });
      return;
    }

    log.error({ event: 'job.retry', jobType, jobId: job.id, msg: errMsg, attempts });
    if (retryVisibilityExtensionSeconds > 0) {
      try {
        await changeMessageVisibility(MAIN_QUEUE_URL, message.ReceiptHandle, retryVisibilityExtensionSeconds);
      } catch (visErr) {
        log.warn({ event: 'visibility.extend_failed', msg: visErr?.message || visErr });
      }
    }
  }
}

let running = false;
let stopRequested = false;

async function pollLoop() {
  if (!MAIN_QUEUE_URL) {
    log.error({ event: 'sqs.missing_queue_url', message: 'Set SQS_MAIN_QUEUE_URL to start generation worker.' });
    return;
  }

  await refreshConcurrency({ force: true });
  log.info({
    event: 'worker.init',
    queueUrl: MAIN_QUEUE_URL,
    region: REGION,
    concurrency: getConcurrency(),
    concurrencySource,
    waitTimeSeconds,
    visibilityTimeout,
    settingsRefreshMs: SETTINGS_REFRESH_MS,
  });

  const inFlight = new Set();

  const waitForAny = async () => {
    if (!inFlight.size) {
      if (idleDelayMs > 0) {
        await delay(idleDelayMs);
      }
      return;
    }
    await Promise.race(Array.from(inFlight));
  };

  const scheduleMessages = (messages) => {
    for (const msg of messages) {
      const run = (async () => {
        await handleMessage(msg);
      })();

      const wrapped = run.catch((err) => {
        log.error({ event: 'worker.msg_error', msg: err?.message || err });
      }).finally(() => {
        inFlight.delete(wrapped);
      });

      inFlight.add(wrapped);
    }
  };

  running = true;

  while (!stopRequested) {
    try {
      await refreshConcurrency();

      let fetchedAny = false;

      while (!stopRequested) {
        const currentConcurrency = getConcurrency();
        if (inFlight.size >= currentConcurrency) break;

        const maxMessages = Math.min(currentConcurrency - inFlight.size, 10);
        if (maxMessages <= 0) break;

        const messages = await receiveMessages({
          queueUrl: MAIN_QUEUE_URL,
          maxMessages,
          waitTimeSeconds,
          visibilityTimeout,
        });

        if (!messages.length) break;

        fetchedAny = true;
        scheduleMessages(messages);
      }

      if (!fetchedAny) {
        await waitForAny();
      }
    } catch (err) {
      log.error({ event: 'worker.loop_error', msg: err?.message || err });
      await delay(Math.max(idleDelayMs, 1000));
    }
  }

  try {
    if (inFlight.size) {
      await Promise.allSettled(Array.from(inFlight));
    }
  } finally {
    running = false;
  }
}

function startSqsWorker() {
  if (running) {
    log.info({ event: 'worker.already_running' });
    return () => { stopRequested = true; };
  }

  stopRequested = false;
  pollLoop().catch((err) => {
    log.error({ event: 'worker.start_failed', msg: err?.message || err });
  });

  return () => {
    stopRequested = true;
  };
}

/**
 * Start BullMQ worker (for local development with Redis)
 */
function startBullMQWorker() {
  const bullmqAdapter = require('./bullmqAdapter');

  log.info({
    event: 'worker.init',
    type: 'bullmq',
    queueName: bullmqAdapter.QUEUE_NAME,
    concurrency: getConcurrency(),
  });

  // Process jobs using the same handler system as SQS
  return bullmqAdapter.startWorker(async (job) => {
    const jobType = String(job.name || job.data?.jobType || 'unknown').toLowerCase();
    const handler = getHandler(jobType);

    if (!handler) {
      log.warn({ event: 'job.handler_missing', jobType, jobId: job.id });
      return;
    }

    log.info({ event: 'job.start', jobType, jobId: job.id, attemptsMade: job.attemptsMade });

    try {
      await handler(job);
      log.info({ event: 'job.completed', jobType, jobId: job.id });
    } catch (err) {
      log.error({ event: 'job.error', jobType, jobId: job.id, msg: err?.message || err });
      throw err; // Let BullMQ handle retry logic
    }
  });
}

/**
 * Unified worker start function - automatically selects BullMQ or SQS
 */
function startWorker() {
  if (queueAdapter.isLocal()) {
    log.info({ event: 'worker.mode', type: 'bullmq', reason: 'USE_BULLMQ=true or SQS_MAIN_QUEUE_URL missing' });
    return startBullMQWorker();
  } else {
    log.info({ event: 'worker.mode', type: 'sqs', queueUrl: MAIN_QUEUE_URL });
    return startSqsWorker();
  }
}

const autoStartFlag = String(process.env.START_GEN_WORKER || '').toLowerCase();
const ranDirectly = require.main === module;
const truthyFlags = new Set(['true', '1', 'yes', 'on']);

if (ranDirectly || truthyFlags.has(autoStartFlag)) {
  if (ranDirectly && autoStartFlag === 'false') {
    try { log.info({ event: 'worker.autostart_override', reason: 'direct_execution' }); } catch (_) {}
  }
  // Use unified startWorker which auto-selects queue type
  startWorker();
}

module.exports = { startSqsWorker, startBullMQWorker, startWorker };



