const {
  SQSClient,
  SendMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  DeleteMessageBatchCommand
} = require('@aws-sdk/client-sqs');
const { child: makeLogger } = require('../utils/logger');

const log = makeLogger('sqs');

// Allow alternate env variable names from local .env files
if (!process.env.AWS_ACCESS_KEY_ID && process.env.AWS_IAM_COOLY_ACCESS_KEY) {
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_IAM_COOLY_ACCESS_KEY;
}
if (!process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_IAM_COOLY_SECRET_ACCESS_KEY) {
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_IAM_COOLY_SECRET_ACCESS_KEY;
}
if (!process.env.AWS_REGION && process.env.AWS_IAM_COOLY_REGION) {
  process.env.AWS_REGION = process.env.AWS_IAM_COOLY_REGION;
}

const REGION = process.env.AWS_REGION || 'us-west-2';
const MAIN_QUEUE_URL = process.env.SQS_MAIN_QUEUE_URL || null;
const DLQ_QUEUE_URL = process.env.SQS_DLQ_QUEUE_URL || null;

const sqsClient = new SQSClient({ region: REGION });

function formatMessageAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const formatted = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && value.DataType) {
      formatted[key] = value;
    } else {
      formatted[key] = { DataType: 'String', StringValue: String(value) };
    }
  }
  return Object.keys(formatted).length ? formatted : undefined;
}

function normaliseBody(body) {
  if (body === undefined || body === null) return '{}';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch (err) {
    log.warn({ event: 'sqs.body.stringify_failed', msg: err?.message || err });
    return JSON.stringify({ error: 'stringify_failed' });
  }
}

async function sendMessage(params = {}) {
  const queueUrl = params.queueUrl || MAIN_QUEUE_URL;
  if (!queueUrl) throw new Error('SQS queueUrl is required');

  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: normaliseBody(params.body),
    MessageGroupId: params.messageGroupId,
    MessageAttributes: formatMessageAttributes(params.messageAttributes),
  });

  return sqsClient.send(command);
}

async function deleteMessage(queueUrl, receiptHandle) {
  if (!queueUrl) throw new Error('Queue URL is required for deleteMessage');
  if (!receiptHandle) return;
  await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
}

async function changeMessageVisibility(queueUrl, receiptHandle, timeoutSeconds) {
  if (!queueUrl) throw new Error('Queue URL is required for changeMessageVisibility');
  if (!receiptHandle) return;
  await sqsClient.send(new ChangeMessageVisibilityCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
    VisibilityTimeout: Math.max(0, Number(timeoutSeconds) || 0),
  }));
}

async function receiveMessages(options = {}) {
  const queueUrl = options.queueUrl || MAIN_QUEUE_URL;
  if (!queueUrl) throw new Error('SQS queueUrl is required for receiveMessages');

  const command = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: Math.min(10, Math.max(1, Number(options.maxMessages) || 1)),
    WaitTimeSeconds: Math.min(20, Math.max(0, Number(options.waitTimeSeconds) || 0)),
    VisibilityTimeout: options.visibilityTimeout ? Math.max(0, Number(options.visibilityTimeout)) : undefined,
    MessageAttributeNames: options.messageAttributeNames || ['All'],
    AttributeNames: options.attributeNames || ['ApproximateReceiveCount', 'SentTimestamp'],
  });

  const response = await sqsClient.send(command);
  return response.Messages || [];
}

/**
 * Send multiple messages in a single batch (up to 10 messages)
 * Contract Item A2.5: Batch SQS operations for improved performance
 *
 * @param {Object} options - Batch send options
 * @param {string} options.queueUrl - Target queue URL
 * @param {Array} options.messages - Array of message objects with {id, body, messageAttributes}
 * @returns {Promise<{successful: Array, failed: Array}>}
 */
async function sendMessageBatch(options = {}) {
  const queueUrl = options.queueUrl || MAIN_QUEUE_URL;
  if (!queueUrl) throw new Error('SQS queueUrl is required for sendMessageBatch');
  if (!Array.isArray(options.messages) || options.messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  // SQS batch limit is 10 messages
  const batch = options.messages.slice(0, 10);

  const entries = batch.map((msg, idx) => ({
    Id: msg.id || `msg-${idx}`,
    MessageBody: normaliseBody(msg.body),
    MessageGroupId: msg.messageGroupId,
    MessageAttributes: formatMessageAttributes(msg.messageAttributes),
  }));

  const command = new SendMessageBatchCommand({
    QueueUrl: queueUrl,
    Entries: entries,
  });

  const response = await sqsClient.send(command);

  return {
    successful: response.Successful || [],
    failed: response.Failed || [],
  };
}

/**
 * Delete multiple messages in a single batch (up to 10 messages)
 * Contract Item A2.5: Batch SQS operations for improved performance
 *
 * @param {string} queueUrl - Queue URL
 * @param {Array} receiptHandles - Array of objects with {id, receiptHandle}
 * @returns {Promise<{successful: Array, failed: Array}>}
 */
async function deleteMessageBatch(queueUrl, receiptHandles) {
  if (!queueUrl) throw new Error('Queue URL is required for deleteMessageBatch');
  if (!Array.isArray(receiptHandles) || receiptHandles.length === 0) {
    return { successful: [], failed: [] };
  }

  // SQS batch limit is 10 messages
  const batch = receiptHandles.slice(0, 10);

  const entries = batch.map((item, idx) => ({
    Id: item.id || `del-${idx}`,
    ReceiptHandle: item.receiptHandle,
  }));

  const command = new DeleteMessageBatchCommand({
    QueueUrl: queueUrl,
    Entries: entries,
  });

  const response = await sqsClient.send(command);

  return {
    successful: response.Successful || [],
    failed: response.Failed || [],
  };
}

module.exports = {
  sqsClient,
  sendMessage,
  deleteMessage,
  changeMessageVisibility,
  receiveMessages,
  sendMessageBatch,
  deleteMessageBatch,
  MAIN_QUEUE_URL,
  DLQ_QUEUE_URL,
  REGION,
};



