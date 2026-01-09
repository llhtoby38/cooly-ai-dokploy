/**
 * Queue Adapter - Unified interface for BullMQ (local) and SQS (cloud)
 *
 * Environment detection:
 * - USE_BULLMQ=true OR missing SQS_MAIN_QUEUE_URL → Use BullMQ with Redis
 * - Otherwise → Use AWS SQS
 */

const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('queueAdapter');

// Environment detection
const USE_BULLMQ = String(process.env.USE_BULLMQ || '').toLowerCase() === 'true'
                   || !process.env.SQS_MAIN_QUEUE_URL;

let adapter = null;
let adapterType = null;

/**
 * Get the appropriate queue adapter based on environment
 */
function getAdapter() {
  if (adapter) return adapter;

  if (USE_BULLMQ) {
    adapterType = 'bullmq';
    log.info({ event: 'queue.adapter.init', type: 'bullmq', redis: process.env.REDIS_URL || 'redis://localhost:6379' });
    adapter = require('./bullmqAdapter');
  } else {
    adapterType = 'sqs';
    log.info({ event: 'queue.adapter.init', type: 'sqs', queue: process.env.SQS_MAIN_QUEUE_URL });
    adapter = require('./sqsAdapter');
  }

  return adapter;
}

/**
 * Send a message to the queue
 * @param {Object} params - Message parameters
 * @param {string|Object} params.body - Message body (JSON string or object)
 * @param {Object} params.messageAttributes - Additional attributes (jobType, jobId, etc.)
 * @returns {Promise<{MessageId: string}>}
 */
async function sendMessage(params = {}) {
  return getAdapter().sendMessage(params);
}

/**
 * Get the queue URL/identifier
 * @returns {string}
 */
function getQueueUrl() {
  return getAdapter().getQueueUrl();
}

/**
 * Check if using local BullMQ queue
 * @returns {boolean}
 */
function isLocal() {
  return USE_BULLMQ;
}

/**
 * Get the adapter type ('bullmq' or 'sqs')
 * @returns {string}
 */
function getType() {
  if (!adapterType) getAdapter();
  return adapterType;
}

/**
 * Start the queue worker (BullMQ only)
 * @param {Function} processJob - Job processor function
 * @returns {Function|null} - Cleanup function or null if not applicable
 */
function startWorker(processJob) {
  const a = getAdapter();
  if (typeof a.startWorker === 'function') {
    return a.startWorker(processJob);
  }
  return null;
}

/**
 * Check if adapter supports batch operations
 * Contract Item A2.5: Batch SQS operations
 * @returns {boolean}
 */
function supportsBatch() {
  const a = getAdapter();
  return typeof a.sendMessageBatch === 'function';
}

/**
 * Send multiple messages in batch (SQS only)
 * Contract Item A2.5: Batch SQS operations
 * @param {Object} params - Batch parameters
 * @param {Array} params.messages - Array of message objects
 * @returns {Promise<{successful: Array, failed: Array}>}
 */
async function sendMessageBatch(params = {}) {
  const a = getAdapter();
  if (typeof a.sendMessageBatch === 'function') {
    return a.sendMessageBatch(params);
  }
  // Fallback to individual sends for adapters that don't support batch
  const results = { successful: [], failed: [] };
  for (const msg of params.messages || []) {
    try {
      await sendMessage(msg);
      results.successful.push({ Id: msg.id });
    } catch (e) {
      results.failed.push({ Id: msg.id, Code: 'SendError', Message: e.message });
    }
  }
  return results;
}

module.exports = {
  sendMessage,
  getQueueUrl,
  isLocal,
  getType,
  startWorker,
  supportsBatch,
  sendMessageBatch,
  getAdapter,
  USE_BULLMQ
};
