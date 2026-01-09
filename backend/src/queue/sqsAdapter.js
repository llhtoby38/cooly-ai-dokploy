/**
 * SQS Adapter - Thin wrapper around existing SQS client
 *
 * Provides the same interface as bullmqAdapter for seamless switching.
 */

const {
  sendMessage: sqsSendMessage,
  sendMessageBatch: sqsSendMessageBatch,
  MAIN_QUEUE_URL
} = require('./sqsClient');
const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('sqsAdapter');

/**
 * Send a message to SQS (passthrough to existing sqsClient)
 * @param {Object} params - Message parameters
 * @returns {Promise<{MessageId: string}>}
 */
async function sendMessage(params = {}) {
  // Convert params to sqsClient format if needed
  const sqsParams = {
    body: params.body,
    messageAttributes: params.messageAttributes
  };

  log.debug({
    event: 'sqs.adapter.sendMessage',
    jobType: params.messageAttributes?.jobType
  });

  return sqsSendMessage(sqsParams);
}

/**
 * Get the SQS queue URL
 * @returns {string}
 */
function getQueueUrl() {
  return MAIN_QUEUE_URL;
}

/**
 * SQS doesn't use a worker in the same way - the worker is managed separately
 * in genWorker.js which polls SQS directly
 * @returns {null}
 */
function startWorker() {
  log.info({ event: 'sqs.adapter.startWorker', message: 'SQS worker managed by genWorker.js' });
  return null;
}

/**
 * Send multiple messages in batch (Contract Item A2.5)
 * @param {Object} params - Batch parameters
 * @param {Array} params.messages - Array of messages
 * @returns {Promise<{successful: Array, failed: Array}>}
 */
async function sendMessageBatch(params = {}) {
  log.debug({
    event: 'sqs.adapter.sendMessageBatch',
    count: params.messages?.length || 0
  });

  return sqsSendMessageBatch(params);
}

module.exports = {
  sendMessage,
  sendMessageBatch,
  getQueueUrl,
  startWorker
};
