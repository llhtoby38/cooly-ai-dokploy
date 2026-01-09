// Utility script to provision SQS queues for the generation pipeline.
// Usage:
//   node backend/scripts/createSqsQueues.js
// Environment variables:
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (default: us-west-2)
//   SQS_MAIN_QUEUE_NAME (default: coolyai-generation)
//   SQS_DLQ_QUEUE_NAME (default: <main>-dlq)
//   SQS_MAX_RECEIVE_COUNT (default: 5)

const path = require('path');
try {
  const rootEnv = path.resolve(__dirname, '../../.env');
  require('dotenv').config({ path: rootEnv });
} catch (_) {
  // Ignore missing .env
}

const {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
} = require('@aws-sdk/client-sqs');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

// Allow custom env variable names from the root .env to populate AWS defaults.
if (!process.env.AWS_ACCESS_KEY_ID && process.env.AWS_IAM_COOLY_ACCESS_KEY) {
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_IAM_COOLY_ACCESS_KEY;
}
if (!process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_IAM_COOLY_SECRET_ACCESS_KEY) {
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_IAM_COOLY_SECRET_ACCESS_KEY;
}
if (!process.env.AWS_REGION && process.env.AWS_IAM_COOLY_REGION) {
  process.env.AWS_REGION = process.env.AWS_IAM_COOLY_REGION;
}
if (!process.env.AWS_ACCOUNT_ID && process.env.AWS_IAM_COOLY_ACCOUNT_ID) {
  process.env.AWS_ACCOUNT_ID = process.env.AWS_IAM_COOLY_ACCOUNT_ID;
}

const REGION = process.env.AWS_REGION || 'us-west-2';
const MAIN_QUEUE_NAME = process.env.SQS_MAIN_QUEUE_NAME || 'coolyai-generation';
const DLQ_QUEUE_NAME = process.env.SQS_DLQ_QUEUE_NAME || `${MAIN_QUEUE_NAME}-dlq`;
const MAX_RECEIVE_COUNT = String(process.env.SQS_MAX_RECEIVE_COUNT || '5');

const sqs = new SQSClient({ region: REGION });
const sts = new STSClient({ region: REGION });

async function getAccountIdentity() {
  try {
    const res = await sts.send(new GetCallerIdentityCommand({}));
    return { accountId: res.Account, arn: res.Arn, userId: res.UserId };
  } catch (err) {
    console.warn('[create-sqs] Unable to fetch caller identity:', err?.name || err?.message || err);
    return { accountId: null, arn: null, userId: null };
  }
}

async function getQueueUrl(name) {
  try {
    const res = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return res.QueueUrl;
  } catch (err) {
    if (err?.name === 'QueueDoesNotExist' || err?.code === 'AWS.SimpleQueueService.NonExistentQueue') {
      return null;
    }
    throw err;
  }
}

async function ensureQueue(name, attributes = {}) {
  const sanitized = { ...attributes };
  if (sanitized.FifoQueue === 'false' || sanitized.FifoQueue === false) {
    delete sanitized.FifoQueue;
  }
  if (sanitized.FifoQueue === 'true' || sanitized.FifoQueue === true) {
    sanitized.FifoQueue = 'true';
    if (!name.endsWith('.fifo')) {
      throw new Error(`Queue ${name} must end with .fifo when FifoQueue is true.`);
    }
  }

  let queueUrl = await getQueueUrl(name);
  if (!queueUrl) {
    const res = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: sanitized }));
    queueUrl = res.QueueUrl;
    console.log(`[create-sqs] Created queue ${name}`);
  } else if (sanitized && Object.keys(sanitized).length > 0) {
    await sqs.send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: sanitized }));
    console.log(`[create-sqs] Updated attributes for queue ${name}`);
  } else {
    console.log(`[create-sqs] Queue ${name} already exists`);
  }

  const attrRes = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['QueueArn', 'ApproximateNumberOfMessages', 'RedrivePolicy'],
  }));

  return {
    name,
    url: queueUrl,
    arn: attrRes.Attributes?.QueueArn || null,
    attributes: attrRes.Attributes || {},
  };
}

async function main() {
  console.log('[create-sqs] Region:', REGION);
  const identity = await getAccountIdentity();
  if (identity.accountId) {
    console.log('[create-sqs] Using AWS account:', identity.accountId);
  } else {
    console.log('[create-sqs] Proceeding without account ID (ensure credentials are set).');
  }

  const dlq = await ensureQueue(DLQ_QUEUE_NAME);

  if (!dlq.arn) {
    throw new Error(`DLQ ARN missing for ${DLQ_QUEUE_NAME}`);
  }

  const redrivePolicy = JSON.stringify({
    deadLetterTargetArn: dlq.arn,
    maxReceiveCount: MAX_RECEIVE_COUNT,
  });

  const main = await ensureQueue(MAIN_QUEUE_NAME, {
    RedrivePolicy: redrivePolicy,
  });

  console.log('\n[create-sqs] Provisioning complete:');
  console.log('  Main queue:', main.url);
  console.log('    ARN:', main.arn);
  console.log('    RedrivePolicy:', main.attributes?.RedrivePolicy || '(none)');
  console.log('  DLQ:', dlq.url);
  console.log('    ARN:', dlq.arn);
}

main().catch((err) => {
  console.error('[create-sqs] Failed to provision queues:', err?.stack || err?.message || err);
  process.exitCode = 1;
});


