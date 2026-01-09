/**
 * BullMQ Adapter - Local queue implementation using Redis
 *
 * Provides an SQS-compatible interface for BullMQ, allowing seamless
 * switching between local development (BullMQ) and production (SQS).
 */

const { Queue, Worker } = require('bullmq');
const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('bullmqAdapter');

// Redis connection configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'cooly-generation';

// Parse Redis URL for connection options
function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    const options = {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 6379,
    };

    if (parsed.password) {
      options.password = decodeURIComponent(parsed.password);
    }

    if (parsed.username && parsed.username !== 'default') {
      options.username = parsed.username;
    }

    // Handle TLS for rediss:// URLs
    if (parsed.protocol === 'rediss:') {
      options.tls = {};
    }

    return options;
  } catch (err) {
    log.warn({ event: 'redis.url.parse_error', url, error: err.message });
    return { host: 'localhost', port: 6379 };
  }
}

const connection = parseRedisUrl(REDIS_URL);

// Lazy initialization
let genQueue = null;
let worker = null;

/**
 * Get or create the BullMQ queue
 */
function getQueue() {
  if (!genQueue) {
    genQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 1000, age: 24 * 3600 }, // Keep last 1000 or 24 hours
        removeOnFail: { count: 5000, age: 7 * 24 * 3600 }, // Keep last 5000 or 7 days
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    });

    genQueue.on('error', (err) => {
      log.error({ event: 'bullmq.queue.error', error: err.message });
    });

    log.info({
      event: 'bullmq.queue.created',
      name: QUEUE_NAME,
      redis: `${connection.host}:${connection.port}`
    });
  }
  return genQueue;
}

/**
 * Send a message to the queue (SQS-compatible interface)
 * @param {Object} params - Message parameters
 * @param {string|Object} params.body - Message body
 * @param {Object} params.messageAttributes - Additional attributes
 * @returns {Promise<{MessageId: string}>}
 */
async function sendMessage(params = {}) {
  const queue = getQueue();

  // Parse body if it's a string
  const body = typeof params.body === 'string' ? JSON.parse(params.body) : params.body;

  // Extract job metadata
  const jobType = body?.jobType
    || params.messageAttributes?.jobType
    || body?.tool
    || 'unknown';

  const jobId = params.messageAttributes?.jobId
    || params.messageAttributes?.outboxId
    || body?.sessionId
    || body?.reservationId
    || undefined;

  // Add job to queue
  const job = await queue.add(jobType, body, {
    jobId: jobId ? String(jobId) : undefined,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 }
  });

  log.info({
    event: 'bullmq.job.added',
    jobType,
    jobId: job.id,
    queueName: QUEUE_NAME
  });

  return { MessageId: job.id };
}

/**
 * Start the BullMQ worker
 * @param {Function} processJob - Job processor function
 * @returns {Function} - Cleanup function to stop the worker
 */
function startWorker(processJob) {
  if (worker) {
    log.warn({ event: 'bullmq.worker.already_running' });
    return () => worker.close();
  }

  const concurrency = Math.max(1, Math.min(50, Number(process.env.GEN_WORKER_CONCURRENCY || 5)));

  worker = new Worker(QUEUE_NAME, async (job) => {
    const startTime = Date.now();
    log.info({
      event: 'bullmq.job.processing',
      jobId: job.id,
      name: job.name,
      attempt: job.attemptsMade + 1
    });

    try {
      // Convert to a format compatible with existing handlers
      const sqsLikeJob = {
        id: job.id,
        name: job.name,
        data: job.data,
        attemptsMade: job.attemptsMade,
        // Add progress reporting
        updateProgress: (progress) => job.updateProgress(progress)
      };

      const result = await processJob(sqsLikeJob);

      log.info({
        event: 'bullmq.job.success',
        jobId: job.id,
        name: job.name,
        durationMs: Date.now() - startTime
      });

      return result;
    } catch (err) {
      log.error({
        event: 'bullmq.job.error',
        jobId: job.id,
        name: job.name,
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - startTime
      });
      throw err;
    }
  }, {
    connection,
    concurrency,
    lockDuration: 120000, // 2 minutes lock
    stalledInterval: 30000, // Check for stalled jobs every 30s
    maxStalledCount: 3
  });

  worker.on('completed', (job) => {
    log.debug({
      event: 'bullmq.job.completed',
      jobId: job.id,
      name: job.name
    });
  });

  worker.on('failed', (job, err) => {
    log.error({
      event: 'bullmq.job.failed',
      jobId: job?.id,
      name: job?.name,
      error: err?.message,
      attemptsMade: job?.attemptsMade
    });
  });

  worker.on('error', (err) => {
    log.error({
      event: 'bullmq.worker.error',
      error: err.message
    });
  });

  worker.on('stalled', (jobId) => {
    log.warn({
      event: 'bullmq.job.stalled',
      jobId
    });
  });

  log.info({
    event: 'bullmq.worker.started',
    concurrency,
    queueName: QUEUE_NAME,
    redis: `${connection.host}:${connection.port}`
  });

  // Return cleanup function
  return async () => {
    log.info({ event: 'bullmq.worker.stopping' });
    await worker.close();
    worker = null;
    log.info({ event: 'bullmq.worker.stopped' });
  };
}

/**
 * Get queue URL/identifier
 * @returns {string}
 */
function getQueueUrl() {
  return `bullmq://${QUEUE_NAME}`;
}

/**
 * Get queue stats
 * @returns {Promise<Object>}
 */
async function getQueueStats() {
  const queue = getQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount()
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Gracefully close queue and worker
 */
async function close() {
  const closePromises = [];

  if (worker) {
    closePromises.push(worker.close());
    worker = null;
  }

  if (genQueue) {
    closePromises.push(genQueue.close());
    genQueue = null;
  }

  await Promise.all(closePromises);
  log.info({ event: 'bullmq.closed' });
}

module.exports = {
  sendMessage,
  startWorker,
  getQueue,
  getQueueUrl,
  getQueueStats,
  close,
  connection,
  QUEUE_NAME
};
