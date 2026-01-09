# AWS SQS Generation Queue

This document describes the SQS-backed replacement for the old Redis/BullMQ generation queue. It covers the queue topology, required configuration, runtime components, and migration steps.

## Queue Topology

- **Main queue**: `coolyai-generation`
  - Standard (non-FIFO) queue
  - Receives JSON messages produced by the outbox relay
  - Each message body matches the payload written to the `outbox` table
  - Redrive policy routes permanently failing messages to the DLQ after `maxReceiveCount` attempts (default: 5)
- **Dead-letter queue**: `coolyai-generation-dlq`
  - Receives messages that exceeded retry limits or were explicitly forwarded by the worker for permanent failures (e.g. `DLQ:user_id_not_found`)

## Required Environment Variables

Configure these in the repo root `.env`:

- `AWS_REGION` – typically `us-west-2`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` – credentials for an IAM user with SQS permissions
- `SQS_MAIN_QUEUE_URL` – full URL of the main queue (`https://sqs.<region>.amazonaws.com/<account>/coolyai-generation`)
- `SQS_DLQ_QUEUE_URL` – full URL of the DLQ (`https://sqs.<region>.amazonaws.com/<account>/coolyai-generation-dlq`)
- `SQS_IDLE_DELAY_MS` (optional) – pause between empty polls; defaults to `0` so the worker immediately re-polls and keeps queue wait near-zero.
- `GEN_WORKER_SETTINGS_REFRESH_MS` (optional) – how frequently the worker re-reads app_settings overrides (defaults to 30 000 ms).
- `AWS_ACCOUNT_ID` (optional) – required by provisioning scripts when you want the ARN in responses

`backend/scripts/createSqsQueues.js` reads these values automatically from the root `.env`. Run it to create/update both queues:

```
cd backend
node scripts/createSqsQueues.js
```

The script prints the queue URLs and ARNs that you should copy into the `.env` file.

## Runtime Components

### Outbox Relay

- Polls the `outbox` table, locking rows in small batches
- Sends each payload to SQS via `sendMessage`
- Requires `SQS_MAIN_QUEUE_URL` to be set; otherwise it backs off and logs `outbox.queue_missing`
- Still runs in-process via `startOutboxRelay()` or as a standalone worker

### Generation Worker (`backend/src/queue/genWorker.js`)

- Long-polling SQS consumer (no BullMQ dependency)
- Pulls up to `GEN_WORKER_CONCURRENCY` messages (max 10) per poll
- Immediately re-issues `ReceiveMessage` whenever it has capacity; the default zero idle delay keeps queue wait time to a few milliseconds. Set `SQS_IDLE_DELAY_MS` if you need to back off between polls.
- Parses message body, locates handler via `queue/handlers`
- On success: deletes the message
- On recoverable errors: leaves the message for SQS to retry (optionally extends visibility timeout)
- On permanent errors (`JobProcessingError` or messages starting with `DLQ:`): forwards enriched payload to the DLQ and deletes the main-queue message
- Auto-starts when `START_GEN_WORKER=true` in the environment (same flag as before)
- Emits `worker.init`, `job.start`, `job.completed`, `job.retry`, and `job.permanent_failure` logs for observability

```27:41:backend/src/queue/genWorker.js
const idleDelayMs = Math.max(0, Number(process.env.SQS_IDLE_DELAY_MS ?? 0));

const waitForAny = async () => {
  if (!inFlight.size) {
    if (idleDelayMs > 0) {
      await delay(idleDelayMs);
    }
    return;
  }
  await Promise.race(Array.from(inFlight));
};
```

```165:184:backend/src/queue/genWorker.js
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
```

- Admin override: the worker checks `app_settings.gen_worker_concurrency` (surfaced in Admin → Settings → Generation Worker) every ~30 s (`GEN_WORKER_SETTINGS_REFRESH_MS`, default 30 000 ms). When set, it overrides the env `GEN_WORKER_CONCURRENCY` without restarts.

### Job Handlers

- Handlers live in `backend/src/queue/jobs/`. Each module exports `handler` and a `jobNames` array. `handlers/index.js` auto-loads every file in that directory and registers the declared names, so wiring a new tool only requires dropping a module in the folder.
- Example registration (auto-generated):

```1:48:backend/src/queue/handlers/index.js
function registerHandler(jobName, handlerFn, source) {
  if (!jobName || typeof handlerFn !== 'function') return;
  const key = String(jobName).toLowerCase();
  handlers[key] = handlerFn;
  log.info({ event: 'handler.registered', jobName: key, source });
}

function loadHandlersFromJobsDir() {
  const jobsDir = path.resolve(__dirname, '../jobs');
  const files = fs.readdirSync(jobsDir);
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const mod = require(path.join(jobsDir, file));
    const jobNames = Array.isArray(mod?.jobNames) ? mod.jobNames : [];
    const handlerFn = typeof mod?.handler === 'function' ? mod.handler : undefined;
    if (!handlerFn || !jobNames.length) continue;
    for (const jobName of jobNames) registerHandler(jobName, handlerFn, file);
  }
}
```

- Existing handlers (e.g. `queue/jobs/seedream4.js`) throw `JobProcessingError` with `{ permanent: true }` when retries make no sense (missing user, insufficient credits, etc.)
- Handler logic is otherwise unchanged and still supports mock mode, provider requests, storage uploads, and session notifications

## Application Flow

1. API layer (`seedream4/generate`) writes an outbox row via `enqueueGeneration`
2. Outbox relay pushes that payload to `SQS_MAIN_QUEUE_URL`
3. SQS worker receives the message, runs the relevant handler, and updates Postgres/SSE just like the old BullMQ worker
4. The worker sends `NOTIFY session_completed` and, in the happy path, updates `generation_sessions` and `images`
5. A Postgres listener inside `seedream4` API broadcasts SSE `done`/`failed` events immediately so the UI reflects completion without waiting for polling
6. On permanent failures, the worker forwards the payload to `SQS_DLQ_QUEUE_URL` for later investigation and refunds reservations where appropriate

## Monitoring & Operations

- **Logs**: `genWorker` logger emits `job.start`, `job.completed`, `job.retry`, `job.permanent_failure`, and `dlq.forwarded` events
- **Metrics**: SQS Console shows visible/in-flight counts; CloudWatch alarms are recommended for DLQ depth
- **DLQ processing**: Inspect DLQ messages to identify new failure modes; after triage, delete or requeue manually via AWS Console or CLI
- **SSE bridge**: `backend/src/api/seedream4.js` now listens to `session_completed` notifications and sends SSE `done`/`failed`, keeping the frontend in sync even for paginated or out-of-view cards

## Integration Verification

- Run `npm run test:integration` from `backend/` to hit the live API and enqueue a real job through SQS.
- Required env: `INTEGRATION_TEST_USER_ID` (UUID of the test user).
- Optional env: `INTEGRATION_BASE_URL`, `INTEGRATION_TEST_JOB_TYPE`, `INTEGRATION_TEST_OUTPUTS`, `INTEGRATION_USE_MOCK`.
- The script first calls `/healthz` on the target API, then delegates to `diag:queue` to exercise the enqueue → SQS → worker → SSE path.

## Migration Checklist

- [x] Provision SQS queues and note URLs/ARNs
- [x] Update `.env` with SQS credentials and queue URLs
- [x] Deploy code containing the new SQS worker and relay modules
- [x] Ensure any BullMQ-specific processes are stopped (Upstash, etc.)
- [x] Start the SQS worker process (or set `START_GEN_WORKER=true` in API container)
- [ ] Configure CloudWatch alarms for queue depth and DLQ size (future work)
- [ ] Update deployment manifests to pass the new environment variables (pending)


