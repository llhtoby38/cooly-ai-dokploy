#!/usr/bin/env node
/*
 * Simple regression harness for the generation queue.
 *
 * Usage:
 *   node scripts/diagnostics/queueSmokeTest.js --job gen.seedream4 --user <uuid>
 *
 * Optional flags:
 *   --outputs <n>      Number of outputs to request (default 1)
 *   --prompt "text"    Prompt override for supported tools
 *   --mock true|false  Force mock generation (default true)
 *   --timeout <ms>     How long to wait for completion (default 90000)
 *   --no-relay         Skip starting a local outbox relay (if one already running)
 *   --params <path>    Path to JSON file containing custom params payload
 */

const path = require('path');
let fs;
const { randomUUID } = require('crypto');

const dotenv = require('dotenv');
try { fs = require('fs'); } catch (_) { fs = null; }

const candidateEnvPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
];

for (const envPath of candidateEnvPaths) {
  try {
    if (!fs || !fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath });
    break;
  } catch (_) {
    // ignore and try next candidate
  }
}

const db = require('../../src/db');
const { enqueueGeneration } = require('../../src/services/enqueue');
const { startOutboxRelay } = require('../../src/workers/outboxRelay');
const { MAIN_QUEUE_URL } = require('../../src/queue/sqsClient');

const PRESET_PROMPT = 'Diagnostics prompt -- hello world';
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_OUTPUTS = 1;
const COST_FALLBACK_PER_IMAGE = Number(process.env.DIAG_COST_FALLBACK || 1);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  const str = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(str)) return true;
  if (['0', 'false', 'no', 'n'].includes(str)) return false;
  return fallback;
}

function loadParamsFromFile(filePath) {
  const full = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(full, 'utf8');
  return JSON.parse(raw);
}

function buildPresetParams(jobType, inputs) {
  switch (jobType) {
    case 'gen.seedream4':
      return {
        prompt: inputs.prompt || 'Diagnostics prompt -- hello world',
        model: inputs.model || process.env.SEEDREAM4_MODEL_ID || 'seedream-4-0-250828',
        outputs: Number(inputs.outputs || 1),
        size: inputs.size || '1024x1024',
        guidance_scale: Number(inputs.guidance_scale || 3),
        negative_prompt: inputs.negative_prompt || null,
        ref_image_url: null,
        ref_image_urls: [],
        seed: inputs.seed ? Number(inputs.seed) : undefined,
        watermark: toBoolean(inputs.watermark, false),
        aspect_ratio: inputs.aspect_ratio || null,
        aspect_ratio_mode: inputs.aspect_ratio_mode || null
      };
    default:
      throw new Error(`No preset params for job type ${jobType}. Provide --params <file>.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSessionCompletion(sessionId, timeoutMs) {
  if (!sessionId) throw new Error('Session ID required to wait for completion');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { rows } = await db.query(
      'SELECT status, error_details, reservation_id, completed_at FROM generation_sessions WHERE id = $1',
      [sessionId]
    );
    if (rows.length) {
      const row = rows[0];
      const status = String(row.status || '').toLowerCase();
      if (status === 'completed' || status === 'failed') {
        return row;
      }
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for session ${sessionId}`);
}

async function computeCreditCost(jobType, params, requestedOutputs) {
  const outputs = Math.max(1, Number(requestedOutputs || params.outputs || 1));

  if (jobType !== 'gen.seedream4') {
    return outputs * COST_FALLBACK_PER_IMAGE;
  }

  const modelRaw = String(params.model || '').toLowerCase();
  const modelKey = modelRaw.includes('seedream-3')
    ? 'seedream-3'
    : (modelRaw.includes('seedream-4') ? 'seedream-4' : modelRaw);

  try {
    const { rows } = await db.query(
      `SELECT final_price_credits FROM image_variant_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
      [modelKey]
    );
    if (rows.length) {
      const perImage = Math.max(1, Number(rows[0].final_price_credits || 1));
      return perImage * outputs;
    }
  } catch (err) {
    console.warn('[diag] image_variant_pricing lookup failed:', err?.message || err);
  }

  try {
    const { rows } = await db.query(
      `SELECT credit_cost_per_unit FROM model_pricing WHERE model_key = $1 AND is_active = TRUE LIMIT 1`,
      [modelKey]
    );
    if (rows.length) {
      const perUnit = Math.max(1, Number(rows[0].credit_cost_per_unit || 1));
      return perUnit * outputs;
    }
  } catch (err) {
    console.warn('[diag] model_pricing lookup failed:', err?.message || err);
  }

  return outputs * COST_FALLBACK_PER_IMAGE;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobType = args.job || args['job-type'] || 'gen.seedream4';
  const userId = args.user || process.env.DIAG_USER_ID;
  if (!userId) {
    console.error('❌ Missing user id. Pass --user <uuid> or set DIAG_USER_ID in env.');
    process.exit(1);
  }

  const outputs = Number(args.outputs || 1);
  const mockFlag = toBoolean(args.mock, true);
  const timeoutMs = Number(args.timeout || 90000);
  const startRelayFlag = !toBoolean(args['no-relay'], false);
  const costOverride = args.cost !== undefined ? Number(args.cost) : 0;

  let params;
  if (args.params) {
    params = loadParamsFromFile(args.params);
  } else {
    params = buildPresetParams(jobType, { ...args, outputs });
  }
  params.outputs = outputs;

  const clientKey = args.clientKey || `diag-${randomUUID()}`;

  if (MAIN_QUEUE_URL) {
    console.log('   using queue    :', MAIN_QUEUE_URL);
  } else {
    console.warn('⚠️  SQS_MAIN_QUEUE_URL not configured – ensure outbox relay + worker are running.');
  }

  let stopRelay = null;
  if (startRelayFlag) {
    stopRelay = startOutboxRelay({ pollMs: Number(args.pollMs || 500) });
  }

  console.log(`➡️  Enqueuing ${jobType} for user ${userId}`);
  const resolvedCost = costOverride > 0
    ? costOverride
    : await computeCreditCost(jobType, params, outputs);

  const enqueueResult = await enqueueGeneration({
    jobType,
    userId,
    clientKey,
    params,
    cost: resolvedCost,
    model: params.model,
    mockFlag,
    preInsertSession: true
  });

  if (!enqueueResult.accepted) {
    console.error('❌ Queue rejected job:', enqueueResult.error || 'unknown error');
    if (stopRelay) stopRelay();
    process.exit(1);
  }

  const targetJobId = String(enqueueResult.reservationId || enqueueResult.clientKey);
  console.log('   reservationId:', enqueueResult.reservationId);
  console.log('   sessionId    :', enqueueResult.sessionId);
  console.log('   outboxId     :', enqueueResult.outboxId);
  console.log('   cost charged :', resolvedCost);
  console.log(`   waiting up to ${timeoutMs}ms for jobId ${targetJobId}`);

  try {
    const sessionRow = await waitForSessionCompletion(enqueueResult.sessionId, timeoutMs);
    const status = String(sessionRow.status || '').toLowerCase();
    console.log(`✅ Session ${enqueueResult.sessionId} reached status: ${status}`);
  } finally {
    if (stopRelay) stopRelay();
  }

  if (enqueueResult.sessionId) {
    const { rows: sessions } = await db.query(
      'SELECT id, status, outputs, resolution, credit_cost, created_at, completed_at FROM generation_sessions WHERE id = $1',
      [enqueueResult.sessionId]
    );
    if (sessions.length) {
      console.log('   session summary:', sessions[0]);
    } else {
      console.warn('⚠️  Session not found – it may have been created post-run by worker.');
    }

    const { rows: imageCountRows } = await db.query(
      'SELECT COUNT(*)::int AS count FROM images WHERE session_id = $1',
      [enqueueResult.sessionId]
    );
    const imageCount = imageCountRows.length ? imageCountRows[0].count : 0;
    console.log(`   stored images : ${imageCount}`);
  }

  console.log('🎉 Diagnostics complete');
}

main().catch((err) => {
  console.error('❌ Diagnostics failed:', err.message);
  process.exit(1);
});


